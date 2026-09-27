/*
 * LITEcrib store — durable JSON persistence for accounts (users + custody
 * mnemonics) with atomic writes. Sessions are intentionally NOT persisted:
 * a token is a bearer for THIS process; restarting invalidates them and the
 * client re-logs-in. Users however must survive restarts.
 *
 * The store file is plaintext on the host. That is acceptable for a prizeless
 * testnet prototype; production must encrypt custody mnemonics at rest
 * (KMS envelope encryption) and run the store behind a separate service.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const FILE = process.env.LITECRIB_STORE_FILE ||
    path.join(__dirname, 'data', 'users.json');
const MATCH_FILE = process.env.LITECRIB_MATCH_FILE ||
    path.join(__dirname, 'data', 'matches.json');

let users = [];
let matches = [];
let loading = false;

function normalize(u) {
    if (typeof u.credits !== 'number' || !isFinite(u.credits)) u.credits = 0;
    if (typeof u.creditsClaimedSats !== 'number' || !isFinite(u.creditsClaimedSats)) u.creditsClaimedSats = 0;
    if (typeof u.preferredProvider !== 'string' || !u.preferredProvider) u.preferredProvider = 'custodial';
    if (!Array.isArray(u.ledger)) u.ledger = [];
    if (typeof u.feeGeneratedPts !== 'number' || !isFinite(u.feeGeneratedPts)) u.feeGeneratedPts = 0;
    if (typeof u.totalGenerationPts !== 'number' || !isFinite(u.totalGenerationPts)) u.totalGenerationPts = 0;
    return u;
}

function load() {
    try {
        users = JSON.parse(fs.readFileSync(FILE, 'utf8'));
        if (!Array.isArray(users)) users = [];
        users.forEach(normalize);
    } catch (e) {
        users = [];
    }
    try {
        matches = JSON.parse(fs.readFileSync(MATCH_FILE, 'utf8'));
        if (!Array.isArray(matches)) matches = [];
    } catch (e) {
        matches = [];
    }
    loading = true;
    return users;
}

function flush() {
    const dir = path.dirname(FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = FILE + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(users, null, 2));
    fs.renameSync(tmp, FILE);           // atomic on same volume
}

function addUser(user) {
    users.push(normalize(user));
    flush();
}

function getUser(id) {
    return users.find((u) => u.id === id) || null;
}

function findByEmail(email) {
    return users.find((u) => u.email === email) || null;
}

function bySnapshot() {
    return users.map((u) => ({
        id: u.id, email: u.email, address: u.address, path: u.path, createdAt: u.createdAt
    }));
}

function updateUser(id) {
    const u = getUser(id);
    if (u) {
        normalize(u);
        flush();
    }
    return u;
}

function ledgerPush(u, entry) {
    u.ledger.push(entry);
    if (u.ledger.length > 200) u.ledger = u.ledger.slice(u.ledger.length - 200);
}

function flushMatches() {
    const dir = path.dirname(MATCH_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = MATCH_FILE + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(matches, null, 2));
    fs.renameSync(tmp, MATCH_FILE);
}

function upsertMatch(m) {
    const i = matches.findIndex((x) => x.id === m.id);
    if (i >= 0) matches[i] = m; else matches.push(m);
    flushMatches();
    return m;
}

function getMatch(id) {
    return matches.find((x) => x.id === id) || null;
}

function listMatches() {
    return matches;
}

module.exports = { load, addUser, getUser, findByEmail, bySnapshot, updateUser, ledgerPush, upsertMatch, getMatch, listMatches, _file: FILE, _matchFile: MATCH_FILE, _flush: flush, _flushMatches: flushMatches };