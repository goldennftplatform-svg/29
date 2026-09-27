/*
 * LITEcrib points-economy e2e — provider aggregator, credit claims (mocked
 * indexer), PvP escrow + settlement with the < 1% house fee, fee ledger and
 * admin stats. In-process server, temp store; the indexer is faked so claim
 * math is deterministic (0.42 LTC confirmed -> 420 pts at 1000 pts/tLTC).
 */
'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');

const TMP = os.tmpdir() + path.sep + 'litecrib-credits-' + Date.now();
process.env.LITECRIB_STORE_FILE = TMP + '.users.json';
process.env.LITECRIB_MATCH_FILE = TMP + '.matches.json';
process.env.LITECRIB_ADMIN_TOKEN = 'test-admin-token';

const http = require('http');
const assert = require('assert');

const PORT = 18101;
const BASE = 'http://localhost:' + PORT + '/api/';

function req(method, api, { body, token } = {}) {
    return new Promise((resolve, reject) => {
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers.Authorization = 'Bearer ' + token;
        const r = http.request(BASE + api, { method, headers }, (res) => {
            let d = '';
            res.on('data', (c) => { d += c; });
            res.on('end', () => {
                let parsed = null;
                try { parsed = JSON.parse(d); } catch (e) { parsed = d; }
                resolve({ status: res.statusCode, body: parsed });
            });
        });
        r.on('error', reject);
        if (body) r.write(JSON.stringify(body));
        r.end();
    });
}

(async () => {
    const LTC = require('../payments.js');
    LTC.providers.net.jsonRequest = async (url, opts) => {
        if (String(url).includes('/utxo')) {
            return [{ txid: 'a'.repeat(64), vout: 0, value: 42000000, status: { confirmed: true } }];
        }
        if (String(url).includes('/fees/recommended')) return { fastestFee: 2, halfHourFee: 1, hourFee: 1 };
        if (String(url).endsWith('/tx') && opts && opts.method === 'POST') return 'mock-broadcast-txid';
        return [];
    };
    LTC.providers.net.nodeRpc = async () => { throw new Error('rpc not used in this test'); };

    const { server } = require('../server.js');
    await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));

    const results = [];
    const ok = (name, cond, extra) => {
        results.push(!!cond);
        console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra != null ? '  (' + extra + ')' : ''));
    };

    // 1) pricing + provider registry surface exactly per spec
    const cfg = await req('GET', 'wallet/config');
    ok('pricing preset: $0.10 per point', cfg.body.pricing.pointsPerUsd === 10, '$' + (1 / cfg.body.pricing.pointsPerUsd) + '/pt');
    ok('pricing preset: $2 PvP entry = 20 pts', cfg.body.pricing.minPvpEntryUsd === 2 && cfg.body.pricing.minPvpEntryPoints === 20);
    ok('house fee under 1% of pot', cfg.body.pricing.houseFeeRate <= cfg.body.pricing.maxHouseFeeRate && cfg.body.pricing.houseFeeRate < 0.01, (cfg.body.pricing.houseFeeRate * 100) + '%');
    ok('aggregator lists 3 providers', Array.isArray(cfg.body.providers) && cfg.body.providers.length === 3, cfg.body.providers.map((p) => p.id).join(','));
    ok('LitVM provider pins LiteForge chain 4441', cfg.body.providers.some((p) => p.id === 'litvm' && p.chainId === 4441));

    // 2) register two players; claims mint points from mocked confirmed LTC
    const alice = await req('POST', 'auth/register', { body: { email: 'alice@ltc.dev', password: 'secret-pass-123' } });
    const bob = await req('POST', 'auth/register', { body: { email: 'bob@ltc.dev', password: 'secret-pass-123' } });
    ok('register gives credits 0', alice.body.user.credits === 0);
    ok('register surfaces LitVM address', /^0x[a-f0-9]{40}$/.test(alice.body.user.litvmAddress), alice.body.user.litvmAddress);

    const aliceToken = alice.body.token;
    const bobToken = bob.body.token;

    const preview = await req('GET', 'player/credits', { token: aliceToken });
    ok('0.42 LTC confirmed -> 420 pts claimable', preview.body.claimablePts === 420, preview.body.claimablePts + ' pts');

    const claim1 = await req('POST', 'player/credits/claim', { token: aliceToken });
    ok('claim mints 420 pts', claim1.body.mintedPts === 420 && claim1.body.credits === 420);

    const claim2 = await req('POST', 'player/credits/claim', { token: aliceToken });
    ok('re-claim is idempotent (0 minted, marker saved)', claim2.body.mintedPts === 0, 'minted ' + claim2.body.mintedPts);

    const claimBob = await req('POST', 'player/credits/claim', { token: bobToken });
    ok('bob claims 420 too', claimBob.body.credits === 420);

    // 3) provider preference flips and persists to /me
    const provs = await req('GET', 'wallet/providers', { token: aliceToken });
    ok('provider list default is custodial', provs.body.preferred === 'custodial' && provs.body.providers.length === 3);

    const putP = await req('PUT', 'wallet/provider', { token: aliceToken, body: { provider: 'litvm' } });
    ok('provider PUT accepted', putP.status === 200 && putP.body.preferred === 'litvm');
    const putBad = await req('PUT', 'wallet/provider', { token: aliceToken, body: { provider: 'nope' } });
    ok('unknown provider rejected', putBad.status === 400);
    const meP = await req('GET', 'auth/me', { token: aliceToken });
    ok('preference persisted on /me', meP.body.user.preferredProvider === 'litvm');

    // 4) PvP vs AI: 20 pts escrow, house takes 0.1 pts on a 20-pt pot
    const ai = await req('POST', 'games/match', { token: aliceToken, body: { mode: 'ai' } });
    ok('AI match escrows 20 pts', ai.status === 200 && ai.body.match.pot === 20 && ai.body.match.entry === 20, 'pot ' + ai.body.match.pot);
    const aiRes = await req('POST', 'games/match/' + ai.body.match.id + '/resolve', { token: aliceToken, body: {} });
    ok('AI match settles with 0.5% house fee', aiRes.body.match.fee === 0.1 && aiRes.body.match.payout === 19.9, 'fee ' + aiRes.body.match.fee);
    ok('credits after AI game: 420 - 20 + 19.9 = 419.9', aiRes.body.match.state === 'settled');

    const meAfter = await req('GET', 'auth/me', { token: aliceToken });
    ok('alice ends at 419.9 pts', meAfter.body.user.credits === 419.9, meAfter.body.user.credits + ' pts');

    const aiDup = await req('POST', 'games/match/' + ai.body.match.id + '/resolve', { token: aliceToken, body: {} });
    ok('double-settle refused (409)', aiDup.status === 409, 'status ' + aiDup.status);

    // 5) PvP: both escrow, winner walks with pot - fee, loser forfeits entry
    const pvp = await req('POST', 'games/match', { token: aliceToken, body: { opponentId: bob.body.user.id, mode: 'pvp' } });
    ok('PvP pot is both entries (40)', pvp.status === 200 && pvp.body.match.pot === 40 && pvp.body.match.players.length === 2);

    const pvpRes = await req('POST', 'games/match/' + pvp.body.match.id + '/resolve', { token: aliceToken, body: { winnerId: alice.body.user.id } });
    ok('PvP fee = 0.2 pts (0.5% of 40), winner gets 39.8', pvpRes.body.match.fee === 0.2 && pvpRes.body.match.payout === 39.8, 'fee ' + pvpRes.body.match.fee + ' payout ' + pvpRes.body.match.payout);

    const meBob = await req('GET', 'auth/me', { token: bobToken });
    ok('loser keeps only non-escrowed balance (400)', meBob.body.user.credits === 400, meBob.body.user.credits);

    // 6) insufficient balance refuses entry
    const ok1 = await req('POST', 'auth/register', { body: { email: 'poor@ltc.dev', password: 'secret-pass-123' } });
    const poor = await req('POST', 'games/match', { token: ok1.body.token, body: { mode: 'ai' } });
    ok('no credits -> 402, entry costs $2 of points', poor.status === 402, 'status ' + poor.status);

    // 7) fee ledger + admin stats roll up generation & house fees in USD
    const fees = await req('GET', 'player/fees', { token: aliceToken });
    ok('alice generated $0.60 of play, $0.03 of fees', fees.body.totalGenerationPts === 60 && fees.body.totalFeesPts === 0.3, fees.body.usd.generation + ' gen / ' + fees.body.usd.fees + ' fees');
    ok('fees ledger lists games', Array.isArray(fees.body.games) && fees.body.games.length >= 2);

    const statsNo = await req('GET', 'admin/stats');
    ok('admin stats needs token (401)', statsNo.status === 401);
    const stats = await req('GET', 'admin/stats', { token: 'test-admin-token' });
    ok('admin stats: 2 matches, $0.60 generation, fees < 1% of gen', stats.body.matches.total === 2 && stats.body.economy.generationPts === 60 && stats.body.economy.feesPts === 0.3 && stats.body.economy.feesPts < stats.body.economy.generationPts * 0.01, stats.body.economy.feesPts + ' fees / ' + stats.body.economy.generationPts + ' gen');

    server.close();
    fs.unlinkSync(process.env.LITECRIB_STORE_FILE);
    fs.unlinkSync(process.env.LITECRIB_MATCH_FILE);

    const fails = results.filter((x) => !x);
    console.log(fails.length ? '\n' + fails.length + ' assertions FAILED' : '\nall credits/economy assertions passed');
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('CREDITS TEST CRASH:', e); process.exit(2); });