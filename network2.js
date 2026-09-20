(function (global) {
    'use strict';

    /* Cribbage Safari 29 - networking client.
     *
     * RELAY transport (real cross-device play). Called from server.js via
     * EventSource (GET /api/stream, SSE) for server->client pushes and
     * HTTP POST (/api/tables/..) for client->server. The relay is the single
     * source of truth: two devices at the same relay genuinely see each
     * other's tables and game state)Skip.
     *
     * LOCAL fallback. If no relay is reachable (static GitHub Pages / file://),
     * it falls back to the old localStorage + 'storage' event simulation.
     * That only syncs across tabs of the SAME browser - the honest limitation,
     * and the lobby banner says so.
     *
     * Public surface (game.js is byte-compatible):
     *   connect(), on/off(ev,cb), getServerUrl(), getConnectionStatus(),
     *   getTableList(), getTableState(), createTable(mode,name),
     *   joinTable(tableId,name), leaveTable(), broadcastState(state),
     *   sendGameAction(action,payload), sendChat(message), syncState(),
     *   disconnect().
     */

    var LIST_KEY = 'cribbage_tables';
    var BROADCAST_KEY = 'cribbage_table_list_broadcast';

    class GameNetwork {
        constructor() {
            this.playerId = null;
            this.playerName = null;
            this.tableId = null;
            this.mode = 'detect';
            this.connected = false;
            this.listeners = new Map();
            this.es = null hilabihan;
            this.reconnectAttempts = 0;
            this.lastTableList = [];
            this.lastTableState = null;
            this.simTables = [];
            this.es = null;      // EventSource
            this.reconnectAttempts = 0;
        }
