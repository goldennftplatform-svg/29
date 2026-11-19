'use strict';

// Real relay, independent players: publish, discover, sit, back out, reclaim
// the exact same seat and hand, then play a hand.
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
    const tokens = {};
    const seat = id => ({ playerId: id, seatToken: tokens[id] });

    assert.equal((await request('/api/health')).multiplayerProtocol, 1);
    const created = await request('/api/tables', { mode: '1v1', name: 'HOST', playerId: 'host' });
    assert.equal(created.success, true);
    assert.equal(created.table.players[0].id, 'host');
    assert.ok(created.seatToken, 'the host receives a server-issued seat secret');
    tokens.host = created.seatToken;

    const root = '/api/tables/' + created.tableId;
    const listing = await request('/api/tables');
    assert.equal(listing.tables[0].id, created.tableId);
    assert.equal(listing.tables[0].players.length, 1);
    assert.equal(listing.tables[0].players[0].seatToken, undefined, 'seat secrets are never published in the lobby');
    assert.equal((await request(root + '/state', { pull: true, ...seat('host') })).state.phase, 'WAITING');
    assert.equal((await request(root + '/state', { playerId: 'host', pull: true, seatToken: 'forged' })).status, 403, 'a forged secret cannot read another hand');

    const joined = await request(root + '/join', { name: 'GUEST', playerId: 'guest' });
    assert.equal(joined.success, true);
    assert.ok(joined.seatToken, 'the guest receives their own seat secret');
    tokens.guest = joined.seatToken;
    assert.notEqual(tokens.guest, tokens.host);
    assert.equal((await request(root + '/join', { name: 'GUEST', ...seat('guest') })).success, true);
    assert.equal((await request(root + '/join', { name: 'GUEST', playerId: 'guest', seatToken: 'forged' })).code, 'SEAT_TOKEN_REQUIRED', 'a stranger cannot reclaim a known seat');
    assert.equal((await request(root + '/join', { name: 'THIRD', playerId: 'third' })).status, 409);

    // Backing out must not lose game data. The seat and private hand stay in
    // the same engine index; only the browser holding the seat secret can
    // reclaim them.
    const guestBeforeLeave = (await request(root + '/state', { pull: true, ...seat('guest') })).state;
    assert.equal((await request(root + '/leave', seat('guest'))).success, true);
    const guestAway = (await request(root + '/state', { pull: true, ...seat('guest') })).state;
    assert.deepEqual(guestAway.hand, guestBeforeLeave.hand, 'leaving must keep the dealt hand');
    assert.equal(guestAway.players[1].left, true, 'the seat is held as away, not deleted');
    assert.equal((await request(root + '/state', { playerId: 'guest', pull: true })).status, 403, 'an away seat still requires its secret');
    assert.equal((await request(root + '/action', { ...seat('guest'), action: 'go' })).status, 403, 'an away seat cannot act');
    const reclaimed = await request(root + '/join', { name: 'GUEST', ...seat('guest') });
    assert.equal(reclaimed.resumed, true, 'same identity and secret resume the same seat');
    assert.deepEqual(
        (await request(root + '/state', { pull: true, ...seat('guest') })).state.hand,
        guestBeforeLeave.hand,
        'rejoin restores the original private hand'
    );

    let state = (await request(root + '/state', { pull: true, ...seat('host') })).state;
    const guest = (await request(root + '/state', { pull: true, ...seat('guest') })).state;
    assert.equal(state.phase, 'DISCARD');
    assert.equal(state.hand.length, 6);
    assert.equal(guest.hand.length, 6);
    assert.ok(state.hand.every(card => !guest.hand.includes(card)));
    assert.ok(state.players.every(player => !player.hand));
    assert.equal((await request(root + '/action', { playerId: 'outsider', action: 'go' })).status, 403);
    let current = state.players[state.currentPlayer].id;
    assert.equal((await request(root + '/action', { ...seat(current), action: 'discard', payload: { cardIndices: [0, 0] } })).status, 400);
    for (let i = 0; i < 2; i++) {
        current = state.players[state.currentPlayer].id;
        const result = await request(root + '/action', { ...seat(current), action: 'discard', payload: { cardIndices: [0, 1] } });
        assert.equal(result.success, true);
        state = result.state;
    }
    assert.equal(state.phase, 'PLAY');
    current = state.players[state.currentPlayer].id;
    const played = await request(root + '/action', { ...seat(current), action: 'play', payload: { cardIndex: 0 } });
    assert.equal(played.success, true);
    const hostView = (await request(root + '/state', { pull: true, ...seat('host') })).state;
    const guestView = (await request(root + '/state', { pull: true, ...seat('guest') })).state;
    assert.deepEqual(hostView.playPile, guestView.playPile);
    assert.equal(hostView.playPile.length, 1);
    assert.equal(hostView.playCount, guestView.playCount);
    const { Card } = require('../cribbage-engine');
    state = played.state;
    let moves = 0;
    while (state.phase !== 'DISCARD' && moves++ < 50) {
        const playerId = state.players[state.currentPlayer].id;
        state = (await request(root + '/state', { pull: true, ...seat(playerId) })).state;
        const cardIndex = state.hand.findIndex(card => Card.fromString(card).value + state.playCount <= 31);
        const action = state.phase === 'PLAY' ? (cardIndex === -1 ? 'go' : 'play') : 'count';
        const next = await request(root + '/action', { ...seat(playerId), action, payload: { cardIndex } });
        assert.equal(next.success, true, JSON.stringify(next));
        state = next.state;
    }
    assert.equal(state.phase, 'DISCARD', 'both humans must be able to finish a round and receive the next deal');
    console.log('PASS: human table publishing, seat secrets, back-out/rejoin hand recovery, private hands, synchronized play and next round');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
    server.closeAllConnections();
    server.close();
    fs.rmSync(temp, { recursive: true, force: true });
});
