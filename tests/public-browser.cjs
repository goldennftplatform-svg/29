// Runs on GitHub Actions against the PUBLIC site. No local server or build.
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
// CNAME is the single source of truth for the shipping domain, so this test,
// the config.js staticHosts list and Pages cannot drift apart. The github.io
// origin stays covered as a fallback so a broken CNAME cannot silently go
// unnoticed — and when a CNAME is published it must actually redirect there.
const cname = fs.existsSync('CNAME') ? fs.readFileSync('CNAME', 'utf8').trim() : '';
const customDomain = cname ? `https://${cname}/` : null;
const fallbackOrigin = 'https://goldennftplatform-svg.github.io/29/';
const url = process.env.PUBLIC_URL || customDomain || fallbackOrigin;
const leg = url === customDomain && cname ? ` (custom domain ${cname})` : ' (github.io)';
console.log(`Testing ${url}${leg}`);
// config.js is the list the browser actually executes. Fail here with a named
// reason instead of five minutes later as an unexplained /api/ 404.
if (cname) {
    assert.equal(require('../config.js').isStaticHost(cname), true,
        `config.js staticHosts must list the published CNAME ${cname}`);
}

// A real 8x8 RGB PNG, built with zlib so CI never depends on a stored base64
// blob that might not actually decode.
function pngFixture() {
    const zlib = require('node:zlib');
    const crcTable = [];
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        crcTable[n] = c >>> 0;
    }
    const crc = buf => {
        let c = 0xFFFFFFFF;
        for (const byte of buf) c = crcTable[(c ^ byte) & 0xFF] ^ (c >>> 8);
        return (c ^ 0xFFFFFFFF) >>> 0;
    };
    const chunk = (type, data) => {
        const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
        const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
        const check = Buffer.alloc(4); check.writeUInt32BE(crc(body));
        return Buffer.concat([len, body, check]);
    };
    const size = 8;
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
    ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
    const raw = Buffer.alloc(size * (1 + size * 3));
    for (let y = 0; y < size; y++) {
        raw[y * (1 + size * 3)] = 0; // filter: none
        for (let x = 0; x < size; x++) {
            const i = y * (1 + size * 3) + 1 + x * 3;
            raw[i] = 0x14; raw[i + 1] = 0x21; raw[i + 2] = 0x36; // ink blue
        }
    }
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw)),
        chunk('IEND', Buffer.alloc(0))
    ]);
}

(async () => {
    fs.mkdirSync('public-evidence', { recursive: true });
    // Wait for Pages to publish the revision under test, rather than test stale JS.
    // Pages deploys the whole commit atomically, but WHICH files differ changes
    // per commit: gating on game.js alone let a ?v= bump in index.html run the
    // browser against the previous deployment. Every file the page loads must land.
    const watch = ['index.html', 'game.js', 'config.js', 'network.js', 'wallet.js'];
    const expected = new Map(watch.map(f => [f, fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')]));
    let published = false;
    for (let i = 0; i < 60; i++) {
        const checks = await Promise.all([...expected].map(async ([file, want]) => {
            const response = await fetch(url + file + '?revision=' + process.env.GITHUB_SHA + '&attempt=' + i);
            return response.ok && (await response.text()).replace(/\r\n/g, '\n') === want;
        }));
        if (checks.every(Boolean)) { published = true; break; }
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
    assert.ok(published, 'Pages must serve the committed files: ' + watch.join(', '));
    const browser = await chromium.launch();
    try {
        for (const [label, options, mode, country] of [
            ['desktop', { viewport: { width: 1440, height: 1000 } }, '1v1', 'kenya'],
            ['phone', devices['Pixel 7'], '1v1', 'tanzania'],
            ['trio', { viewport: { width: 1280, height: 900 } }, '3player', 'southafrica'],
            ['island', devices['Pixel 7'], '1v1', 'madagascar']
        ]) {
            const context = await browser.newContext(options);
            const page = await context.newPage();
            const errors = [];
            const httpErrors = [];
            page.on('pageerror', error => errors.push(error.message));
            page.on('response', r => { if (r.status() >= 400) httpErrors.push(r.status() + ' ' + r.url()); });
            try {
                await page.goto(url + '?test=' + process.env.GITHUB_SHA, { waitUntil: 'networkidle' });
                // With a CNAME published, github.io only ever hands off to the
                // custom domain. Landing anywhere else means the CNAME is not
                // actually in force, which a bare "/" probe would miss.
                if (url === fallbackOrigin && cname) {
                    assert.equal(new URL(page.url()).hostname, cname, 'github.io must redirect to the published custom domain');
                }
                await page.waitForFunction(() => window.game && window.game.network.connected);
                await page.locator('#country-select').selectOption(country);
                if (label === 'desktop') {
                    // Real PNG fixture exercises upload/resize/storage; not a generated PFP.
                    await page.locator('#portrait-upload').setInputFiles({ name:'fixture.png', mimeType:'image/png', buffer:pngFixture() });
                    await page.waitForFunction(() => !!document.querySelector('#portrait-preview img'));
                    assert.equal(await page.evaluate(() => document.querySelector('#portrait-preview img').src.startsWith('data:image/jpeg;base64,')), true, 'Portrait is stored as a resized JPEG');
                }
                // Static hosting has no relay, so no /api/* request may fail loudly.
                assert.deepEqual(httpErrors.filter(e => e.includes('/api/')), [], 'No failed relay requests on static hosting');
                await page.locator('#player-name').fill('GITHUB TEST');
                await page.locator('#join-btn').click();
                await page.locator('#modal-actions [data-action="OK"]').click();
                await page.locator('.mode-card[data-mode="' + mode + '"]').click();
                await page.locator('#play-ai-btn').click();
                await page.waitForFunction(() => document.querySelector('#game-screen').classList.contains('active'));
                assert.equal(await page.evaluate(() => game.engine.players.length), mode === '1v1' ? 2 : 3);
                assert.equal(await page.evaluate(() => game.engine.phase), 'DISCARD');
                assert.equal(await page.evaluate(() => game.boardGeo.key), country);
                assert.equal(await page.locator('[data-lane="0"] [data-hole]').count(), 122);
                assert.equal(await page.locator('#board-track [data-lane]').count(), mode === '1v1' ? 2 : 3);
                if (label === 'desktop') assert.equal(await page.locator('#local-seat img').count(), 1);
                await page.waitForFunction(() => game.engine.getState(game.localPlayerIndex).canDiscard);
                const discardCount = await page.evaluate(() => game.engine.getState(game.localPlayerIndex).discardCount);
                for (let i = 0; i < discardCount; i++) {
                    await page.locator('#hand-cards .card[data-index="' + i + '"]').click();
                }
                await page.locator('#discard-btn').click();
                await page.waitForFunction(() => game.engine.phase !== 'DISCARD');
                let played = 0;
                let counted = 0;
                const deadline = Date.now() + 90000;
                while (Date.now() < deadline) {
                    const phase = await page.evaluate(() => game.engine.phase);
                    if (phase === 'DISCARD') break; // Next hand after scoring.
                    for (const selector of ['#play-btn', '#go-btn', '#count-btn']) {
                        const button = page.locator(selector);
                        if (await button.isVisible() && await button.isEnabled()) {
                            // The centered action bar reflows as buttons appear and
                            // disappear with each phase, so a strict stability wait
                            // can spin the full 30s on a button that never settles.
                            // Visibility and enabled are already checked above.
                            await button.click({ force: true });
                            if (selector === '#play-btn') played++;
                            if (selector === '#count-btn') counted++;
                            break;
                        }
                    }
                    await page.waitForTimeout(250);
                }
                assert.ok(played > 0, 'Human played cards through the UI');
                assert.ok(counted > 0, 'Human counted through the UI');
                assert.equal(await page.evaluate(() => game.engine.phase), 'DISCARD', 'Scoring completes and the next hand is dealt');
                await page.screenshot({ path: 'public-evidence/' + label + '.png', fullPage: true });
                assert.deepEqual(errors, [], 'No uncaught browser errors');
                console.log(label + ': public landing, buttons, discard, play, count and next hand PASS');
            } finally {
                fs.writeFileSync('public-evidence/' + label + '-errors.json', JSON.stringify(errors));
                await context.close();
            }
        }
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
