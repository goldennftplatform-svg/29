// Main entry point - initializes the game
let game = null;

document.addEventListener('DOMContentLoaded', async () => {
    game = new CribbageGame();
    await game.init();
    setupEventListeners();
});

function setupEventListeners() {
    // Mode selection
    document.querySelectorAll('.mode-card').forEach(card => {
        card.addEventListener('click', () => {
            document.querySelectorAll('.mode-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
        });
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

    // Action buttons
    document.getElementById('play-btn')?.addEventListener('click', () => {
        // Play selected card
        const selected = document.querySelector('.hand-cards .card.selected');
        if (selected) {
            const idx = parseInt(selected.dataset.index);
            game.playCard(idx);
        }
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

// Handle page unload
window.addEventListener('beforeunload', () => {
    if (game?.network) {
        game.network.disconnect();
    }
});

// Export for debugging
window.game = game;