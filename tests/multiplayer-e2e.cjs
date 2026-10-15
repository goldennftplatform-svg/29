'use strict';

// Real relay, independent players: publish, discover, sit, and play a hand.
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'litecrib-multiplayer-'));
process.env.LITECRIB_STORE_FILE = path.join(temp, 'users.json');
process.env.LITECRIB_MATCH_FILE = path.join(temp, 'matches.json');
const { server } = require('../server');

(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;
    async function request(route, body) {
        const response = await fetch(base + route, body ? {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        } : {});
        return { status: response.status, ...await response.json() };
    }
    assert.equal((await request('/api/health')).multiplayerProtocol, 1);
    const created = await request('/api/tables', { mode: '1v1', name: 'HOST', playerId: 'host' });
    assert.equal(created.success, true);
    assert.equal(created.table.players[0].id, 'host');
    const root = '/api/tables/' + created.tableId;
    const listing = await request('/api/tables');
    assert.equal(listing.tables[0].id, created.tableId);
    assert.equal(listing.tables[0].players.length, 1);
    assert.equal((await request(root + '/state', { playerId: 'host', pull: true })).state.phase, 'WAITING');
    assert.equal((await request(root + '/join', { name: 'GUEST', playerId: 'guest' })).success, true);
    assert.equal((await request(root + '/join', { name: 'GUEST', playerId: 'guest' })).success, true);
    assert.equal((await request(root + '/join', { name: 'THIRD', playerId: 'third' })).status, 409);
    let state = (await request(root + '/state', { playerId: 'host', pull: true })).state;
    const guest = (await request(root + '/state', { playerId: 'guest', pull: true })).state;
    assert.equal(state.phase, 'DISCARD');
    assert.equal(state.hand.length, 6);
    assert.equal(guest.hand.length, 6);
    assert.ok(state.hand.every(card => !guest.hand.includes(card)));
    assert.ok(state.players.every(player => !player.hand));
    assert.equal((await request(root + '/action', { playerId: 'outsider', action: 'go' })).status, 403);
    const current = state.players[state.currentPlayer].id;
    assert.equal((await request(root + '/action', { playerId: current, action: 'discard', payload: { cardIndices: [0, 0] } })).status, 400);
    for (let i = 0; i < 2; i++) {
        const result = await request(root + '/action', { playerId: state.players[state.currentPlayer].id, action: 'discard', payload: { cardIndices: [0, 1] } });
        assert.equal(result.success, true);
        state = result.state;
    }
    assert.equal(state.phase, 'PLAY');
    const played = await request(root + '/action', { playerId: state.players[state.currentPlayer].id, action: 'play', payload: { cardIndex: 0 } });
    assert.equal(played.success, true);
    const hostView = (await request(root + '/state', { playerId: 'host', pull: true })).state;
    const guestView = (await request(root + '/state', { playerId: 'guest', pull: true })).state;
    assert.deepEqual(hostView.playPile, guestView.playPile);
    assert.equal(hostView.playPile.length, 1);
    assert.equal(hostView.playCount, guestView.playCount);
    const { Card } = require('../cribbage-engine');
    state = played.state;
    let moves = 0;
    while (state.phase !== 'DISCARD' && moves++ < 50) {
        const playerId = state.players[state.currentPlayer].id;
        state = (await request(root + '/state', { playerId, pull: true })).state;
        const cardIndex = state.hand.findIndex(card => Card.fromString(card).value + state.playCount <= 31);
        const action = state.phase === 'PLAY' ? (cardIndex === -1 ? 'go' : 'play') : 'count';
        const next = await request(root + '/action', { playerId, action, payload: { cardIndex } });
        assert.equal(next.success, true, JSON.stringify(next));
        state = next.state;
    }
    assert.equal(state.phase, 'DISCARD', 'both humans must be able to finish a round and receive the next deal');
    console.log('PASS: human table publishing, discovery, stable seats, full-table guard, private hands, synchronized play and next round');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
    server.closeAllConnections();
    server.close();
    fs.rmSync(temp, { recursive: true, force: true });
});
