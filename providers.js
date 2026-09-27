'use strict';

const bip39 = require('bip39');
const { BIP32Factory } = require('bip32');
const ecc = require('tiny-secp256k1');
const { keccak256 } = require('js-sha3');

const bip32 = BIP32Factory(ecc);
const EVM_PATH = "m/44'/60'/0'/0/0";

const registry = [
    {
        id: 'custodial',
        label: 'LITEcrib Custody Wallet',
        kind: 'custodial',
        coin: 'LTC',
        network: 'testnet',
        enabled: true,
        feeNote: 'Match settlement 0.5% of the pot. No deposit or withdrawal fees.',
        desc: 'App-side HD wallet: your deposit address, app balance, house-escrowed PvP matches, and self-custody key export.'
    },
    {
        id: 'litvm',
        label: 'LitVM · zkLTC',
        kind: 'evm',
        coin: 'zkLTC',
        network: 'testnet',
        chainId: 4441,
        rpcUrl: 'https://liteforge.rpc.caldera.xyz/http',
        explorer: 'https://liteforge.explorer.caldera.xyz',
        enabled: true,
        feeNote: 'Settle on LiteForge testnet. Chain gas only; the house match fee is still 0.5%.',
        desc: 'Derived EVM address (m/44\u2032/60\u2032) mirroring your custody wallet — the same seed, on Litecoin\u2019s rollup. Balance read on-chain.'
    },
    {
        id: 'swap',
        label: 'Swap Top-Up',
        kind: 'swap',
        coin: 'cross-chain',
        network: 'any',
        enabled: true,
        feeNote: 'Swap partner takes their own rate (~0.5-2%). House stays 0.5%.',
        desc: 'Top up your deposit address from any chain (BTC, ETH, TRX, USDT) through an aggregated swap straight to tLTC.'
    }
];

function find(id) {
    return registry.find((p) => p.id === id) || null;
}

function list() {
    return registry.map((p) => ({ ...p }));
}

function evmAddress(mnemonic) {
    try {
        const seed = bip39.mnemonicToSeedSync(String(mnemonic));
        const node = bip32.fromSeed(seed).derivePath(EVM_PATH);
        const hash = keccak256(Buffer.from(node.publicKey).slice(1));
        return '0x' + hash.slice(hash.length - 40);
    } catch (e) {
        return null;
    }
}

module.exports = { registry, find, list, evmAddress, EVM_PATH };