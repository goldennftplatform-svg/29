/*
 * LITEcrib MetaMask network helper.
 *
 * The button adds the official LitVM LiteForge testnet to MetaMask. It does
 * NOT connect a MetaMask account to LITEcrib credits or stake tokens: MetaMask
 * users can view/use the chain and claim test zkLTC from the official faucet.
 * Token matches still use a signed-in LITEcrib credit account.
 */
(function () {
    'use strict';

    var cfg = window.LITECRIB_CONFIG || {};
    var litvm = cfg.litvm || {};
    var chainId = Number(litvm.chainId || 4441);
    var addUrl = 'https://testnet.litvm.com';
    var installUrl = 'https://metamask.io/download/';
    var chainParam = {
        chainId: '0x' + chainId.toString(16),
        chainName: 'LitVM LiteForge',
        nativeCurrency: { name: 'zkLTC', symbol: 'zkLTC', decimals: 18 },
        rpcUrls: [litvm.rpcUrl || 'https://rpc.testnet.liteforge.zeeve.net/'],
        blockExplorerUrls: [litvm.explorer || 'https://explorer.testnet.liteforge.zeeve.net']
    };

    function statusFor(button) {
        if (!button) return document.querySelector('.metamask-status');
        var id = button.getAttribute('data-litvm-status');
        var el = id ? document.getElementById(id) : button.parentElement.querySelector('.metamask-status');
        return el || null;
    }

    function setStatus(button, text, isError) {
        var el = statusFor(button);
        if (!el) return;
        el.textContent = text || '';
        el.hidden = !text;
        if (el.setAttribute) el.setAttribute('data-error', isError ? 'true' : 'false');
    }

    function provider() {
        var p = window.ethereum;
        if (!p) return null;
        if (!p.providers || p.isMetaMask) return p;
        return p.providers.find(function (x) { return x && x.isMetaMask && typeof x.request === 'function'; }) || null;
    }

    function hasProvider() {
        var p = provider();
        return !!(p && typeof p.request === 'function');
    }

    function friendlyError(error) {
        var code = error && error.code;
        if (code === 4001) return 'CANCELLED — approve the network in MetaMask to add LitVM LiteForge.';
        if (code === 4902) return 'NETWORK NOT FOUND — try Add LitVM again.';
        if (code === -32002) return 'REQUEST OPEN — check the pending MetaMask popup.';
        return (error && error.message) ? error.message : 'COULD NOT ADD NETWORK — try again.';
    }

    async function addNetwork(button) {
        var eth = provider();
        if (!eth || typeof eth.request !== 'function') {
            setStatus(button, 'META MASK NOT FOUND — install/open MetaMask, then return here.', true);
            window.open(installUrl, '_blank', 'noopener,noreferrer');
            return;
        }
        setStatus(button, 'OPENING METAMASK…');
        try {
            await eth.request({ method: 'wallet_addEthereumChain', params: [chainParam] });
            setStatus(button, 'LITVM LITEFORGE ADDED — switch to chain ' + chainId + ' in MetaMask. Test coins have no cash value.');
        } catch (error) {
            // 4902 means "unrecognized chain" during a switch request; the add
            // request itself should not normally return it, but keep the retry.
            if (error && error.code === 4902) {
                try {
                    await eth.request({ method: 'wallet_addEthereumChain', params: [chainParam] });
                    setStatus(button, 'LITVM LITEFORGE ADDED — switch to chain ' + chainId + ' in MetaMask.');
                    return;
                } catch (retryError) { error = retryError; }
            }
            setStatus(button, friendlyError(error), true);
        }
    }

    function init() {
        var buttons = document.querySelectorAll('[data-litvm-add]');
        buttons.forEach(function (button) {
            button.addEventListener('click', function () { addNetwork(button); });
        });
        document.querySelectorAll('[data-litvm-guide]').forEach(function (link) {
            link.href = addUrl;
        });
    }

    window.LITEcribMetaMask = {
        addNetwork: addNetwork,
        chainParam: chainParam,
        hasProvider: hasProvider
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
