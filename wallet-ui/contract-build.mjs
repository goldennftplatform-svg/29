import fs from 'node:fs';
import assert from 'node:assert/strict';
import solc from 'solc';
import ganache from 'ganache';
import { createPublicClient, createWalletClient, custom, defineChain, hashMessage, keccak256, toBytes } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

function compile(file, name) {
    const source = fs.readFileSync('../contracts/' + file, 'utf8');
    const output = JSON.parse(solc.compile(JSON.stringify({
        language: 'Solidity',
        sources: { [file]: { content: source } },
        settings: {
            optimizer: { enabled: true, runs: 200 },
            evmVersion: 'paris',
            outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } }
        }
    })));
    for (const e of output.errors || []) if (e.severity === 'error') throw new Error(e.formattedMessage);
    const c = output.contracts[file][name];
    return {
        abi: c.abi,
        bytecode: '0x' + c.evm.bytecode.object,
        runtime: '0x' + c.evm.deployedBytecode.object
    };
}

function topic(sig) { return keccak256(toBytes(sig)); }
function selector(sig) { return keccak256(toBytes(sig)).slice(0, 10); }

const ENTRY = 1_000_000_000_000_000n;

// CI stamps the artifact with the commit that produced it. A local run has no
// GITHUB_SHA, and dropping the field would strip it out of the committed file
// on every iteration, so carry the previous value forward instead.
function sourceCommitFor(file) {
    if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
    try { return JSON.parse(fs.readFileSync('../wallet-assets/' + file, 'utf8')).sourceCommit; } catch { return undefined; }
}
function commitField(file) {
    const sourceCommit = sourceCommitFor(file);
    return sourceCommit ? { sourceCommit } : {};
}

// simulateContract returns a request without `gas`, and ganache then applies its
// 90k default — enough for PracticeDeposit's single slot write but not for
// Settlement's struct write, which reverted out of gas. Send a fixed ceiling
// instead; a genuine revert still surfaces as status 'reverted'.
const WRITE_GAS = 1_000_000n;

// ---------------------------------------------------------------------------
// PracticeDeposit — refund-only LiteForge practice rail.
// ---------------------------------------------------------------------------
const practice = compile('PracticeDeposit.sol', 'PracticeDeposit');
const artifact = {
    ...practice,
    depositTopic: topic('Deposited(address,uint256)'),
    depositsSelector: selector('deposits(address)'),
    entryWei: ENTRY.toString(),
    ...commitField('practice-contract.json')
};

// ---------------------------------------------------------------------------
// Settlement — house-signed escrow, chain-agnostic so LitVM mainnet is a config
// swap rather than a recompile.
// ---------------------------------------------------------------------------
const settlement = compile('Settlement.sol', 'Settlement');
const settlementArtifact = {
    ...settlement,
    topics: {
        MatchOpened: topic('MatchOpened(bytes32,address,uint256,uint64)'),
        MatchJoined: topic('MatchJoined(bytes32,address,uint64)'),
        MatchSettled: topic('MatchSettled(bytes32,address,uint256)'),
        MatchRefunded: topic('MatchRefunded(bytes32,address,address,address,uint256)')
    },
    selectors: {
        matches: selector('matches(bytes32)'),
        openMatch: selector('openMatch(address)'),
        digest: selector('digest(bytes32,address)'),
        hashOf: selector('hashOf(bytes32,address)'),
        house: selector('house()')
    },
    entryWei: ENTRY.toString(),
    ...commitField('settlement-contract.json')
};

// Contract tests run only on GitHub Actions, against an in-process chain.
const chain = defineChain({
    id: 4441, name: 'CI',
    nativeCurrency: { name: 'Test zkLTC', symbol: 'zkLTC', decimals: 18 },
    rpcUrls: { default: { http: [] } }
});

async function deploy(client, wallet, account, art, args = '') {
    // ganache mines viem's default EIP-1559 deployment transaction as failed
    // (status 0x0), so deploy with an explicit gas limit and legacy envelope.
    const prepared = await client.prepareTransactionRequest({
        account, data: art.bytecode + args, chain, gas: 5_000_000n
    });
    const receipt = await client.waitForTransactionReceipt({
        hash: await wallet.sendTransaction({ account, chain, data: prepared.data, gas: prepared.gas, type: 'legacy' })
    });
    assert.equal(receipt.status, 'success', 'deployment must succeed');
    assert.ok(receipt.contractAddress, 'deployment must produce a contract address');
    return receipt.contractAddress;
}

const provider = ganache.provider({ chain: { chainId: 4441 }, logging: { quiet: true } });
try {
    assert.equal(Number(await provider.request({ method: 'eth_chainId', params: [] })), 4441,
        'test chain must report chain ID 4441 so the LiteForge guard is meaningful');

    const p = createPublicClient({ chain, transport: custom(provider), cacheTime: 0 });
    const w = createWalletClient({ chain, transport: custom(provider) });
    const [alice, bob, carol] = await w.getAddresses();

    const address = await deploy(p, w, alice, artifact);
    assert.equal(await p.getCode({ address }), artifact.runtime,
        'deployed runtime bytecode must match the compiled artifact');

    const entry = BigInt(artifact.entryWei);
    const write = async (account, functionName, value = 0n, extra = {}) => {
        const { request } = await p.simulateContract({
            address, abi: artifact.abi, functionName, account, value, ...extra
        });
        const result = await p.waitForTransactionReceipt({
            hash: await w.writeContract({ ...request, gas: WRITE_GAS })
        });
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

// The PracticeDeposit constructor guard must block deployment on any other chain.
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

// ---------------------------------------------------------------------------
// Settlement tests: escrow, house signature, timeout refunds, chain-agnostic.
// ---------------------------------------------------------------------------
const settleProvider = ganache.provider({ chain: { chainId: 4441 }, logging: { quiet: true } });
try {
    const p = createPublicClient({ chain, transport: custom(settleProvider), cacheTime: 0 });
    const w = createWalletClient({ chain, transport: custom(settleProvider) });
    const [alice, bob, carol] = await w.getAddresses();

    const houseAccount = privateKeyToAccount(generatePrivateKey());
    // Returns a bare hex blob (no 0x) so it can be appended to the 0x-prefixed
    // creation bytecode; a nested 0x is rejected by the JSON-RPC data type.
    const enc = abi => abi.map(x => (typeof x === 'string'
        ? x.slice(2).padStart(64, '0')
        : BigInt(x).toString(16).padStart(64, '0'))).join('');

    const address = await deploy(p, w, alice, settlementArtifact, enc([houseAccount.address]));
    // `house` is immutable, so solc leaves a 32-byte zero placeholder in
    // deployedBytecode and the constructor patches the real address in. Compare
    // against the artifact with that slot filled, not against the raw artifact.
    const withHouse = (hex, addr) => hex
        .split('7f' + '0'.repeat(64))
        .join('7f' + '0'.repeat(24) + addr.slice(2).toLowerCase());
    assert.equal(await p.getCode({ address }), withHouse(settlementArtifact.runtime, houseAccount.address),
        'settlement runtime bytecode must match the compiled artifact');
    assert.equal(
        await p.readContract({ address, abi: settlementArtifact.abi, functionName: 'house' }),
        houseAccount.address, 'house must be the constructor argument');

    const abi = settlementArtifact.abi;
    const contract = addr => ({ address, abi });
    const write = async (account, functionName, args = [], value = 0n) => {
        const { request } = await p.simulateContract({ ...contract(address), functionName, account, args, value });
        const result = await p.waitForTransactionReceipt({
            hash: await w.writeContract({ ...request, gas: WRITE_GAS })
        });
        assert.equal(result.status, 'success', `${functionName} must succeed`);
        return result;
    };
    const readMatch = async id => {
        const r = await p.readContract({ ...contract(address), functionName: 'matches', args: [id] });
        return { a: r[0] ?? r.a, b: r[1] ?? r.b, deadline: r[2] ?? r.deadline, state: Number(r[3] ?? r.state) };
    };
    const balance = addr => p.getBalance({ address: addr, blockTag: 'latest' });
    const increase = async seconds => {
        await settleProvider.request({ method: 'evm_increaseTime', params: [seconds] });
        await settleProvider.request({ method: 'evm_mine', params: [] });
    };

    const id1 = keccak256(toBytes('match:alice:1'));
    const id2 = keccak256(toBytes('match:alice:2'));
    const id3 = keccak256(toBytes('match:alice:3'));
    const id4 = keccak256(toBytes('match:carol:1'));
    const id5 = keccak256(toBytes('match:carol:2'));
    const State = { None: 0, Open: 1, Funded: 2, Settled: 3, Refunded: 4 };
    const entry = BigInt(settlementArtifact.entryWei);
    assert.equal(entry, 1_000_000_000_000_000n,
        'settlement entryWei must match contracts/Settlement.sol ENTRY');

    // --- open / join -------------------------------------------------------
    await assert.rejects(() => write(alice, 'open', [id1], entry - 1n), 'open must demand the exact entry');
    await write(alice, 'open', [id1], entry);
    assert.equal((await readMatch(id1)).state, State.Open, 'match opens with one stake');
    assert.equal(await p.readContract({ ...contract(address), functionName: 'openMatch', args: [alice] }), id1,
        'the opener is bound to their open match');
    await assert.rejects(() => write(bob, 'open', [id1], entry), 'a used id must be refused');
    // Carol demonstrates the one-open-match lock, then cancels so bob stays free
    // to join id1 and the pot accounting below stays exact.
    await write(carol, 'open', [id4], entry);
    await assert.rejects(() => write(carol, 'open', [id5], entry), 'an account with an open match cannot open a second');
    await write(carol, 'cancel', [id4]);
    assert.equal(await balance(address), entry, 'the cancelled stake was returned, leaving only the opener stake');
    await assert.rejects(() => write(alice, 'join', [id1], entry), 'the opener cannot join their own match');
    await write(bob, 'join', [id1], entry);
    assert.equal((await readMatch(id1)).state, State.Funded, 'second stake funds the match');
    assert.equal(await balance(address), entry * 2n, 'the contract holds the full pot');

    // --- settlement signature ---------------------------------------------
    // The house personal_signs the INNER hash. `digest` is already the
    // EIP-191-prefixed form the contract recovers from, so signing it would
    // double-prefix and ecrecover would return some other address.
    const sign = async (id, winner) => houseAccount.signMessage({
        message: { raw: await p.readContract({ ...contract(address), functionName: 'hashOf', args: [id, winner] }) }
    });

    const sigForAlice = await sign(id1, alice);
    const sigForBob = await sign(id1, bob);
    const carolIsNotAPlayer = keccak256(toBytes('carol'));

    assert.equal(
        hashMessage({ raw: await p.readContract({ ...contract(address), functionName: 'hashOf', args: [id1, bob] }) }),
        await p.readContract({ ...contract(address), functionName: 'digest', args: [id1, bob] }),
        'digest must be the EIP-191 prefix over hashOf, which is exactly what personal_sign produces'
    );

    await assert.rejects(() => write(carol, 'settle', [id1, bob, '0x' + '00'.repeat(65)]),
        'an empty signature must be refused');
    await assert.rejects(() => write(carol, 'settle', [id1, bob, sigForAlice]),
        'a signature for the wrong winner must be refused');
    await assert.rejects(
        () => write(carol, 'settle', [id1, carolIsNotAPlayer, '0x' + '11'.repeat(65)]),
        'a non-player winner must be refused before any signature check matters');

    const bobBefore = await balance(bob);
    await write(carol, 'settle', [id1, bob, sigForBob]);
    assert.equal((await readMatch(id1)).state, State.Settled, 'valid house signature settles the match');
    assert.equal(await balance(address), 0n, 'the pot left the contract');
    assert.equal(await balance(bob), bobBefore + entry * 2n,
        'the winner received exactly the pot (carol paid the gas)');
    assert.equal(await p.readContract({ ...contract(address), functionName: 'openMatch', args: [bob] }),
        '0x' + '00'.repeat(32), 'settling clears the winner open-match lock');
    await assert.rejects(() => write(carol, 'settle', [id1, bob, sigForBob]),
        'a settled match cannot settle twice');

    // --- join window and cancellation -------------------------------------
    await write(alice, 'open', [id2], entry);
    await increase(3601);
    await assert.rejects(() => write(bob, 'join', [id2], entry), 'the join window must close');
    assert.equal((await readMatch(id2)).state, State.Open, 'an unjoined match stays open until refund');
    const aliceMid = await balance(alice);
    await write(alice, 'cancel', [id2]);
    assert.equal((await readMatch(id2)).state, State.Refunded, 'the opener can cancel an open match');
    assert.equal(await balance(address), 0n, 'cancelling emptied the contract');

    // --- timeout refund ----------------------------------------------------
    await write(alice, 'open', [id3], entry);
    await write(bob, 'join', [id3], entry);
    assert.equal(await balance(address), entry * 2n, 'pot held for the timeout test');
    await assert.rejects(() => write(carol, 'refund', [id3]), 'refund must be refused before the deadline');
    await increase(86401);
    const aliceEnd = await balance(alice);
    const bobEnd = await balance(bob);
    await write(carol, 'refund', [id3]);
    assert.equal((await readMatch(id3)).state, State.Refunded, 'refund succeeds after the claim window');
    assert.equal(await balance(address), 0n, 'contract holds no funds after refund');
    assert.equal(await balance(alice), aliceEnd + entry, 'alice got her stake back');
    assert.equal(await balance(bob), bobEnd + entry, 'bob got his stake back');
    await assert.rejects(() => write(carol, 'refund', [id3]), 'a refunded match cannot refund twice');
    console.log('PASS: escrow open/join, house signature, wrong-signer refusal, join window, cancel, timeout refund');
} finally {
    await settleProvider.disconnect();
}

// Settlement must deploy on any chain id: LitVM mainnet is a config swap, not a
// recompile, so there is deliberately no block.chainid guard.
const anyChainProvider = ganache.provider({ chain: { chainId: 1 }, logging: { quiet: true } });
try {
    const anyChain = defineChain({
        id: 1, name: 'Not LitVM',
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: { default: { http: [] } }
    });
    const p = createPublicClient({ chain: anyChain, transport: custom(anyChainProvider), cacheTime: 0 });
    const w = createWalletClient({ chain: anyChain, transport: custom(anyChainProvider) });
    const [account] = await anyChainProvider.request({ method: 'eth_accounts', params: [] });
    const houseAccount = privateKeyToAccount(generatePrivateKey());
    const prepared = await p.prepareTransactionRequest({
        // bytecode already carries the 0x prefix; a second one is invalid hex.
        account, data: settlementArtifact.bytecode + houseAccount.address.slice(2).padStart(64, '0'),
        gas: 5_000_000n
    });
    const receipt = await p.waitForTransactionReceipt({
        hash: await w.sendTransaction({ account, chain: anyChain, data: prepared.data, gas: prepared.gas, type: 'legacy' })
    });
    assert.equal(receipt.status, 'success', 'settlement must deploy on a non-LitVM chain id');
    console.log('PASS: Settlement deploys on chain ID 1 (no chainid guard; mainnet is a config swap)');
} finally {
    await anyChainProvider.disconnect();
}

fs.mkdirSync('../wallet-assets', { recursive: true });
fs.writeFileSync('../wallet-assets/practice-contract.json', JSON.stringify(artifact, null, 2));
fs.writeFileSync('../wallet-assets/settlement-contract.json', JSON.stringify(settlementArtifact, null, 2));
console.log('wrote wallet-assets/practice-contract.json');
console.log('wrote wallet-assets/settlement-contract.json');
