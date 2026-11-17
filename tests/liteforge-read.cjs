'use strict';
// Read-only live check: catches an obsolete RPC or a lost deployment.
const assert = require('node:assert/strict');
const deployment = require('../practice-deployment.json');
const artifact = require('../wallet-assets/practice-contract.json');
const address = '0x0000000000000000000000000000000000000001';
async function rpc(method, params = []) {
    const response = await fetch('https://rpc.testnet.liteforge.zeeve.net/', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://29.aisp.live' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(15000)
    });
    assert.equal(response.ok, true, 'RPC HTTP response');
    const body = await response.json();
    assert.equal(body.error, undefined, JSON.stringify(body.error));
    return body.result;
}
(async () => {
    assert.equal(await rpc('eth_chainId'), '0x1159');
    assert.equal(await rpc('eth_getCode', [deployment.address, 'latest']), artifact.runtime);
    assert.ok(BigInt(await rpc('eth_getBalance', [address, 'latest'])) >= 0n);
    assert.equal(BigInt(await rpc('eth_call', [{ to: deployment.address, data: artifact.depositsSelector + address.slice(2).padStart(64, '0') }, 'latest'])), 0n);
    console.log('PASS: LiteForge chain 4441, exact practice bytecode, balance and deposit reads');
})().catch(error => { console.error(error); process.exitCode = 1; });
