/* Demo leaderboard. Scores are sample data only; no server writes, no
   wallet/token interaction, and no claim that these are real player results. */
(function () {
    'use strict';

    var boards = {
        all: [
            { name: 'ZEROCOOL', score: 29, note: 'Classic · 4 days ago' },
            { name: 'ROYALFLUSH', score: 28, note: '3-player · 2 days ago' },
            { name: 'PEGWIZARD', score: 27, note: 'Classic · 6 hours ago' },
            { name: 'YOU (DEMO)', score: 26, note: 'Classic · today', you: true },
            { name: 'TALLYHO', score: 25, note: 'Classic · yesterday' },
            { name: 'MINTCRAB', score: 24, note: '3-player · 3 days ago' }
        ],
        weekly: [
            { name: 'PEGWIZARD', score: 27, note: 'Classic · 6 hours ago' },
            { name: 'YOU (DEMO)', score: 26, note: 'Classic · today', you: true },
            { name: 'TALLYHO', score: 25, note: 'Classic · yesterday' },
            { name: 'SUNSETPEG', score: 23, note: 'Classic · 2 days ago' },
            { name: 'CRABKING', score: 22, note: '3-player · 4 days ago' }
        ],
        friends: [
            { name: 'YOU (DEMO)', score: 26, note: 'Classic · today', you: true },
            { name: 'TALLYHO', score: 25, note: 'Classic · yesterday' },
            { name: 'MINTCRAB', score: 24, note: '3-player · 3 days ago' },
            { name: 'SUNSETPEG', score: 23, note: 'Classic · 2 days ago' }
        ]
    };

    var overlay = document.getElementById('leaderboard-overlay');
    if (!overlay) return;

    var list = document.getElementById('leaderboard-list');
    var tabs = Array.prototype.slice.call(overlay.querySelectorAll('[data-leaderboard-board]'));
    var closeBtn = overlay.querySelector('.leaderboard-close');
    var backdrop = overlay.querySelector('.leaderboard-backdrop');
    var heroScore = document.getElementById('leaderboard-hero-score');
    var heroName = document.getElementById('leaderboard-hero-name');
    var heroNote = document.getElementById('leaderboard-hero-note');
    var stripScore = document.getElementById('top-score-value');
    var stripWho = document.getElementById('top-score-who');
    var stripNote = document.getElementById('top-score-note');
    var lastFocus = null;
    var current = 'all';

    function render(key) {
        if (!boards[key]) return;
        current = key;
        var rows = boards[key];
        tabs.forEach(function (tab) {
            tab.setAttribute('aria-selected', tab.getAttribute('data-leaderboard-board') === key ? 'true' : 'false');
        });

        if (list) {
            list.innerHTML = rows.map(function (row, index) {
                return '<li class="leaderboard-row' + (row.you ? ' is-you' : '') + '">' +
                    '<span class="leaderboard-rank">' + (index + 1) + '</span>' +
                    '<div class="leaderboard-player"><strong>' + row.name + '</strong><small>' + row.note + '</small></div>' +
                    '<div class="leaderboard-score"><b>' + row.score + '</b><small>PTS</small></div>' +
                    '</li>';
            }).join('');
        }

        var top = rows[0];
        if (heroScore) heroScore.textContent = top.score + ' PTS';
        if (heroName) heroName.textContent = top.name;
        if (heroNote) heroNote.textContent = top.note;
        if (key === 'all') {
            if (stripScore) stripScore.textContent = top.score + ' PTS';
            if (stripWho) stripWho.textContent = top.name;
            if (stripNote) stripNote.textContent = 'SAMPLE RANK · ' + top.note.toUpperCase();
        }
    }

    function open() {
        lastFocus = document.activeElement;
        overlay.hidden = false;
        document.body.classList.add('leaderboard-open');
        render(current);
        if (closeBtn) closeBtn.focus();
    }

    function close() {
        overlay.hidden = true;
        document.body.classList.remove('leaderboard-open');
        if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
    }

    tabs.forEach(function (tab) {
        tab.addEventListener('click', function () { render(tab.getAttribute('data-leaderboard-board')); });
    });

    document.addEventListener('click', function (event) {
        var opener = event.target.closest ? event.target.closest('[data-leaderboard-open]') : null;
        if (!opener) return;
        // The wallet dropdown is a portaled <body> child; close it before
        // showing a second full-screen layer so Escape has one clear target.
        var walletToggle = document.getElementById('wallet-toggle');
        if (walletToggle && walletToggle.getAttribute('aria-expanded') === 'true') walletToggle.click();
        open();
    });

    if (closeBtn) closeBtn.addEventListener('click', close);
    if (backdrop) backdrop.addEventListener('click', close);
    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && !overlay.hidden) {
            event.stopPropagation();
            close();
        }
    });

    render('all');
})();
