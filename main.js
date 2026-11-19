// Main entry point - initializes the game
let game = null;

document.addEventListener('DOMContentLoaded', async () => {
    game = new CribbageGame();
    window.game = game;
    setupEventListeners();
    await game.init();
    if (new URLSearchParams(location.search).has('practiceTx')) {
        const entry = document.createElement('script');
        entry.src = 'practice-entry.js';
        document.body.appendChild(entry);
    }
});

function setupEventListeners() {
    // Mode selection
    document.querySelectorAll('.mode-card').forEach(card => {
        card.addEventListener('click', () => {
            document.querySelectorAll('.mode-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
        });
    });

    // Play vs AI button — a signed-in LITEcrib account stakes real credits in
    // the server ledger against the funded AI bankroll. No account = free play.
    document.getElementById('play-ai-btn')?.addEventListener('click', async () => {
        const name = document.getElementById('player-name').value.trim().toUpperCase();
        if (!name) {
            game.showModal('ERROR', 'Enter your name first!', [{ text: 'OK', action: () => game.hideModal() }]);
            return;
        }
        game.savePlayerName(name);

        // Default to 1v1 for AI play, but use selected mode if available
        const mode = document.querySelector('.mode-card.selected')?.dataset.mode || '1v1';
        const wallet = window.LITEcribWallet;
        if (wallet && wallet.isConnected()) {
            if (mode !== '1v1') {
                game.showModal('TOKEN MATCH IS 1V1',
                    '<p>The funded AI bankroll plays head-to-head token matches. Select <strong>HEAD-TO-HEAD</strong>, then press PLAY VS AI.</p>',
                    [{ text: 'OK', action: () => game.hideModal() }]);
                return;
            }
            const result = await wallet.createAiMatch();
            if (!result.ok) {
                game.showModal('TOKEN STAKE FAILED', `<p>${game.escapeHtml(result.error || 'Could not start the match.')}</p>`, [
                    { text: 'OK', action: () => game.hideModal() }
                ]);
                return;
            }
            game.startStakedAiMatch(result.data, name);
            wallet.status('STAKED — WINNER TAKES ' + result.data.stake.winnerPoints + ' TEST PTS');
            return;
        }

        game.clearStakedMatch();
        game.isSinglePlayer = true;
        game.aiPlayers.clear();
        game.setupLocalGame(mode, name);
    });

    // Result / stats replay from the game header. Available live during a match
    // and after the result card has been dismissed.
    document.getElementById('match-stats-btn')?.addEventListener('click', () => {
        game.showLastMatchResult();
    });

    // Point recap is opt-out. The choice persists across reloads.
    document.getElementById('point-recap-toggle')?.addEventListener('click', () => {
        game.togglePointRecap();
    });

    // The lower-left recap teaser opens the same overlay as Game activity.
    document.getElementById('recap-teaser-btn')?.addEventListener('click', () => {
        const log = document.getElementById('game-log');
        if (!log) return;
        log.open = true;
    });
    document.getElementById('activity-close')?.addEventListener('click', () => {
        const log = document.getElementById('game-log');
        if (log) log.open = false;
    });
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        const log = document.getElementById('game-log');
        if (log?.open) log.open = false;
    });

    // Create table button (on landing)
    document.addEventListener('click', (e) => {
        if (e.target.id === 'create-table-btn') {
            game.showCreateTableModal();
        }
    });

    // Join button
    document.getElementById('join-btn')?.addEventListener('click', () => {
        const name = document.getElementById('player-name').value.trim().toUpperCase();
        if (!name) {
            game.showModal('ERROR', 'Enter your name first!', [{ text: 'OK', action: () => game.hideModal() }]);
            return;
        }
        game.savePlayerName(name);
        game.showModal('READY', `Name set to: ${name}. Select a table or create one.`, [
            { text: 'OK', action: () => game.hideModal() }
        ]);
    });

    // Discard modal buttons
    document.getElementById('confirm-discard')?.addEventListener('click', () => {
        game.discardToCrib();
    });

    document.getElementById('cancel-discard')?.addEventListener('click', () => {
        game.hideDiscardModal();
    });

    // Inline discard-to-crib button (the primary discard flow)
    document.getElementById('discard-btn')?.addEventListener('click', () => {
        game.discardToCrib();
    });

    // Action buttons
    document.getElementById('play-btn')?.addEventListener('click', () => {
        // Play the best (highest) legal card; cards can also be clicked directly
        game.playBestCard();
    });

    document.getElementById('go-btn')?.addEventListener('click', () => {
        game.sayGo();
    });

    document.getElementById('count-btn')?.addEventListener('click', () => {
        game.countHand();
    });

    // Modal overlay click to close
    document.getElementById('modal-overlay')?.addEventListener('click', (e) => {
        if (e.target.id === 'modal-overlay') {
            game.hideModal();
        }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT') return;
        
        switch(e.key) {
            case ' ':
                e.preventDefault();
                if (game.engine.phase === 'PLAY' && game.engine.currentPlayerIndex === game.localPlayerIndex) {
                    const playBtn = document.getElementById('play-btn');
                    if (playBtn.style.display !== 'none' && !playBtn.disabled) playBtn.click();
                }
                break;
            case 'g':
            case 'G':
                if (game.engine.phase === 'PLAY' && game.engine.currentPlayerIndex === game.localPlayerIndex) {
                    const goBtn = document.getElementById('go-btn');
                    if (goBtn.style.display !== 'none' && !goBtn.disabled) goBtn.click();
                }
                break;
            case 'Enter':
                if (game.engine.phase === 'COUNT_HAND' || game.engine.phase === 'COUNT_CRIB') {
                    const countBtn = document.getElementById('count-btn');
                    if (countBtn.style.display !== 'none' && !countBtn.disabled) countBtn.click();
                }
                break;
            case 'Escape':
                game.hideModal();
                game.hideDiscardModal();
                break;
        }
    });

    // Prevent context menu on cards
    document.addEventListener('contextmenu', (e) => {
        if (e.target.closest('.card')) e.preventDefault();
    });
}

// Closing/backgrounding the page only drops the live stream. The durable
// playerId, active table id, seat and hand all survive so the next load can
// resume the same game. pagehide covers mobile tab switches that skip
// beforeunload.
function closeLiveStream() {
    if (game?.network) game.network.disconnect();
}
window.addEventListener('beforeunload', closeLiveStream);
window.addEventListener('pagehide', closeLiveStream);

// Export for debugging
window.game = game;
