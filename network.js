/*
 * LITEcrib - Litecoin-powered multiplayer networking client.
 *
 * One public surface (game.js is byte-compatible, needs no changes), two
 * transports:
 *
 *   RELAY - real cross-device networking. When served by the relay server
 *   (`node server.js`), this client talks to it over plain HTTP:
 *     - EventSource (SSE)  GET /api/stream?playerId=..&tableId=..
 *       server -> client push of named events: "tableList", "state", "chat".
 *       EventSource auto-reconnects; on every (re)connect the relay REPLAYS
 *       the full current view, so a freshly-opened lobby or a recovered
 *       connection catches up with zero extra round-trips. Two devices that
 *       point at the same relay genuinely see each other's tables.
 *     - HTTP POST          POST /api/tables/...  (create/join/leave/state/chat)
 *       client -> server. The relay is the single source of truth.
 *
 *   LOCAL - solo fallback. If no relay is reachable (static GitHub Pages or
 *   file://), AI play remains available, but human table creation is refused
 *   with an explicit explanation. Set config.js relayUrl to the shared relay
 *   origin to enable cross-device play from a static host.
 *
 * Public API (identical to the previous localStorage-only client):
 *   connect() -> Promise<{playerId}>
 *   on/off(event, cb)  events: connected, disconnected, state, tableList,
 *                                chat, connectionState
 *   getServerUrl(), getConnectionStatus(), getTableList(), getTableState()
 *   createTable(mode, name), joinTable(tableId, name), leaveTable()
 *   resumeActiveTable(name), clearActiveTable(), seatToken (getter)
 *   broadcastState(state), sendGameAction(action, payload), sendChat(message)
 *   syncState(), getServerUrl(), disconnect()
 */
function GameNetwork() {
    'use strict';

    var LS_LIST = 'cribbage_tables';
    var LS_PLAYER = 'cribbage_player_id';
    var LS_TABLE = 'cribbage_active_table';
    var LS_BROADCAST = 'cribbage_broadcast_';
    var LS_CHAT = 'cribbage_chat_';
    var LS_STATE = 'cribbage_state_';

    var state = {
        playerId: null,
        playerName: null,
        serverUrl: null,
        mode: 'local',      // 'relay' | 'local'
        connected: false,
        tableId: null,
        seatToken: null
    };

    // A relay seat is keyed by this id. It must survive tab closes, refreshes
    // and browser restarts, otherwise "the same person" quietly becomes a new
    // player and loses their hand. Migrate the old tab-scoped id once.
    function makePlayerId() {
        try {
            if (window.crypto && typeof window.crypto.randomUUID === 'function') {
                return 'p_' + window.crypto.randomUUID();
            }
        } catch (e) {}
        return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 12);
    }

    function loadPlayerId() {
        var id = null;
        try { id = localStorage.getItem(LS_PLAYER); } catch (e) {}
        if (!id) {
            try { id = sessionStorage.getItem(LS_PLAYER); } catch (e) {}
            if (id) { try { localStorage.setItem(LS_PLAYER, id); } catch (e) {} }
        }
        if (!id) {
            id = makePlayerId();
            try { localStorage.setItem(LS_PLAYER, id); } catch (e) {}
        }
        return id;
    }

    function loadActiveRecord() {
        try {
            var raw = localStorage.getItem(LS_TABLE);
            if (!raw) return null;
            var data = JSON.parse(raw);
            if (!data || data.playerId !== state.playerId || !data.tableId) return null;
            return data;
        } catch (e) { return null; }
    }

    function loadActiveTable() {
        var record = loadActiveRecord();
        return record ? record.tableId : null;
    }

    function saveActiveTable(tableId, seatToken, left) {
        if (!tableId) { clearActiveTable(); return; }
        try {
            localStorage.setItem(LS_TABLE, JSON.stringify({
                tableId: tableId,
                playerId: state.playerId,
                seatToken: seatToken || null,
                left: !!left,
                at: Date.now()
            }));
        } catch (e) {}
    }

    function clearActiveTable() {
        try { localStorage.removeItem(LS_TABLE); } catch (e) {}
        state.seatToken = null;
    }

    var listeners = new Map();
    function on(event, cb) { if (!listeners.has(event)) listeners.set(event, []); listeners.get(event).push(cb); return cb; }
    function off(event, cb) { var a = listeners.get(event); if (!a) return; var i = a.indexOf(cb); if (i !== -1) a.splice(i, 1); }
    function emit(event, data) { var a = listeners.get(event); if (!a) return; a.slice().forEach(function (cb) { try { cb(data); } catch (e) {} }); }

    function serverUrl() {
        if (state.serverUrl) return state.serverUrl;
        var loc = window.location;
        if (loc.protocol === 'http:' || loc.protocol === 'https:') return loc.origin;
        return 'http://localhost:8080';
    }

    function post(path, body) {
        return fetch(serverUrl() + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body || {})
        }).then(function (r) { return r.json().catch(function () { return { ok: false }; }); })
          .catch(function () { return { ok: false, error: 'no connection' }; });
    }

    function readList() {
        try { var raw = localStorage.getItem(LS_LIST); return raw ? JSON.parse(raw) : []; } catch (e) { return []; }
    }
    function writeList(list) {
        try { localStorage.setItem(LS_LIST, JSON.stringify(list)); localStorage.setItem(LS_BROADCAST + 'list', JSON.stringify({ at: Date.now(), tables: list })); } catch (e) {}
    }
    function localBroadcast() {
        try { localStorage.setItem(LS_BROADCAST + 'tables', JSON.stringify({ at: Date.now(), tables: readList() })); } catch (e) {}
    }

    var listCache = [];
    var stateCache = null;
    var chatCache = [];
    var es = null;

    // -----------------------------------------------------------------------
    // Relay (EventSource + POST)
    // -----------------------------------------------------------------------
    function connectRelay() {
        var url = serverUrl();
        var q = 'playerId=' + encodeURIComponent(state.playerId)
            + '&seatToken=' + encodeURIComponent(state.seatToken || '')
            + '&tableId=' + encodeURIComponent(state.tableId || '');
        if (es) es.close();
        es = new EventSource(url + '/api/stream?' + q);

        es.addEventListener('tableList', function (ev) {
            try {
                listCache = JSON.parse(ev.data);
                // A saved table can disappear when the relay restarts. Drop the
                // stale resume target so we never replay a ghost seat.
                if (state.tableId && !listCache.some(function (t) {
                    return t.id === state.tableId && (t.players || []).some(function (p) { return p.id === state.playerId; });
                })) {
                    clearActiveTable();
                    state.tableId = null;
                    connectRelay();
                    return;
                }
                emit('tableList', listCache);
            } catch (e) {}
        });
        es.addEventListener('state', function (ev) {
            try {
                var d = JSON.parse(ev.data);
                if (d.tableId === state.tableId) { stateCache = d.state; emit('state', d.state); }
            } catch (e) {}
        });
        es.addEventListener('roster', function (ev) {
            try { emit('roster', JSON.parse(ev.data)); } catch (e) {}
        });
        es.addEventListener('chat', function (ev) {
            try {
                var d = JSON.parse(ev.data);
                if (d.tableId === state.tableId) { chatCache = d.messages || []; emit('chat', { messages: chatCache }); }
            } catch (e) {}
        });
        es.onopen = function () { state.connected = true; emit('connected', { playerId: state.playerId, mode: 'relay' }); };
        es.onerror = function () { state.connected = false; emit('disconnected', { mode: 'relay' }); };
    }

    function postRelay(path, body) { return post(path, body); }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------
    // Static hosts are decided by config.js so this file and wallet.js can
    // never disagree. Falls back to the old github.io check if a stale cached
    // config.js predates the predicate.
    function isStaticHost(hostname) {
        var cfg = window.LITECRIB_CONFIG;
        if (cfg && typeof cfg.isStaticHost === 'function') return cfg.isStaticHost(hostname);
        return String(hostname || '').endsWith('.github.io');
    }

    function connect() {
        state.serverUrl = isStaticHost(window.location.hostname)
            ? ((window.LITECRIB_CONFIG || {}).relayUrl || '').replace(/\/+$/, '') || null
            : null;
        state.playerId = loadPlayerId();
        var active = loadActiveRecord();
        state.tableId = active ? active.tableId : null;
        state.seatToken = active ? active.seatToken || null : null;

        // Pages has no relay API. Do not delay browser play on an API probe.
        if (!state.serverUrl && isStaticHost(window.location.hostname)) {
            state.mode = 'local';
            state.connected = true;
            listCache = [];
            emit('connected', { playerId: state.playerId, mode: 'local' });
            emit('tableList', listCache);
            return Promise.resolve({ playerId: state.playerId, mode: state.mode });
        }
        var rel = null;
        return fetch(serverUrl() + '/api/health', { method: 'GET', signal: AbortSignal.timeout(60000) })
            .then(function (r) { if (!r.ok) throw new Error('Relay unavailable'); return r.json(); })
            .then(function (health) { rel = health.multiplayerProtocol === 1; })
            .catch(function () { rel = false; })
            .then(function () {
                if (rel) {
                    state.mode = 'relay';
                    connectRelay();
                } else {
                    state.mode = 'local';
                    state.connected = true;
                    listCache = [];
                    emit('connected', { playerId: state.playerId, mode: 'local' });
                    emit('tableList', listCache);
                }
                return { playerId: state.playerId, mode: state.mode };
            });
    }

    function onStorage(e) {
        if (!e.newValue) return;
        if (e.key === LS_LIST) { listCache = readList(); emit('tableList', listCache); }
        else if (e.key.indexOf(LS_BROADCAST) === 0) { emit('tableList', readList()); }
    }

    function getTableList() { return listCache; }
    function getTableState() { return stateCache; }
    function getConnectionStatus() {
        return { connected: state.connected, mode: state.mode, serverUrl: state.serverUrl || serverUrl(), playerId: state.playerId, tableId: state.tableId };
    }
    function getServerUrl() { return serverUrl(); }

    function createTable(mode, name) {
        if (state.mode === 'relay') {
            return post('/api/tables', { mode: mode, name: name, playerId: state.playerId }).then(function (res) {
                if ((res.ok || res.success) && res.tableId) {
                    state.tableId = res.tableId;
                    state.seatToken = res.seatToken || state.seatToken;
                    saveActiveTable(res.tableId, state.seatToken);
                    listCache = listCache.filter(function (t) { return t.id !== res.tableId; }).concat([res.table]);
                    emit('tableList', listCache);
                    connectRelay();
                }
                return res;
            });
        }
        return Promise.resolve({ success: false, error: 'Human tables need a live multiplayer relay. This site is in solo mode. Open the game on the shared relay server to host or join a human table.' });
    }

    function joinTable(tableId, name) {
        if (state.mode === 'relay') {
            return post('/api/tables/' + tableId + '/join', {
                playerId: state.playerId,
                seatToken: state.seatToken,
                name: name || state.playerName
            }).then(function (res) {
                if (res.ok || res.success) {
                    state.tableId = tableId;
                    state.seatToken = res.seatToken || state.seatToken;
                    saveActiveTable(tableId, state.seatToken);
                    connectRelay();
                }
                return res;
            });
        }
        return Promise.resolve({ success: false, error: 'Connect to the multiplayer relay to join a human table.' });
    }

    // Called on every page load. The relay seat and private hand are keyed by
    // the durable playerId, so an idempotent rejoin is all that is needed to
    // put the same person back in their original seat.
    function resumeActiveTable(name) {
        var active = loadActiveRecord();
        if (!active || state.mode !== 'relay') {
            return Promise.resolve({ success: false, skipped: true });
        }
        state.playerName = name || state.playerName || null;
        state.seatToken = active.seatToken || null;
        return joinTable(active.tableId, state.playerName).then(function (res) {
            if ((res.success || res.ok) && state.tableId) return syncState().then(function () { return res; });
            if (res.code === 'SEAT_TOKEN_REQUIRED') {
                // This browser lost its seat secret (cleared storage or an old
                // cache). Do not leave a ghost resume target in localStorage.
                clearActiveTable();
                state.tableId = null;
                connectRelay();
            }
            return res;
        });
    }

    function leaveTable() {
        if (state.mode === 'relay' && state.tableId) {
            var leaving = state.tableId;
            return post('/api/tables/' + leaving + '/leave', { playerId: state.playerId, seatToken: state.seatToken }).then(function (res) {
                if ((res.ok || res.success) && state.seatToken) {
                    // Keep the claim secret. Backing out marks the seat away,
                    // but this browser must still be able to sit back down.
                    saveActiveTable(leaving, state.seatToken, true);
                }
                state.tableId = null;
                connectRelay();
                return res;
            });
        }
        var list = readList();
        for (var i = 0; i < list.length; i++) {
            if (list[i].id === state.tableId) {
                list[i].players = list[i].players.filter(function (p) { return p.id !== state.playerId; });
                if (list[i].players.length === 0) list.splice(i, 1);
                break;
            }
        }
        writeList(list);
        localBroadcast();
        emit('tableList', list);
        clearActiveTable();
        state.tableId = null;
        return Promise.resolve({ ok: true });
    }

    function broadcastState(value) {
        if (state.mode === 'relay' && state.tableId) {
            return post('/api/tables/' + state.tableId + '/state', { playerId: state.playerId, seatToken: state.seatToken, state: value }).then(function (res) {
                if (res.ok && res.state) stateCache = res.state;
                return res;
            });
        }
        stateCache = value;
        var list = readList();
        for (var i = 0; i < list.length; i++) {
            if (list[i].id === state.tableId) { list[i].state = value; break; }
        }
        writeList(list);
        localBroadcast();
        emit('state', value);
        return Promise.resolve({ ok: true });
    }

    function sendGameAction(action, payload) {
        return post('/api/tables/' + state.tableId + '/action', { action: action, payload: payload || {}, playerId: state.playerId, seatToken: state.seatToken }).then(function (res) {
            if (res.success && res.state) { stateCache = res.state; emit('state', res.state); }
            return res;
        });
    }

    function sendChat(message) {
        if (state.mode === 'relay') {
            return post('/api/tables/' + state.tableId + '/chat', { playerId: state.playerId, seatToken: state.seatToken, message: message }).then(function (res) { return res; });
        }
        var list = readList();
        for (var i = 0; i < list.length; i++) {
            if (list[i].id === state.tableId) {
                list[i].chat = list[i].chat || [];
                list[i].chat.push({ playerId: state.playerId, name: state.playerName, message: message, at: Date.now() });
                break;
            }
        }
        writeList(list);
        localBroadcast();
        emit('chat', { messages: (function () { for (var i = 0; i < list.length; i++) if (list[i].id === state.tableId) return list[i].chat; return []; })() });
        return Promise.resolve({ ok: true });
    }

    function syncState() {
        if (state.mode === 'relay' && state.tableId) {
            return post('/api/tables/' + state.tableId + '/state', { playerId: state.playerId, seatToken: state.seatToken, pull: true }).then(function (res) {
                if (res.ok && res.state) { stateCache = res.state; emit('state', res.state); }
                return res;
            });
        }
        return Promise.resolve({ ok: true, state: stateCache });
    }

    function disconnect() {
        if (es) { es.close(); es = null; }
        state.connected = false;
        emit('disconnected', { mode: state.mode });
    }

    var net = {
        connect: connect,
        on: on,
        off: off,
        emit: emit,
        getServerUrl: getServerUrl,
        getConnectionStatus: getConnectionStatus,
        getTableList: getTableList,
        getTableState: getTableState,
        createTable: createTable,
        joinTable: joinTable,
        resumeActiveTable: resumeActiveTable,
        leaveTable: leaveTable,
        clearActiveTable: clearActiveTable,
        broadcastState: broadcastState,
        sendGameAction: sendGameAction,
        sendChat: sendChat,
        syncState: syncState,
        disconnect: disconnect
    };

    ['playerId', 'playerName', 'tableId', 'seatToken', 'connected'].forEach(function (key) {
        Object.defineProperty(net, key, { get: function () { return state[key]; } });
    });
    return net;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { GameNetwork: GameNetwork };
} else {
    window.GameNetwork = GameNetwork;
}
