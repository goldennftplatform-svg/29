/*
 * LITEcrib shared config — PUBLIC values only. No secrets live here.
 *
 * Served to the browser AND used by server.js. The server additionally reads
 * process.env for RPC credentials (see payments.js):
 *
 *   LTC_NETWORK=testnet|mainnet      which chain we're on
 *   LTC_INDEXER_URL=...                override the litecoinspace.org base
 *   LTC_RPC_URL=...                    Litecoin Core JSON-RPC endpoint
 *   LTC_RPC_USER / LTC_RPC_PASS=...    Core RPC credentials
 *   LITECRIB_FEATURES=...              JSON overrides, e.g. {"paymentsEnabled":false}
 *
 * TODO(LitVM): add LITVM_RPC_URL / LITVM_CHAIN_ID here and make the wallet
 * panel settle through a PaymentsProvider implementation backed by LitVM
 * instead of mempool.space.
 */
(function (root) {
    'use strict';

    function baseIndexerFor(network) {
        return network === 'mainnet'
            ? 'https://litecoinspace.org/api'
            : 'https://litecoinspace.org/testnet/api';
    }

    var network = 'testnet';
    if (typeof process !== 'undefined' && process.env && process.env.LTC_NETWORK) {
        network = process.env.LTC_NETWORK;
    }

    // Hosts that serve this bundle but have no relay API behind them, so every
    // /api/* call there is a guaranteed 404/405. Kept in ONE place: network.js
    // and wallet.js both ask this predicate instead of each guessing, which is
    // how a published custom domain ended up probing /api/health on CI.
    // Matching is exact-or-subdomain, so www.29.aisp.live is covered too.
    var staticHosts = ['github.io', '29.aisp.live'];

    function isStaticHost(hostname) {
        var host = String(hostname == null ? '' : hostname).toLowerCase().replace(/\.+$/, '');
        if (!host) return false;
        for (var i = 0; i < staticHosts.length; i++) {
            var suffix = String(staticHosts[i]).toLowerCase();
            if (host === suffix || host.endsWith('.' + suffix)) return true;
        }
        return false;
    }

    var cfg = {
        brand: 'LITEcrib',
        network: network,
        features: {
            paymentsEnabled: true,   // LTC deposit panel in the lobby
            litvmEnabled: false       // LitVM on-chain settlement (roadmap)
        },
        indexerBase: baseIndexerFor(network),
        baseIndexerFor: baseIndexerFor,
        staticHosts: staticHosts,
        isStaticHost: isStaticHost,
        version: '1.2.0'
    };

    if (typeof process !== 'undefined' && process.env) {
        if (process.env.LTC_INDEXER_URL) cfg.indexerBase = process.env.LTC_INDEXER_URL;
        if (process.env.LITECRIB_FEATURES) {
            try { Object.assign(cfg.features, JSON.parse(process.env.LITECRIB_FEATURES)); } catch (e) {}
        }
    }

    cfg.public = function () {
        return {
            brand: cfg.brand,
            network: cfg.network,
            version: cfg.version,
            features: cfg.features,
            indexerBase: cfg.indexerBase,
            staticHosts: staticHosts.slice(),
            isStaticHost: isStaticHost,
            litvm: {
                chainId: Number((typeof process !== 'undefined' && process.env && process.env.LITVM_CHAIN_ID) || 4441),
                rpcUrl: (typeof process !== 'undefined' && process.env && process.env.LITVM_RPC_URL) || 'https://liteforge.rpc.caldera.xyz/http',
                explorer: 'https://liteforge.explorer.caldera.xyz',
                gasToken: 'zkLTC',
                live: false
            }
        };
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = cfg;
    }
    if (root) {
        root.LITECRIB_CONFIG = cfg.public();
    }
})(typeof window !== 'undefined' ? window : globalThis);