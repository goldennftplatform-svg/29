// Static checks for PWA installability + mobile wallet dropdown hardening.
// Runs locally with no browser dependency; public-browser.cjs covers behavior.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const exists = file => fs.existsSync(path.join(root, file));

// Manifest: installable identity, standalone display, real icons.
assert.ok(exists('manifest.webmanifest'), 'PWA manifest must ship');
const manifest = JSON.parse(read('manifest.webmanifest'));
assert.equal(manifest.display, 'standalone', 'PWA opens without browser chrome');
assert.equal(manifest.start_url, './', 'PWA starts at the game root');
assert.equal(manifest.scope, './', 'PWA scope covers the whole game');
assert.ok(manifest.icons.some(i => i.sizes === '192x192' && i.src.includes('icon-192.png')), '192px icon is listed');
assert.ok(manifest.icons.some(i => i.sizes === '512x512' && i.src.includes('icon-512.png')), '512px icon is listed');
for (const icon of ['icons/icon-192.png', 'icons/icon-512.png', 'icons/icon.svg']) {
    assert.ok(exists(icon), 'Icon must exist: ' + icon);
}

// Service worker: versioned shell only, no API/privy/RPC caching.
assert.ok(exists('sw.js'), 'Service worker must ship');
const sw = read('sw.js');
assert.match(sw, /const CACHE = 'litecrib-v/, 'Cache is versioned');
assert.match(sw, /url\.pathname\.startsWith\('\/api\/'\)/, 'Relay/account APIs never enter the cache');
assert.match(sw, /url\.origin !== self\.location\.origin/, 'Cross-origin Privy/RPC/font requests bypass the cache');
assert.match(sw, /caches\.match\('\.\/index\.html'\)/, 'Offline navigation falls back to the game shell');
for (const asset of ['manifest.webmanifest', 'square.js', 'leaderboard.css', 'leaderboard.js', 'wallet-assets/wallet.js', 'social-preview.png']) {
    assert.ok(sw.includes(asset), 'Service worker pre-caches ' + asset);
}

// index.html: platform tags, registration, and escape-hatch fallback.
const html = read('index.html');
assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/, 'Manifest is linked');
assert.match(html, /<link rel="apple-touch-icon"/, 'iOS home-screen icon is linked');
assert.match(html, /name="apple-mobile-web-app-capable" content="yes"/, 'iOS standalone mode requested');
assert.match(html, /navigator\.serviceWorker\.register\('\.\/sw\.js'\)/, 'Service worker is registered');
assert.match(html, /location\.protocol === 'https:' \|\| location\.hostname === 'localhost'/, 'Registration is secure-context gated');

// Mobile dropdown: portaled to body so backdrop-filter/overflow cannot clip it,
// safe-area insets so the iOS notch cannot cover the trigger or the panel.
assert.match(html, /document\.body\.appendChild\(menu\)/, 'Wallet menu is portaled to <body> while open');
assert.match(html, /menuParent\.insertBefore\(menu, menuSlot\)/, 'Wallet menu returns to its slot on close');
const dropdown = read('wallet-dropdown.css');
assert.match(dropdown, /#wallet-menu\.wallet-menu-floating/, 'Floating dropdown styling exists');
assert.match(dropdown, /env\(safe-area-inset-top/, 'Floating dropdown respects the iOS safe area');
assert.match(dropdown, /touch-action: manipulation/, 'Wallet trigger avoids mobile double-tap zoom delay');
const shell = read('app-shell.css');
assert.match(shell, /env\(safe-area-inset-top/, 'App header respects the iOS safe area');
assert.match(read('styles.css'), /\.header-wallet-link \{[^}]*min-height: 44px/s, 'Wallet trigger is a 44px touch target');

// Demo leaderboard: mobile-safe entry points and honest fake-data copy.
const boardCss = read('leaderboard.css');
const boardJs = read('leaderboard.js');
assert.match(html, /id="leaderboard-toggle"/, 'Trophy button ships');
assert.match(html, /id="leaderboard-overlay"/, 'Leaderboard sheet ships');
assert.match(html, /top-score-strip/, 'Top-score teaser ships');
assert.match(html, /class="wallet-dropdown-board"/, 'Wallet menu links to the leaderboard');
assert.match(boardCss, /env\(safe-area-inset-bottom/, 'Bottom sheet respects the iOS home indicator');
assert.match(boardCss, /@media \(max-width: 700px\)/, 'Leaderboard has a phone layout');
assert.match(boardCss, /min-height: 44px/, 'Leaderboard controls are touch-sized');
assert.match(html, /DEMO DATA/, 'Leaderboard tells players the data is fake');
assert.match(html, /no cash value/, 'Leaderboard keeps test-token disclosure');

// Square seam: present, public-safe, and off by default.
const cfg = require('../config.js');
assert.equal(cfg.features.squareEnabled, false, 'Square SDK stays disabled by default');
assert.equal(cfg.public().square.enabled, false, 'Browser config keeps Square disabled');
assert.equal(cfg.public().square.mode, 'test', 'Square seam is test-mode only');
const square = read('square.js');
assert.match(square, /squareEnabled/, 'Square module reads the gated feature flag');
assert.doesNotMatch(square, /access[_-]?token\s*[:=]\s*['"]/i, 'No Square access token is embedded');

// Relay must serve the manifest with the right MIME type for install prompts.
const server = read('server.js');
assert.match(server, /'\.webmanifest': 'application\/manifest\+json/, 'Manifest MIME type is registered');

console.log('PWA + mobile dropdown checks passed');
