// Receipt validation starts a practice AI game; never grants monetary credits.
(async function () {
    const hash = new URLSearchParams(location.search).get('practiceTx');
    if (!hash) return;
    const panel = document.createElement('p');
    panel.setAttribute('role','status'); panel.textContent = 'Verifying your LiteForge practice deposit…';
    document.querySelector('#landing-screen .pixel-border').prepend(panel);
    async function rpc(method, params=[]) {
        const r = await fetch('https://liteforge.rpc.caldera.xyz/http', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}), signal:AbortSignal.timeout(15000)
        });
        const body = await r.json();
        if (!r.ok || body.error) throw new Error(body.error?.message || 'RPC unavailable');
        return body.result;
    }
    try {
        if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw new Error('Invalid transaction hash');
        const [d,a] = await Promise.all([
            fetch('practice-deployment.json',{cache:'no-store'}).then(r=>r.json()),
            fetch('wallet-assets/practice-contract.json').then(r=>r.json())
        ]);
        if (d.chainId !== 4441 || !d.address || await rpc('eth_chainId') !== '0x1159') throw new Error('LiteForge configuration mismatch');
        if (await rpc('eth_getCode',[d.address,'latest']) !== a.runtime) throw new Error('Contract verification failed');
        const r = await rpc('eth_getTransactionReceipt',[hash]);
        if (!r || r.status !== '0x1' || r.to?.toLowerCase() !== d.address.toLowerCase()) throw new Error('Deposit not confirmed');
        const entry = r.logs.find(l=>l.address.toLowerCase()===d.address.toLowerCase() && l.topics[0]===a.depositTopic &&
            l.topics[1]?.slice(-40).toLowerCase()===r.from.slice(2).toLowerCase() && BigInt(l.data)===1000000000000000n);
        if (!entry) throw new Error('Expected deposit event missing');
        const held = await rpc('eth_call',[{to:d.address,data:a.depositsSelector+r.from.slice(2).padStart(64,'0')},'latest']);
        if (BigInt(held)!==1000000000000000n) throw new Error('Deposit was refunded. Make a new deposit to test again');
        if (!window.game) throw new Error('Game has not initialized; reload to retry');
        const name = document.getElementById('player-name').value.trim() || 'TEST PLAYER';
        game.isSinglePlayer = true;
        game.setupLocalGame('1v1',name);
        document.getElementById('table-id-display').textContent = 'LITEFORGE PRACTICE';
        game.addLogEntry('LiteForge deposit verified. Practice only; no winnings. Refund in your test wallet.','system');
        const link = document.createElement('a');
        link.href='wallet-setup.html'; link.className='pixel-btn'; link.textContent='WALLET / REFUND';
        document.querySelector('#game-screen .game-header').append(link);
    } catch(e) {
        panel.setAttribute('role','alert');
        panel.textContent='Practice deposit verification: '+e.message+'. You can still play free AI games or return to your test wallet.';
    }
})();
