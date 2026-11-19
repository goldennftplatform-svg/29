/*
 * LITEcrib payments — Litecoin deposits, status, payouts. SERVER-SIDE ONLY.
 *
 *   getDepositAddress(playerId) -> { address }         from the HD wallet (lit-wallet.js)
 *   getStatus(address)          -> { confirmedLtc, unconfirmedLtc, txCount, txs }
 *                                -> Litecoin Space indexer, or node RPC when configured
 *   payoutFromPlayer(...)       -> { txid }            PSBT-signed sweep/send (lit-wallet.js)
 *
 * Keys never leave the host: a single BIP39 seed (env LITECRIB_SEED) derives
 * every player address on account m/84'/2'/0/... and signs payouts. The RPC
 * / indexer are watch + broadcast only.
 *
 * The LitVM seam is now real: `litvm.settle()` below signs and broadcasts
 * contracts/Settlement.sol with the house key. The client still only ever
 * talks to /api/wallet/*, so the chain behind it stays invisible.
 */
'use strict';

const config = require('./config');
const net = require('./net');
const wallet = require('./lit-wallet');

// ---------------------------------------------------------------------------
// Status provider: Litecoin Space indexer (public), Core RPC as fallback.
// ---------------------------------------------------------------------------
async function getStatus(address) {
    const base = config.indexerBase;
    const [addr, txs] = await Promise.all([
        net.jsonRequest(base + '/address/' + encodeURIComponent(address)),
        net.jsonRequest(base + '/address/' + encodeURIComponent(address) + '/txs')
    ]);
    const confirmedLtc = (addr.chain_stats.funded_txo_sum - addr.chain_stats.spent_txo_sum) / 1e8;
    const unconfirmedLtc = (addr.mempool_stats.funded_txo_sum - addr.mempool_stats.spent_txo_sum) / 1e8;
    const list = (txs || []).map((t) => {
        let value = 0;
        (t.vout || []).forEach((o) => {
            if (o.scriptpubkey_address === address) value += o.value;
        });
        (t.vin || []).forEach((i) => {
            if (i.prevout && i.prevout.scriptpubkey_address === address) value -= i.prevout.value;
        });
        return { txid: t.txid, value: value / 1e8, confirmed: !!(t.status && t.status.confirmed) };
    });
    return { confirmedLtc, unconfirmedLtc, txCount: list.length, txs: list };
}

async function getStatusOrNode(address) {
    try {
        return await getStatus(address);
    } catch (e) {
        return net.nodeRpc('getreceivedbyaddress', [address, 1]).then((confirmed) => {
            return { confirmedLtc: (confirmed || 0), unconfirmedLtc: 0, txCount: 0, txs: [] };
        });
    }
}

// ---------------------------------------------------------------------------
// LitVM settlement — signs and broadcasts contracts/Settlement.sol `settle`.
//
// Chain-agnostic on purpose: nothing below hardcodes 4441, so LitVM mainnet is
// LITVM_CHAIN_ID + LITVM_RPC_URL + LITVM_SETTLEMENT_ADDRESS and no code change.
// The house key (LITVM_HOUSE_KEY) never leaves this module, the same rule as
// LITECRIB_SEED. No new dependency: secp256k1 comes from tiny-secp256k1 and
// keccak from js-sha3, both already in package.json.
// ---------------------------------------------------------------------------
const secp = require('tiny-secp256k1');
const { keccak_256 } = require('js-sha3');

const ENTRY_WEI = '1000000000000000';   // 0.001 zkLTC — mirrors Settlement.sol ENTRY
const STATE_FUNDED = 2;                  // MatchState enum in Settlement.sol
const SECP_N = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');

const SELECTOR = {
    matches: keccak_256('matches(bytes32)').slice(0, 8),
    hashOf: keccak_256('hashOf(bytes32,address)').slice(0, 8),
    settle: keccak_256('settle(bytes32,address,bytes)').slice(0, 8)
};

const strip = (h) => String(h == null ? '' : h).replace(/^0x/i, '').toLowerCase();
const pad32 = (h) => strip(h).padStart(64, '0');
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const addrWord = (a) => strip(a).padStart(64, '0');
const shortAddr = (w) => '0x' + w.slice(24);
const isHexKey = (k) => /^0x[0-9a-f]{64}$/i.test(String(k || ''));
const hexBuf = (h) => {
    const s = strip(h);
    if (!s || !/[1-9a-f]/.test(s)) return Buffer.alloc(0);
    return Buffer.from(s.length % 2 ? '0' + s : s, 'hex');
};
const intBuf = (n) => {
    const v = BigInt(n);
    if (v === 0n) return Buffer.alloc(0);
    let h = v.toString(16);
    if (h.length % 2) h = '0' + h;
    return Buffer.from(h, 'hex');
};
const wordsOf = (hex) => {
    const s = strip(hex);
    const out = [];
    for (let i = 0; i + 64 <= s.length; i += 64) out.push(s.slice(i, i + 64));
    return out;
};

// ---- RLP (legacy / EIP-155 transactions only) ------------------------------
function rlpBytesPrefix(len) {
    if (len <= 55) return Buffer.from([0x80 + len]);
    const l = intBuf(len);
    return Buffer.concat([Buffer.from([0xb7 + l.length]), l]);
}
function rlpListPrefix(len) {
    if (len <= 55) return Buffer.from([0xc0 + len]);
    const l = intBuf(len);
    return Buffer.concat([Buffer.from([0xf7 + l.length]), l]);
}
function rlpItem(b) {
    if (b.length === 1 && b[0] < 0x80) return b;
    return Buffer.concat([rlpBytesPrefix(b.length), b]);
}
function rlpList(items) {
    const body = Buffer.concat(items.map(rlpItem));
    return Buffer.concat([rlpListPrefix(body.length), body]);
}

// ---- tiny helpers ----------------------------------------------------------
function addressOf(priv) {
    const pub = Buffer.from(secp.pointFromScalar(priv, false));
    return '0x' + keccak_256(pub.slice(1)).slice(-40);
}

// keccak hash -> low-s { r, s (32B), rec }. ecrecover and the EVM both reject
// high-s, and tiny-secp256k1 may hand back either, so normalise once here.
function signHash(hash, priv) {
    const out = secp.signRecoverable(hash, priv);
    const sig = Buffer.from(out.signature);
    let s = BigInt('0x' + sig.slice(32).toString('hex'));
    let rec = Number(out.recoveryId) & 1;
    if (s > SECP_N >> 1n) { s = SECP_N - s; rec ^= 1; }
    return { r: sig.slice(0, 32), s32: Buffer.from(s.toString(16).padStart(64, '0'), 'hex'), rec };
}

function abiBytes(buf) {
    const hex = buf.toString('hex');
    const padded = hex + '0'.repeat((64 - (hex.length % 64)) % 64);
    return word(0x60) + word(buf.length) + padded;
}

let ethRpcId = 0;
async function ethRpc(method, params) {
    const rpc = process.env.LITVM_RPC_URL || litvm.config.rpcUrl;
    const res = await net.jsonRequest(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++ethRpcId, method, params: params || [] })
    });
    if (res && res.error) {
        throw new Error('LitVM ' + method + ': ' + (res.error.message || JSON.stringify(res.error)));
    }
    return res ? res.result : null;
}

const settlement = {
    address: process.env.LITVM_SETTLEMENT_ADDRESS || '',
    entryWei: ENTRY_WEI,
    get enabled() { return !!this.address && isHexKey(process.env.LITVM_HOUSE_KEY); },
    missing() {
        if (!this.address) return 'settlement disabled (set LITVM_SETTLEMENT_ADDRESS)';
        if (!isHexKey(process.env.LITVM_HOUSE_KEY)) return 'settlement disabled (set LITVM_HOUSE_KEY)';
        return '';
    }
};

// matches(bytes32) -> { a, b, deadline, state }
async function readMatch(matchId) {
    const gap = settlement.missing();
    if (gap) throw new Error(gap);
    const raw = await ethRpc('eth_call', [{
        to: settlement.address,
        data: '0x' + SELECTOR.matches + pad32(matchId)
    }, 'latest']);
    const w = wordsOf(raw);
    if (w.length < 4) throw new Error('unexpected matches() reply');
    return {
        a: shortAddr(w[0]),
        b: shortAddr(w[1]),
        deadline: Number(BigInt('0x' + w[2])),
        state: Number(BigInt('0x' + w[3]))
    };
}

// The house signature: refuses anything the contract itself would reject, so a
// bad call never reaches the chain.
async function signSettlement(matchId, winner) {
    const gap = settlement.missing();
    if (gap) throw new Error(gap);
    const m = await readMatch(matchId);
    if (m.state !== STATE_FUNDED) throw new Error('match is not funded (state ' + m.state + ')');
    const win40 = strip(winner);
    if (strip(m.a) !== win40 && strip(m.b) !== win40) {
        throw new Error('winner must be one of the two players');
    }

    // digest() wraps this in the EIP-191 prefix; signing digest() would double
    // prefix and ecrecover would return the wrong address.
    const inner = await ethRpc('eth_call', [{
        to: settlement.address,
        data: '0x' + SELECTOR.hashOf + pad32(matchId) + addrWord(winner)
    }, 'latest']);
    const hash = hexBuf(inner);
    if (hash.length !== 32) throw new Error('unexpected hashOf() reply');

    const priv = hexBuf(process.env.LITVM_HOUSE_KEY);
    const { r, s32, rec } = signHash(hash, priv);
    const sig = Buffer.concat([r, s32, Buffer.from([27 + rec])]);

    const recovered = '0x' + keccak_256(Buffer.from(secp.recover(hash, sig.slice(0, 64), rec)).slice(1)).slice(-40);
    if (strip(recovered) !== strip(addressOf(priv))) throw new Error('house signature self-check failed');

    return { signature: '0x' + sig.toString('hex'), match: m };
}

// Read + sign + broadcast in one call. Returns the txid the caller can show.
async function settle({ matchId, winner }) {
    const { signature } = await signSettlement(matchId, winner);
    const data = '0x' + SELECTOR.settle + pad32(matchId) + addrWord(winner) + abiBytes(hexBuf(signature));

    const priv = hexBuf(process.env.LITVM_HOUSE_KEY);
    const from = addressOf(priv);
    const nonce = await ethRpc('eth_getTransactionCount', [from, 'pending']);
    const gasPrice = await ethRpc('eth_gasPrice', []);
    let gas;
    try {
        gas = await ethRpc('eth_estimateGas', [{ from, to: settlement.address, data }]);
    } catch (e) {
        throw new Error('settle would revert on chain: ' + e.message);
    }

    const chainId = BigInt(litvm.config.chainId);
    const fields = [hexBuf(nonce), hexBuf(gasPrice), hexBuf(gas), hexBuf(settlement.address), hexBuf('0x0'), hexBuf(data)];
    const unsigned = rlpList(fields.concat([intBuf(chainId), Buffer.alloc(0), Buffer.alloc(0)]));
    const { r, s32, rec } = signHash(Buffer.from(keccak_256(unsigned), 'hex'), priv);
    const raw = rlpList(fields.concat([intBuf(chainId * 2n + 35n + BigInt(rec)), r, s32]));

    const txid = await ethRpc('eth_sendRawTransaction', ['0x' + raw.toString('hex')]);
    return { txid, matchId, winner, chainId: Number(chainId), explorer: litvm.config.explorer + '/tx/' + txid };
}

const litvm = {
    config: {
        chainId: Number(process.env.LITVM_CHAIN_ID || 4441),
        rpcUrl: process.env.LITVM_RPC_URL || 'https://rpc.testnet.liteforge.zeeve.net/',
        explorer: process.env.LITVM_EXPLORER || 'https://explorer.testnet.liteforge.zeeve.net',
        gasToken: 'zkLTC',
        settlement: settlement.address,
        live: false               // true when mainnet + audited bridge exist
    },
    status() {
        return {
            chainId: this.config.chainId,
            settlement: this.config.settlement,
            settlementReady: settlement.enabled,
            live: this.config.live,
            note: 'LitVM is testnet-only (LiteForge). Expect pipeline changes until mainnet.'
        };
    },
    settle,
    readMatch,
    signSettlement
};

// ---------------------------------------------------------------------------
// Public surface.
// ---------------------------------------------------------------------------
module.exports = {
    config: config.public(),
    litvm,
    getDepositAddress: (playerId) => ({ address: wallet.depositAddress(playerId) }),
    getStatus: async (address) => {
        try {
            return await getStatusOrNode(address);
        } catch (e) {
            return { confirmedLtc: 0, unconfirmedLtc: 0, txCount: 0, txs: [], error: e.message };
        }
    },
    balanceOfPlayer: (playerId) => wallet.balanceOf(playerId),
    userBalance: (mnemonic) => wallet.userBalanceFromMnemonic(mnemonic),
    issueUserWallet: () => wallet.issueUserWallet(),
    payoutFromPlayer: (playerId, toAddress, amountLtc, feerate) =>
        wallet.spendFromPlayer({ playerId, toAddress, amountLtc, feerate }),
    providers: { net, wallet }
};