import fs from 'node:fs';
import assert from 'node:assert/strict';
import solc from 'solc';
import ganache from 'ganache';
import { createPublicClient, createWalletClient, custom, defineChain, keccak256, toBytes } from 'viem';

const source = fs.readFileSync('../contracts/PracticeDeposit.sol', 'utf8');
const output = JSON.parse(solc.compile(JSON.stringify({
    language: 'Solidity', sources: { 'PracticeDeposit.sol': { content: source } },
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } } }
})));
for (const e of output.errors || []) if (e.severity === 'error') throw new Error(e.formattedMessage);
const c = output.contracts['PracticeDeposit.sol'].PracticeDeposit;
const artifact = {
    abi: c.abi, bytecode: '0x' + c.evm.bytecode.object, runtime: '0x' + c.evm.deployedBytecode.object,
    depositTopic: keccak256(toBytes('Deposited(address,uint256)')),
    depositsSelector: keccak256(toBytes('deposits(address)')).slice(0,10), sourceCommit: process.env.GITHUB_SHA
};
// Isolated contract tests run only on GitHub, with ephemeral accounts.
const chain = defineChain({ id: 4441, name: 'CI', nativeCurrency: { name: 'Test', symbol: 'TEST', decimals: 18 }, rpcUrls: { default: { http: [] } } });
const provider = ganache.provider({ chain: { chainId: 4441 }, logging: { quiet: true } });
try {
    const reportedChainId = Number(await provider.request({ method: 'eth_chainId', params: [] }));
    assert.equal(reportedChainId, 4441, 'ganache must report chain ID 4441 for the LiteForge guard');
    const p = createPublicClient({ chain, transport: custom(provider), cacheTime: 0 });
    const w = createWalletClient({ chain, transport: custom(provider) });
    const [alice, bob] = await w.getAddresses();
    console.log('test accounts', alice, bob, 'chainId', reportedChainId);
    // Estimate first so a revert surfaces its reason instead of a bare receipt.
    try {
        await p.estimateGas({ account: alice, data: artifact.bytecode });
        console.log('deploy estimate OK');
    } catch (e) {
        console.log('DEPLOY ESTIMATE FAILED:', e.shortMessage || e.message, e.details || '');
        throw new Error('deploy estimate failed: ' + (e.shortMessage || e.message));
    }
    let tx;
    try {
        tx = await w.deployContract({ account: alice, abi: artifact.abi, bytecode: artifact.bytecode });
    } catch (e) {
        console.log('DEPLOY SEND FAILED:', e.shortMessage || e.message);
        // Retry as an explicit legacy transaction.
        const { data, gas } = await p.prepareTransactionRequest({ account: alice, data: artifact.bytecode, chain: chain });
        console.log('legacy retry with gas', gas);
        tx = await w.sendTransaction({ account: alice, data, gas, chain: chain, type: 'legacy' });
    }
    const receipt = await p.waitForTransactionReceipt({ hash: tx });
    if (receipt.status !== 'success') throw new Error('deployment reverted at nonce ' + receipt.nonce);
    const address = receipt.contractAddress;
    assert.ok(address, 'deployment produced no contract address');
    const onChainCode = await p.getCode({ address });
    assert.equal(onChainCode, artifact.runtime, 'deployed runtime bytecode must match the compiled artifact');
    const entry = 1000000000000000n;
    const write = async (account, functionName, value = 0n) => {
        const { request } = await p.simulateContract({ address, abi: artifact.abi, functionName, account, value });
        const result = await p.waitForTransactionReceipt({ hash: await w.writeContract(request) });
        assert.equal(result.status, 'success');
        return result;
    };
    const held = account => p.readContract({ address, abi: artifact.abi, functionName: 'deposits', args: [account] });
    await assert.rejects(() => write(alice, 'deposit', entry - 1n));
    await write(alice, 'deposit', entry);
    assert.equal(await held(alice), entry);
    await assert.rejects(() => write(alice, 'deposit', entry));
    await assert.rejects(() => write(bob, 'refund'));
    await write(bob, 'deposit', entry);
    await write(alice, 'refund');
    assert.equal(await held(alice), 0n);
    assert.equal(await held(bob), entry);
    await assert.rejects(() => write(alice, 'refund'));
    await write(bob, 'refund');
    assert.equal(await p.getBalance({ address, blockTag: 'latest' }), 0n);
    await write(alice, 'deposit', entry);
    await write(alice, 'refund');
    console.log('PASS: exact deposit, duplicate refusal, isolated balances, refund, double-refund refusal, redeposit');
} finally { await provider.disconnect(); }
const wrongProvider = ganache.provider({ chain: { chainId: 1 }, logging: { quiet: true } });
try {
    const p = createPublicClient({ transport: custom(wrongProvider), cacheTime: 0 });
    const [account] = (await wrongProvider.request({ method: 'eth_accounts', params: [] }));
    await assert.rejects(() => p.estimateGas({ account, data: artifact.bytecode }));
    console.log('PASS: cannot deploy on Ethereum mainnet chain ID');
} finally { await wrongProvider.disconnect(); }
fs.mkdirSync('../wallet-assets', { recursive: true });
fs.writeFileSync('../wallet-assets/practice-contract.json', JSON.stringify(artifact, null, 2));
