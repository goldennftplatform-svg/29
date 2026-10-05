import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PrivyProvider, usePrivy, useWallets, useCreateWallet } from '@privy-io/react-auth';
import { defineChain, createPublicClient, http, formatEther } from 'viem';

const chain = defineChain({
    id: 4441,
    name: 'LitVM LiteForge',
    nativeCurrency: { name: 'Test zkLTC', symbol: 'zkLTC', decimals: 18 },
    rpcUrls: { default: { http: ['https://liteforge.rpc.caldera.xyz/http'] } },
    blockExplorers: { default: { name: 'LiteForge Explorer', url: 'https://liteforge.explorer.caldera.xyz' } },
    testnet: true
});
const client = createPublicClient({ chain, transport: http(undefined, { timeout: 15000, retryCount: 1 }) });

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
    const wallet = wallets.find(w => w.walletClientType === 'privy');
    const address = wallet?.address;
    const [balance, setBalance] = useState(null);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [busy, setBusy] = useState(false);
    const [refresh, setRefresh] = useState(0);
    const [loadingBalance, setLoadingBalance] = useState(false);
    const [slow, setSlow] = useState(false);

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
            <p>Sign in with Google or email. Privy creates an Ethereum-compatible wallet for LiteForge—no browser extension or Solana RPC needed.</p>
            <button id="google-login" onClick={() => login({ loginMethods: ['google'] })}>Continue with Google</button>
            <button className="secondary" onClick={() => login({ loginMethods: ['email'] })}>Use email instead</button>
        </> : <>
            <p>Signed in{user?.google?.email || user?.email?.address ? ' as ' + (user.google?.email || user.email?.address) : ''}</p>
            {!walletsReady ? <p role="status">Loading your wallet…</p> : !wallet ? <>
                <p>Your EVM wallet is being prepared. If it does not appear, create it below.</p>
                <button disabled={busy} onClick={() => action(() => createWallet())}>Create my test wallet</button>
            </> : <>
                <h2>Your LiteForge wallet</h2>
                <p className="address" id="evm-address">{address}</p>
                <div className="balance">{balance === null ? (loadingBalance ? 'Checking balance…' : 'Balance unavailable') : formatEther(balance) + ' test zkLTC'}</div>
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
