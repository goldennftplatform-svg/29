import fs from 'node:fs';
import assert from 'node:assert/strict';
import solc from 'solc';
import ganache from 'ganache';
import { createPublicClient, createWalletClient, custom, defineChain, keccak256, toBytes } from 'viem';

const source = fs.readFileSync('../contracts/PracticeDeposit.sol', 'utf8');
const output = JSON.parse(solc.compile(JSON.stringify({
    language: 'Solidity',
    sources: { 'PracticeDeposit.sol': { content: source } },
    settings: {
        optimizer: { enabled: true, runs: 200 },
        evmVersion: 'paris',
        outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } }
    }
})));
for (const e of output.errors || []) if (e.severity === 'error') throw new Error(e.formattedMessage);

const c = output.contracts['PracticeDeposit.sol'].PracticeDeposit;
const artifact = {
    abi: c.abi,
    bytecode: '0x' + c.evm.bytecode.object,
    runtime: '0x' + c.evm.deployedBytecode.object,
    depositTopic: keccak256(toBytes('Deposited(address,uint256)')),
    depositsSelector: keccak256(toBytes('deposits(address)')).slice(0, 10),
    entryWei: '1000000000000000',
    sourceCommit: process.env.GITHUB_SHA
};

// Contract tests run only on GitHub Actions, against an in-process chain.
const chain = defineChain({
    id: 4441, name: 'CI',
    nativeCurrency: { name: 'Test zkLTC', symbol: 'zkLTC', decimals: 18 },
    rpcUrls: { default: { http: [] } }
});

const provider = ganache.provider({ chain: { chainId: 4441 }, logging: { quiet: true } });
try {
    assert.equal(Number(await provider.request({ method: 'eth_chainId', params: [] })), 4441,
        'test chain must report chain ID 4441 so the LiteForge guard is meaningful');

    const p = createPublicClient({ chain, transport: custom(provider), cacheTime: 0 });
    const w = createWalletClient({ chain, transport: custom(provider) });
    const [alice, bob] = await w.getAddresses();

    // ganache mines viem's default EIP-1559 deployment transaction as failed
    // (status 0x0), so deploy with an explicit gas limit and legacy envelope.
    const prepared = await p.prepareTransactionRequest({
        account: alice, data: artifact.bytecode, chain, gas: 3_000_000n
    });
    const deployReceipt = await p.waitForTransactionReceipt({
        hash: await w.sendTransaction({ account: alice, chain, data: prepared.data, gas: prepared.gas, type: 'legacy' })
    });
    assert.equal(deployReceipt.status, 'success', 'deployment must succeed');

    const address = deployReceipt.contractAddress;
    assert.ok(address, 'deployment must produce a contract address');
    assert.equal(await p.getCode({ address }), artifact.runtime,
        'deployed runtime bytecode must match the compiled artifact');

    const entry = BigInt(artifact.entryWei);
    const write = async (account, functionName, value = 0n) => {
        const { request } = await p.simulateContract({ address, abi: artifact.abi, functionName, account, value });
        const result = await p.waitForTransactionReceipt({ hash: await w.writeContract(request) });
        assert.equal(result.status, 'success');
        return result;
    };
    const held = account => p.readContract({ address, abi: artifact.abi, functionName: 'deposits', args: [account] });

    // Exact amount only, one active deposit per wallet, balances stay isolated,
    // refunds clear the record, and a redeposit after refund still works.
    await assert.rejects(() => write(alice, 'deposit', entry - 1n), 'wrong amount must be rejected');
    await write(alice, 'deposit', entry);
    assert.equal(await held(alice), entry, 'alice holds exactly the entry amount');
    await assert.rejects(() => write(alice, 'deposit', entry), 'duplicate deposit must be rejected');
    await assert.rejects(() => write(bob, 'refund'), 'refund with no deposit must be rejected');

    await write(bob, 'deposit', entry);
    await write(alice, 'refund');
    assert.equal(await held(alice), 0n, 'alice refunded to zero');
    assert.equal(await held(bob), entry, "bob's deposit is untouched by alice's refund");
    await assert.rejects(() => write(alice, 'refund'), 'double refund must be rejected');
    await write(bob, 'refund');
    assert.equal(await p.getBalance({ address, blockTag: 'latest' }), 0n, 'contract holds no test funds');

    await write(alice, 'deposit', entry);
    await write(alice, 'refund');
    console.log('PASS: exact deposit, duplicate refusal, isolated balances, refund, double-refund refusal, redeposit');

    // The artifact's entryWei must equal the contract's own ENTRY, and the hex the wallet
    // sends must decode back to it. A hand-written hex literal once drifted 1000x here
    // (0xde0b6b3a7640000 == 1e18 wei, not 1e15), which made a valid deposit fail against a
    // funded wallet instead of failing CI.
    assert.equal(entry, 1_000_000_000_000_000n,
        'artifact entryWei must be 0.001 zkLTC and must track contracts/PracticeDeposit.sol ENTRY');
    assert.equal(BigInt('0x' + entry.toString(16)), entry,
        'the hex quantity derived from entryWei must decode back to entryWei');
    await p.simulateContract({ address, abi: artifact.abi, functionName: 'deposit', account: alice, value: entry });
    await assert.rejects(
        () => p.simulateContract({ address, abi: artifact.abi, functionName: 'deposit', account: alice, value: entry * 1000n }),
        'a 1000x overpayment must be rejected, proving ENTRY is 0.001 and not 1 zkLTC'
    );
    console.log(`PASS: entryWei=${entry} (0.001 zkLTC), hex 0x${entry.toString(16)}, 1000x overpayment rejected`);
} finally {
    await provider.disconnect();
}

// The constructor guard must block deployment on any other chain.
const wrongProvider = ganache.provider({ chain: { chainId: 1 }, logging: { quiet: true } });
try {
    const p = createPublicClient({ transport: custom(wrongProvider), cacheTime: 0 });
    const [account] = await wrongProvider.request({ method: 'eth_accounts', params: [] });
    await assert.rejects(() => p.estimateGas({ account, data: artifact.bytecode }),
        'deployment must fail when block.chainid is not 4441');
    console.log('PASS: cannot deploy on Ethereum mainnet chain ID');
} finally {
    await wrongProvider.disconnect();
}

fs.mkdirSync('../wallet-assets', { recursive: true });
fs.writeFileSync('../wallet-assets/practice-contract.json', JSON.stringify(artifact, null, 2));
console.log('wrote wallet-assets/practice-contract.json');