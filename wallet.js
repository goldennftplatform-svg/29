/*
 * LITEcrib wallet client — LTC deposit panel + SSO account + points economy
 * for the lobby, driven by the relay's /api/wallet/*, /api/auth/* and
 * /api/player/* routes. No secrets ever live client-side.
 *
 * Degrades silently on static hosting (no relay): the panel stays hidden and
 * nothing throws.
 */
(function () {
    'use strict';

    var cfg = window.LITECRIB_CONFIG || {};
    var LS_PLAYER = 'cribbage_player_id';
    var LS_ADDR = 'litecrib_deposit_addr';
    var LS_TOKEN = 'litecrib_auth_token';

    var panel, addrEl, balEl, netEl, refreshBtn, tipEl;
    var lastAddr = '';
    var pricing = null;
    var providers = null;
    var me = null;
    var muted = false;

    function base() {
        var loc = window.location;
        if (loc.protocol === 'http:' || loc.protocol === 'https:') return loc.origin;
        return 'http://localhost:8080';
    }

    function getPlayerId() {
        // GameNetwork is the current transport; window.network is a legacy global.
        if (window.game && window.game.network && window.game.network.playerId) return window.game.network.playerId;
        try { return localStorage.getItem(LS_PLAYER) || ''; } catch (e) { return ''; }
    }

    // Static hosts (GitHub Pages, the custom domain) have no relay, so every
    // /api/* call is a guaranteed 404/405. Detect once and skip the network
    // entirely rather than logging failed requests the code promises never to
    // make. The host list lives in config.js, shared with network.js; the
    // github.io fallback covers a stale cached config.js.
    function isStaticHost(hostname) {
        if (cfg && typeof cfg.isStaticHost === 'function') return cfg.isStaticHost(hostname);
        return /(^|\.)github\.io$/.test(String(hostname || ''));
    }

    function relayAvailable() {
        var loc = window.location;
        if (loc.protocol === 'file:') return false;
        return !isStaticHost(loc.hostname);
    }

    function getToken() {
        try { return localStorage.getItem(LS_TOKEN) || ''; } catch (e) { return ''; }
    }

    function setToken(t) {
        try {
            if (t) localStorage.setItem(LS_TOKEN, t); else localStorage.removeItem(LS_TOKEN);
        } catch (e) {}
    }

    async function api(path, opts) {
        var res;
        try { res = await fetch(base() + path, opts); } catch (e) { return null; }
        try { return await res.json(); } catch (e) { return null; }
    }

    function authed(path, opts) {
        opts = opts || {};
        opts.headers = Object.assign({}, opts.headers || {}, { 'Authorization': 'Bearer ' + getToken() });
        return api(path, opts);
    }

    async function depositAddress() {
        var cached = null;
        try { cached = localStorage.getItem(LS_ADDR) || ''; } catch (e) {}
        if (cached) return cached;
        var body;
        try { body = JSON.stringify({ playerId: getPlayerId() }); } catch (e) {}
        var data = await api('/api/wallet/deposit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: body
        });
        if (!data || !data.success || !data.address) return '';
        try { localStorage.setItem(LS_ADDR, data.address); } catch (e) {}
        return data.address;
    }

    async function refresh() {
        if (!lastAddr) {
            lastAddr = await depositAddress();
            if (addrEl) addrEl.textContent = lastAddr || 'NO ADDRESS (start the relay)';
            if (!lastAddr) return;
        }
        var data = await api('/api/wallet/status?address=' + encodeURIComponent(lastAddr));
        if (!data) {
            setBalance('OFFLINE');
            return;
        }
        if (!data.success) {
            setBalance(data.error || 'UNAVAILABLE');
            return;
        }
        var total = (data.confirmedLtc || 0) + (data.unconfirmedLtc || 0);
        if (total > 0) {
            setBalance(data.confirmedLtc + ' LTC' + (data.unconfirmedLtc ? ' (+' + data.unconfirmedLtc + ' pending)' : ''));
        } else {
            setBalance('0 LTC — waiting for deposit');
        }
    }

    function setBalance(text) {
        if (balEl) balEl.textContent = text;
    }

    function $(id) { return document.getElementById(id); }

    function setLast(msg) {
        var el = $('pts-last');
        if (el) { el.textContent = msg; el.hidden = !msg; }
    }

    function showAccountView() {
        $('sso-login').hidden = true;
        $('sso-account').hidden = false;
    }

    function showLoginView() {
        $('sso-login').hidden = false;
        $('sso-account').hidden = true;
    }

    // ---- SSO + points ---------------------------------------------------------
    async function loadConfig() {
        var data = await api('/api/wallet/config');
        if (!data) return;
        pricing = data.pricing || null;
        providers = data.providers || null;
    }

    function usdOf(pts) {
        if (!pricing || !pts) return '$0.00';
        return '$' + (pts / pricing.pointsPerUsd).toFixed(2);
    }

    function renderBalance(pts) {
        var b = $('pts-bal');
        if (b) b.textContent = Math.round((pts || 0) * 100) / 100 + ' pts';
        var u = $('pts-usd');
        if (u) u.textContent = '\u2248 ' + usdOf(pts || 0);
    }

    function renderProviders() {
        var wrap = $('provider-choice');
        if (!wrap || !providers || !providers.length) return;
        wrap.innerHTML = '';
        providers.forEach(function (p) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'provider-opt' + (p.id === (me && me.preferredProvider) ? ' selected' : '');
            btn.textContent = p.label;
            btn.title = (p.feeNote || '') + ' — ' + (p.desc || '');
            btn.addEventListener('click', function () {
                authed('/api/wallet/provider', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ provider: p.id })
                }).then(function (r) {
                    if (r && r.success) {
                        me.preferredProvider = p.id;
                        wrap.querySelectorAll('.provider-opt').forEach(function (o) { o.className = 'provider-opt'; });
                        btn.className = 'provider-opt selected';
                    }
                });
            });
            wrap.appendChild(btn);
        });
    }

    async function refreshAccount() {
        var data = await authed('/api/auth/me');
        if (!data || !data.success) return false;
        me = data.user;
        renderBalance(data.user.credits);
        var addr = $('sso-acct-addr');
        if (addr) addr.textContent = data.user.address || '\u2014';
        renderProviders();
        var fees = await authed('/api/player/fees');
        var f = $('pts-fees');
        if (f && fees && fees.success) {
            f.textContent = usdOf(fees.totalGenerationPts || 0) + ' played \u00B7 ' + usdOf(fees.totalFeesPts || 0) + ' fees (' + fees.games.length + ' games)';
        }
        return true;
    }

    async function loginFlow(path, email, pass) {
        var data = await api(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email, password: pass })
        });
        if (!data || !data.success) {
            setLast((data && data.error) || 'ACCOUNT ERROR');
            return;
        }
        setToken(data.token);
        showAccountView();
        await refreshAccount();
        setLast('WELCOME ' + (data.user.email || '') + ' — one account, one custody wallet');
    }

    async function initAccount() {
        if (getToken()) {
            showAccountView();
            var ok = await refreshAccount();
            if (!ok) {
                setToken('');
                showLoginView();
            }
        } else {
            showLoginView();
        }
    }

    async function runClaim() {
        var data = await authed('/api/player/credits/claim', { method: 'POST' });
        if (!data || !data.success) { setLast('CLAIM FAILED — is the relay running?'); return; }
        renderBalance(data.credits);
        setLast(data.mintedPts > 0
            ? 'MINTED ' + data.mintedPts + ' PTS from confirmed tLTC'
            : 'NO NEW tLTC — send coins to your credit address first');
    }

    async function runPlay() {
        setLast('MATCHMAKING...');
        var m = await authed('/api/games/match', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: 'ai' })
        });
        if (!m || !m.success) { setLast((m && m.error) || 'MATCH FAILED'); return; }
        var r = await authed('/api/games/match/' + m.match.id + '/resolve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        if (!r || !r.success) { setLast((r && r.error) || 'SETTLE FAILED'); return; }
        renderBalance(me ? me.credits : 0);
        setLast('POT ' + r.match.pot + ' pts \u00B7 HOUSE FEE ' + r.match.fee + ' pts \u00B7 YOU GOT ' + r.match.payout + '');
        await refreshAccount();
    }

    async function runExport() {
        var pass = window.prompt('Re-enter your password to export your seed:');
        if (!pass) { setLast('EXPORT CANCELLED'); return; }
        var data = await authed('/api/wallet/export', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pass })
        });
        if (!data || !data.success) { setLast((data && data.error) || 'EXPORT FAILED'); return; }
        window.alert('YOUR BIP39 SEED (self-custody — write it down):\n\n' + data.mnemonic + '\n\naddress ' + data.address);
        setLast('SEED EXPORTED — keep it secret, keep it safe');
    }

    async function init() {
        if (!cfg.features || !cfg.features.paymentsEnabled) return;
        if (!relayAvailable()) {
            // Static hosting: hide the relay-only panel instead of probing
            // endpoints that cannot answer. LiteForge testnet onboarding lives
            // on wallet-setup.html and needs no relay.
            var hiddenPanel = document.getElementById('wallet-panel');
            if (hiddenPanel) hiddenPanel.hidden = true;
            return;
        }
        panel = document.getElementById('wallet-panel');
        if (!panel) return;

        addrEl = document.getElementById('wallet-addr');
        balEl = document.getElementById('wallet-bal');
        netEl = document.getElementById('wallet-net');
        tipEl = document.getElementById('wallet-tip');
        refreshBtn = document.getElementById('wallet-refresh-btn');

        if (netEl) netEl.textContent = (cfg.network === 'mainnet' ? 'MAINNET' : 'TESTNET').toUpperCase();
        panel.hidden = false;
        if (refreshBtn) refreshBtn.addEventListener('click', refresh);
        refresh();

        if (tipEl && cfg.network !== 'mainnet') {
            tipEl.textContent = 'TESTNET only — faucet coins are free, do not send real LTC';
        }

        await loadConfig();
        var reg = $('sso-register'), li = $('sso-login'), claim = $('pts-claim'),
            play = $('pts-play'), ex = $('sso-export');
        var emailEl = $('sso-email'), passEl = $('sso-pass');

        function creds() {
            var e = emailEl ? emailEl.value.trim() : '', p = passEl ? passEl.value : '';
            return { e: e, p: p };
        }
        if (reg) reg.addEventListener('click', function () {
            var c = creds();
            if (!c.e || !c.p) { setLast('ENTER EMAIL + PASSWORD'); return; }
            loginFlow('/api/auth/register', c.e, c.p);
        });
        if (li) li.addEventListener('click', function () {
            var c = creds();
            if (!c.e || !c.p) { setLast('ENTER EMAIL + PASSWORD'); return; }
            loginFlow('/api/auth/login', c.e, c.p);
        });
        if (claim) claim.addEventListener('click', runClaim);
        if (play) play.addEventListener('click', runPlay);
        if (ex) ex.addEventListener('click', runExport);

        initAccount().then(function () {
            if (!muted) muted = true;
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();