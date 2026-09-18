class GameNetwork {
    constructor() {
        this.ws = null;
        this.playerId = null;
        this.playerName = null;
        this.tableId = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        this.listeners = new Map();
        this.messageQueue = [];
        this.connected = false;
        this.serverUrl = this.getServerUrl();
    }

    getServerUrl() {
        // For GitHub Pages, we'll use a simple signaling approach
        // In production, this would be a WebSocket server
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
            ? 'localhost:8080' 
            : 'cribbage-safari-server.herokuapp.com'; // Placeholder
        return `${protocol}//${host}`;
    }

    connect() {
        return new Promise((resolve, reject) => {
            try {
                // For demo purposes, we'll simulate network with localStorage
                // In production, replace with actual WebSocket
                this.simulateConnection();
                resolve();
            } catch (e) {
                reject(e);
            }
        });
    }

    simulateConnection() {
        // Generate player ID
        this.playerId = 'player_' + Math.random().toString(36).substr(2, 9);
        this.connected = true;
        
        // Listen for localStorage events (simulating multiplayer)
        window.addEventListener('storage', (e) => this.handleStorageEvent(e));
        
        // Check for existing game state
        this.syncState();
        
        this.emit('connected', { playerId: this.playerId });
    }

    handleStorageEvent(e) {
        if (!e.key.startsWith('cribbage_')) return;
        
        try {
            const data = JSON.parse(e.newValue);
            if (data.type === 'state' && data.tableId === this.tableId) {
                this.emit('state', data.payload);
            } else if (data.type === 'chat' && data.tableId === this.tableId) {
                this.emit('chat', data.payload);
            } else if (data.type === 'table_list') {
                this.emit('tableList', data.payload);
            }
        } catch (err) {
            console.error('Network parse error:', err);
        }
    }

    syncState() {
        if (!this.tableId) return;
        const key = `cribbage_${this.tableId}`;
        const stored = localStorage.getItem(key);
        if (stored) {
            try {
                const data = JSON.parse(stored);
                this.emit('state', data);
            } catch (e) {}
        }
    }

    createTable(mode, playerName) {
        this.playerName = playerName;
        this.tableId = 'table_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        
        const tableData = {
            id: this.tableId,
            mode,
            players: [{ id: this.playerId, name: playerName, ready: true }],
            created: Date.now(),
            state: null
        };
        
        this.saveTableList([tableData]);
        this.saveTableState(tableData);
        
        return { tableId: this.tableId, playerId: this.playerId };
    }

    joinTable(tableId, playerName) {
        this.playerName = playerName;
        this.tableId = tableId;
        
        const tables = this.getTableList();
        const table = tables.find(t => t.id === tableId);
        if (!table) return { success: false, error: 'Table not found' };
        
        if (table.players.length >= (table.mode === '1v1' ? 2 : 3)) {
            return { success: false, error: 'Table full' };
        }
        
        const existingPlayer = table.players.find(p => p.id === this.playerId);
        if (!existingPlayer) {
            table.players.push({ id: this.playerId, name: playerName, ready: true });
            this.saveTableList(tables);
        }
        
        this.saveTableState(table);
        return { success: true, table };
    }

    leaveTable() {
        if (!this.tableId) return;
        
        const tables = this.getTableList();
        const tableIdx = tables.findIndex(t => t.id === this.tableId);
        if (tableIdx !== -1) {
            tables[tableIdx].players = tables[tableIdx].players.filter(p => p.id !== this.playerId);
            if (tables[tableIdx].players.length === 0) {
                tables.splice(tableIdx, 1);
            }
            this.saveTableList(tables);
        }
        
        localStorage.removeItem(`cribbage_${this.tableId}`);
        this.tableId = null;
    }

    sendGameAction(action, payload) {
        if (!this.tableId) return Promise.reject('Not at a table');
        
        const message = {
            type: 'action',
            tableId: this.tableId,
            playerId: this.playerId,
            action,
            payload,
            timestamp: Date.now()
        };
        
        // Store in localStorage for other players to pick up
        const actionKey = `cribbage_action_${this.tableId}_${Date.now()}`;
        localStorage.setItem(actionKey, JSON.stringify(message));
        
        // Clean up old actions
        this.cleanupOldActions();
        
        return Promise.resolve();
    }

    sendChat(message) {
        if (!this.tableId) return;
        
        const chat = {
            type: 'chat',
            tableId: this.tableId,
            playerId: this.playerId,
            playerName: this.playerName,
            message,
            timestamp: Date.now()
        };
        
        const key = `cribbage_chat_${this.tableId}_${Date.now()}`;
        localStorage.setItem(key, JSON.stringify(chat));
    }

    broadcastState(state) {
        if (!this.tableId) return;
        this.saveTableState({ ...this.getTableState(), state });
    }

    saveTableState(table) {
        localStorage.setItem(`cribbage_${this.tableId}`, JSON.stringify(table));
    }

    getTableState() {
        const stored = localStorage.getItem(`cribbage_${this.tableId}`);
        return stored ? JSON.parse(stored) : null;
    }

    getTableList() {
        const stored = localStorage.getItem('cribbage_tables');
        return stored ? JSON.parse(stored) : [];
    }

    saveTableList(tables) {
        // Only keep recent tables (last 50)
        const recent = tables.slice(-50);
        localStorage.setItem('cribbage_tables', JSON.stringify(recent));
        // Broadcast table list update
        localStorage.setItem('cribbage_table_list', JSON.stringify({
            type: 'table_list',
            payload: recent,
            timestamp: Date.now()
        }));
    }

    cleanupOldActions() {
        const keys = Object.keys(localStorage);
        const now = Date.now();
        keys.forEach(key => {
            if (key.startsWith('cribbage_action_') || key.startsWith('cribbage_chat_')) {
                const timestamp = parseInt(key.split('_').pop());
                if (now - timestamp > 300000) { // 5 minutes
                    localStorage.removeItem(key);
                }
            }
        });
    }

    // Event system
    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(callback);
    }

    off(event, callback) {
        if (!this.listeners.has(event)) return;
        const callbacks = this.listeners.get(event);
        const idx = callbacks.indexOf(callback);
        if (idx !== -1) callbacks.splice(idx, 1);
    }

    emit(event, data) {
        if (!this.listeners.has(event)) return;
        this.listeners.get(event).forEach(cb => cb(data));
    }

    disconnect() {
        this.leaveTable();
        window.removeEventListener('storage', this.handleStorageEvent);
        this.connected = false;
        this.emit('disconnected');
    }

    getConnectionStatus() {
        return this.connected;
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { GameNetwork };
} else {
    window.GameNetwork = GameNetwork;
}