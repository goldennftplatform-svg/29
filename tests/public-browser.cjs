// Runs on GitHub Actions against the PUBLIC site. No local server or build.
const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const url = 'https://goldennftplatform-svg.github.io/29/';

(async () => {
    fs.mkdirSync('public-evidence', { recursive: true });
    // Wait for Pages to publish the revision under test, rather than test stale JS.
    const expected = fs.readFileSync('network.js', 'utf8').replace(/\r\n/g, '\n');
    let published = false;
    for (let i = 0; i < 60; i++) {
        const response = await fetch(url + 'network.js?revision=' + process.env.GITHUB_SHA + '&attempt=' + i);
        if (response.ok && (await response.text()).replace(/\r\n/g, '\n') === expected) {
            published = true;
            break;
        }
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
    assert.ok(published, 'Pages must serve the committed networking file');
    const browser = await chromium.launch();
    try {
        for (const [label, options, mode] of [
            ['desktop', { viewport: { width: 1440, height: 1000 } }, '1v1'],
            ['phone', devices['Pixel 7'], '1v1'],
            ['trio', { viewport: { width: 1280, height: 900 } }, '3player']
        ]) {
            const context = await browser.newContext(options);
            const page = await context.newPage();
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            try {
                await page.goto(url + '?test=' + process.env.GITHUB_SHA, { waitUntil: 'networkidle' });
                await page.waitForFunction(() => window.game && window.game.network.connected);
                await page.locator('#player-name').fill('GITHUB TEST');
                await page.locator('#join-btn').click();
                await page.locator('#modal-actions [data-action="OK"]').click();
                await page.locator('.mode-card[data-mode="' + mode + '"]').click();
                await page.locator('#play-ai-btn').click();
                await page.waitForFunction(() => document.querySelector('#game-screen').classList.contains('active'));
                assert.equal(await page.evaluate(() => game.engine.players.length), mode === '1v1' ? 2 : 3);
                assert.equal(await page.evaluate(() => game.engine.phase), 'DISCARD');
                await page.screenshot({ path: 'public-evidence/' + label + '.png', fullPage: true });
                assert.deepEqual(errors, [], 'No uncaught browser errors');
                console.log(label + ': public landing, name button, mode selection and AI game start PASS');
            } finally {
                fs.writeFileSync('public-evidence/' + label + '-errors.json', JSON.stringify(errors));
                await context.close();
            }
        }
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
