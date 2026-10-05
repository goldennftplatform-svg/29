import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PrivyProvider, usePrivy, useWallets, useCreateWallet, useSendTransaction } from '@privy-io/react-auth';
import { defineChain, createPublicClient, http, formatEther, encodeFunctionData, toHex } from 'viem';

const chain = defineChain({
    id: 4441,
    name: 'LitVM LiteForge',
    nativeCurrency: { name: 'Test zkLTC', symbol: 'zkLTC', decimals: 18 },
    rpcUrls: { default: { http: ['https://liteforge.rpc.caldera.xyz/http'] } },
    blockExplorers: { default: { name: 'LiteForge Explorer', url: 'https://liteforge.explorer.caldera.xyz' } },
    testnet: true
});
const client = createPublicClient({ chain, transport: http(undefined, { timeout: 15000, retryCount: 1 }) });

const ENTRY_WEI = 1000000000000000n; // 0.001 zkLTC — fallback only; prefer artifact.entryWei (built from contracts/PracticeDeposit.sol)
function entryWeiFor(artifact) {
    const fromArtifact = artifact?.entryWei ? BigInt(artifact.entryWei) : null;
    if (fromArtifact !== null && fromArtifact !== ENTRY_WEI) throw new Error(`Artifact entry ${fromArtifact} != expected ${ENTRY_WEI}`);
    return fromArtifact ?? ENTRY_WEI;
}

class Boundary extends React.Component {
    state = { failed: false };
    static getDerivedStateFromError() { return { failed: true }; }
    render() {
        return this.state.failed
            ? <p role="alert">Wallet sign-in could not start. Check this site's allowed domain and Ethereum wallet settings in Privy, then reload. The game is still available.</p>
            : this.props.children;
    }
}

function Wallet() {
    const { ready, authenticated, login, logout, user } = usePrivy();
    const { wallets, ready: walletsReady } = useWallets();
    const { createWallet } = useCreateWallet();
    const { sendTransaction } = useSendTransaction();
    const wallet = wallets.find(w => w.walletClientType === 'privy');
    const address = wallet?.address;
    const [balance, setBalance] = useState(null);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [busy, setBusy] = useState(false);
    const [refresh, setRefresh] = useState(0);
    const [loadingBalance, setLoadingBalance] = useState(false);
    const [slow, setSlow] = useState(false);
    const [deployment, setDeployment] = useState(null);
    const [artifact, setArtifact] = useState(null);
    const [deposit, setDeposit] = useState(null);
    const [transaction, setTransaction] = useState(null);
    const [confirmedDeposit, setConfirmedDeposit] = useState(null);
    const [deployedAddress, setDeployedAddress] = useState(null);
    const deployMode = new URLSearchParams(location.search).get('deploy') === '1';

    useEffect(() => {
        Promise.all([
            fetch('./practice-deployment.json', { cache: 'no-store' })
                .then(r => { if (!r.ok) throw new Error('Deployment settings unavailable'); return r.json(); }),
            fetch('./wallet-assets/practice-contract.json')
                .then(r => { if (!r.ok) throw new Error('Contract artifact unavailable'); return r.json(); })
        ]).then(([d, a]) => { setDeployment(d); setArtifact(a); })
            // Not yet published by CI is an expected state, not a failure.
            .catch(() => { setDeployment({ chainId: 4441, address: null }); setArtifact(null); });
    }, []);

    function isDepositReceipt(receipt) {
        return receipt.status === 'success' && receipt.from.toLowerCase() === address.toLowerCase() &&
            receipt.to?.toLowerCase() === deployment.address.toLowerCase() && receipt.logs.some(log =>
                log.address.toLowerCase() === deployment.address.toLowerCase() && log.topics[0] === artifact.depositTopic &&
                log.topics[1]?.slice(-40).toLowerCase() === address.slice(2).toLowerCase() && BigInt(log.data) === entryWeiFor(artifact));
    }

    useEffect(() => {
        let active = true;
        setDeposit(null); setConfirmedDeposit(null);
        if (!address || !deployment?.address || !artifact) return () => { active = false; };
        (async () => {
            if (await client.getChainId() !== 4441) throw new Error('Wrong RPC network');
            if (await client.getCode({ address: deployment.address }) !== artifact.runtime) throw new Error('Contract verification failed. Payments disabled.');
            const value = await client.readContract({ address: deployment.address, abi: artifact.abi, functionName: 'deposits', args: [address] });
            if (active) setDeposit(value);
            const saved = localStorage.getItem('litecrib-practice-tx:' + address.toLowerCase());
            if (saved && value > 0n) {
                const receipt = await client.getTransactionReceipt({ hash: saved });
                if (active && isDepositReceipt(receipt)) setConfirmedDeposit(saved);
            }
        })().catch(e => { if (active) setError(e.shortMessage || e.message); });
        return () => { active = false; };
    }, [address, deployment, artifact, refresh]);

    async function transact(kind) {
        if (!address || !wallet || !artifact) throw new Error('Wallet is not ready');
        await wallet.switchChain(4441);
        const provider = await wallet.getEthereumProvider();
        if (Number(await provider.request({ method:'eth_chainId' })) !== 4441 || await client.getChainId() !== 4441) throw new Error('Switch to LiteForge before sending');
        if (kind !== 'deploy') {
            if (!deployment?.address || deployment.chainId !== 4441) throw new Error('Testnet contract not deployed yet');
            if (await client.getCode({ address:deployment.address }) !== artifact.runtime) throw new Error('Contract verification failed');
            await client.simulateContract({ address:deployment.address, abi:artifact.abi, functionName:kind, account:address, value:kind === 'deposit' ? entryWeiFor(artifact) : 0n });
        }
        // Derive the value from the artifact and send exactly what we simulated: a hand-written
        // hex literal once drifted 1000x and asked the depositor for 1 zkLTC instead of 0.001.
        const entryWei = entryWeiFor(artifact);
        const request = kind === 'deploy'
            ? { data:artifact.bytecode, value:'0x0', chainId:4441 }
            : { to:deployment.address, data:encodeFunctionData({ abi:artifact.abi, functionName:kind }), value:kind === 'deposit' ? toHex(entryWei) : '0x0', chainId:4441 };
        const { hash } = await sendTransaction(request, { address, uiOptions:{ showWalletUIs:true } });
        setTransaction(hash); setNotice('Transaction submitted. Waiting for chain confirmation…');
        if (kind === 'deposit') localStorage.setItem('litecrib-practice-tx:' + address.toLowerCase(), hash);
        const receipt = await client.waitForTransactionReceipt({ hash, timeout:120000 });
        if (receipt.status !== 'success') throw new Error('Transaction reverted; no payment was credited.');
        if (kind === 'deploy') {
            if (await client.getCode({ address:receipt.contractAddress }) !== artifact.runtime) throw new Error('Deployed bytecode mismatch');
            setDeployedAddress(receipt.contractAddress);
            setNotice('Testnet contract deployed and bytecode verified. Publish this address in the deployment configuration.');
        } else if (kind === 'deposit') {
            if (!isDepositReceipt(receipt)) throw new Error('Receipt did not contain the expected deposit');
            setConfirmedDeposit(hash);
            setNotice('0.001 test zkLTC deposit confirmed. You can launch practice or refund now.');
        } else {
            localStorage.removeItem('litecrib-practice-tx:' + address.toLowerCase());
            setConfirmedDeposit(null);
            setNotice('Your test deposit was refunded. Network gas is not refunded.');
        }
        setRefresh(n => n+1);
    }

    useEffect(() => {
        const timer = setTimeout(() => setSlow(true), 15000);
        return () => clearTimeout(timer);
    }, []);

    useEffect(() => {
        let active = true;
        setBalance(null);
        if (!address) return () => { active = false; };
        setLoadingBalance(true);
        setError('');
        (async () => {
            if (await client.getChainId() !== chain.id) throw new Error('RPC returned the wrong network. Balance was not loaded.');
            const amount = await client.getBalance({ address });
            if (active) setBalance(amount);
        })().catch(e => { if (active) setError(e.shortMessage || e.message); })
            .finally(() => { if (active) setLoadingBalance(false); });
        return () => { active = false; };
    }, [address, refresh]);

    useEffect(() => {
        const onFocus = () => setRefresh(n => n + 1);
        window.addEventListener('focus', onFocus);
        return () => window.removeEventListener('focus', onFocus);
    }, []);

    async function action(fn) {
        setBusy(true); setError(''); setNotice('');
        try { await fn(); } catch (e) { setError(e.shortMessage || e.message || 'Request failed. Please try again.'); }
        finally { setBusy(false); }
    }

    if (!ready) return <p role="status">{slow ? 'Sign-in is taking longer than expected. Check your connection and the Privy allowed-domain setting, then reload.' : 'Loading secure sign-in…'}</p>;

    return <>
        <ol className="steps">
            <li className={authenticated ? 'done' : ''}>Sign in</li>
            <li className={address ? 'done' : ''}>Wallet ready</li>
            <li className={balance !== null && balance > 0n ? 'done' : ''}>Get test coins</li>
        </ol>
        {!authenticated ? <>
            <h2>A wallet without the setup headache</h2>
            <p>Sign in with email. Privy creates an Ethereum-compatible wallet for LiteForge — no browser extension, no seed phrase to manage, no Solana RPC needed.</p>
            <button id="email-login" onClick={() => login({ loginMethods: ['email'] })}>Continue with email</button>
            <p className="hint">After signing in you will see your balance, plus buttons to deposit 0.001 test zkLTC and launch a practice game. Google sign-in will be added after the email pilot.</p>
        </> : <>
            <p>Signed in{user?.google?.email || user?.email?.address ? ' as ' + (user.google?.email || user.email?.address) : ''}</p>
            {!walletsReady ? <p role="status">Loading your wallet…</p> : !wallet ? <>
                <p>Your EVM wallet is being prepared. If it does not appear, create it below.</p>
                <button disabled={busy} onClick={() => action(() => createWallet())}>Create my test wallet</button>
            </> : <>
                <h2>Your LiteForge wallet</h2>
                <p className="address" id="evm-address">{address}</p>
                <div className="balance">{balance === null ? (loadingBalance ? 'Checking balance…' : 'Balance unavailable') : formatEther(balance) + ' test zkLTC'}</div>
                <h3>Testnet practice game</h3>
                <p>Deposit 0.001 test zkLTC, play against AI, then refund your deposit. No house fee, winnings, or real money. Transactions use a small amount of test gas.</p>
                {!deployment?.address ? <p>Practice payments are awaiting contract deployment.</p> : <>
                    <p>Refundable deposit: {deposit === null ? 'checking…' : formatEther(deposit) + ' test zkLTC'}</p>
                    <button disabled={busy || deposit === null || deposit > 0n} onClick={() => action(() => transact('deposit'))}>Deposit 0.001 test zkLTC</button>
                    <button className="secondary" disabled={busy || !deposit} onClick={() => action(() => transact('refund'))}>Refund my test deposit</button>
                    {confirmedDeposit && deposit > 0n && <a className="button" href={'./?practiceTx=' + confirmedDeposit}>Play testnet practice</a>}
                    <a href={chain.blockExplorers.default.url + '/address/' + deployment.address} target="_blank" rel="noopener noreferrer">Practice contract ↗</a>
                </>}
                {deployMode && !deployment?.address && <button disabled={busy || !artifact || !!deployedAddress} onClick={() => action(() => transact('deploy'))}>Deploy LiteForge practice contract</button>}
                {deployedAddress && <p id="deployed-contract" className="address">{deployedAddress}</p>}
                {transaction && <p><a id="latest-transaction" href={chain.blockExplorers.default.url + '/tx/' + transaction} target="_blank" rel="noopener noreferrer">View submitted transaction ↗</a></p>}
                <div className="actions">
                    <button disabled={busy} onClick={() => action(async () => { await navigator.clipboard.writeText(address); setNotice('Address copied. Paste it into the faucet.'); })}>Copy address</button>
                    <button className="secondary" disabled={loadingBalance} onClick={() => setRefresh(n => n + 1)}>Refresh balance</button>
                    <button className="secondary" disabled={busy} onClick={() => action(async () => { await wallet.switchChain(chain.id); setNotice('Wallet switched to LiteForge (4441).'); })}>Use LiteForge network</button>
                </div>
                <h3>Get free test coins</h3>
                <p>Copy your address, open the official faucet, and complete its claim steps. Return here to see your balance refresh. Test coins have no cash value.</p>
                <a className="button" href="https://liteforge.hub.caldera.xyz" target="_blank" rel="noopener noreferrer">Get test zkLTC ↗</a>
                <a href={chain.blockExplorers.default.url + '/address/' + address} target="_blank" rel="noopener noreferrer">View balance & transactions ↗</a>
                <p className="hint">Use this 0x address for LiteForge test zkLTC only. Native Litecoin and Solana use different networks. Test funds do not automatically become game credits.</p>
            </>}
            <button className="secondary" disabled={busy} onClick={() => action(() => logout())}>Sign out</button>
        </>}
        {notice && <p role="status">{notice}</p>}
        {error && <p role="alert">{error}</p>}
    </>;
}

createRoot(document.getElementById('wallet-root')).render(
    <Boundary><PrivyProvider appId="cmuvr1tvz00xb0bl8l5238rrm" config={{
        loginMethods: ['google', 'email'],
        appearance: { theme: 'dark', accentColor: '#91bcff', walletChainType: 'ethereum-only' },
        defaultChain: chain,
        supportedChains: [chain],
        embeddedWallets: { ethereum: { createOnLogin: 'all-users' } }
    }}><Wallet /></PrivyProvider></Boundary>
);
