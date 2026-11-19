// Pure-Node regression test for the public one-click MetaMask CTA. No browser
// extension, network or relay is needed: the DOM/provider are minimal fakes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../metamask.js'), 'utf8');

function harness(options = {}) {
    let listener = null;
    const status = { textContent: '', hidden: true, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
    const button = {
        attrs: { 'data-litvm-status': 'mm-status' },
        getAttribute(k) { return this.attrs[k] || null; },
        addEventListener(type, fn) { if (type === 'click') listener = fn; }
    };
    const document = {
        readyState: 'complete',
        getElementById(id) { return id === 'mm-status' ? status : null; },
        querySelector() { return status; },
        querySelectorAll(selector) {
            if (selector === '[data-litvm-add]') return [button];
            if (selector === '[data-litvm-guide]') return [];
            return [];
        },
        addEventListener() {}
    };
    const calls = [];
    const opened = [];
    const request = options.request || (async args => { calls.push(args); return null; });
    const ethereum = options.ethereum === undefined
        ? { isMetaMask: true, request }
        : options.ethereum;
    const window = {
        LITECRIB_CONFIG: {
            litvm: {
                chainId: 4441,
                rpcUrl: 'https://rpc.testnet.liteforge.zeeve.net/',
                explorer: 'https://explorer.testnet.liteforge.zeeve.net'
            }
        },
        ethereum,
        open(...args) { opened.push(args); return null; }
    };
    const sandbox = { window, document, console };
    vm.runInNewContext(source, sandbox, { filename: 'metamask.js' });
    return {
        window,
        document,
        status,
        button,
        calls,
        opened,
        click: async () => {
            assert.ok(listener, 'The CTA has a click listener after init');
            await window.LITEcribMetaMask.addNetwork(button);
        },
        api: window.LITEcribMetaMask
    };
}

(async () => {
    {
        const h = harness();
        await h.click();
        assert.equal(h.calls.length, 1, 'Clicking the CTA sends exactly one provider request');
        const args = h.calls[0];
        assert.equal(args.method, 'wallet_addEthereumChain');
        assert.equal(JSON.stringify(args.params[0]), JSON.stringify({
            chainId: '0x1159',
            chainName: 'LitVM LiteForge',
            nativeCurrency: { name: 'zkLTC', symbol: 'zkLTC', decimals: 18 },
            rpcUrls: ['https://rpc.testnet.liteforge.zeeve.net/'],
            blockExplorerUrls: ['https://explorer.testnet.liteforge.zeeve.net']
        }));
        assert.match(h.status.textContent, /ADDED/, 'Success is visible, never silent');
        assert.equal(h.status.attrs['data-error'], 'false');
        assert.equal(h.status.hidden, false);
        console.log('PASS  one-click CTA adds official LitVM LiteForge parameters');
    }

    {
        const h = harness({ request: async () => { throw { code: 4001, message: 'User rejected' }; } });
        await h.click();
        assert.match(h.status.textContent, /CANCELLED/, 'Rejection is explained in the UI');
        assert.equal(h.status.attrs['data-error'], 'true');
        console.log('PASS  wallet rejection is surfaced explicitly');
    }

    {
        const h = harness({ ethereum: null });
        await h.click();
        assert.match(h.status.textContent, /META MASK NOT FOUND/, 'Missing wallet is explained in the UI');
        assert.equal(h.opened.length, 1);
        assert.match(h.opened[0][0], /metamask\.io\/download/);
        console.log('PASS  no-MetaMask fallback opens install page with a visible message');
    }

    {
        const otherRequest = async () => { throw new Error('wrong provider'); };
        const metaRequest = async args => { hCalls.push(args); return null; };
        const hCalls = [];
        const h = harness({
            ethereum: {
                providers: [
                    { isMetaMask: false, request: otherRequest },
                    { isMetaMask: true, request: metaRequest }
                ]
            }
        });
        await h.click();
        assert.equal(hCalls.length, 1, 'Multi-provider browsers use the MetaMask provider');
        assert.equal(hCalls[0].method, 'wallet_addEthereumChain');
        console.log('PASS  MetaMask provider is selected from a multi-wallet window.ethereum');
    }

    console.log('all MetaMask CTA assertions passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
