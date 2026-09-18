class CribbageGame {
    constructor() {
        this.engine = new CribbageEngine(2);
        this.network = new GameNetwork();
        this.localPlayerIndex = -1;
        this.selectedCards = new Set();
        this.discardSelection = new Set();
        this.animationsEnabled = true;
        this.soundEnabled = true;
        this.gameLog = [];
        this.aiPlayers = new Map(); // playerIndex -> CribbageAI
        this.aiThinking = false;
        this.isSinglePlayer = false;
        
        this.setupNetworkListeners();
    }

    setupNetworkListeners() {
        this.network.on('connected', (data) => {
            this.updateConnectionStatus(true);
            this.loadTables();
        });

        this.network.on('disconnected', () => {
            this.updateConnectionStatus(false);
        });

        this.network.on('state', (state) => {
            this.handleStateUpdate(state);
        });

        this.network.on('tableList', (tables) => {
            this.renderTableList(tables);
        });

        this.network.on('chat', (chat) => {
            this.addLogEntry(`${chat.playerName}: ${chat.message}`, 'system');
        });
    }

    async init() {
        try {
            await this.network.connect();
            this.loadPlayerName();
            this.loadTables();
        } catch (e) {
            console.error('Failed to connect:', e);
            this.showModal('Connection Failed', 'Could not connect to game server. Playing in demo mode.', [
                { text: 'OK', action: () => this.hideModal() }
            ]);
        }
    }

    loadPlayerName() {
        const saved = localStorage.getItem('cribbage_player_name');
        if (saved) {
            document.getElementById('player-name').value = saved;
        }
    }

    savePlayerName(name) {
        localStorage.setItem('cribbage_player_name', name);
    }

    loadTables() {
        const tables = this.network.getTableList();
        this.renderTableList(tables);
    }

    renderTableList(tables) {
        const grid = document.getElementById('tables-grid');
        if (!tables || tables.length === 0) {
            grid.innerHTML = `
                <div class="table-card empty">
                    <div class="table-icon">🌴</div>
                    <p>No tables yet</p>
                    <button class="pixel-btn create-table-btn" id="create-table-btn">CREATE TABLE</button>
                </div>
            `;
            document.getElementById('create-table-btn').addEventListener('click', () => this.showCreateTableModal());
            return;
        }

        grid.innerHTML = tables.map(table => {
            const playerCount = table.players.length;
            const maxPlayers = table.mode === '1v1' ? 2 : 3;
            const isFull = playerCount >= maxPlayers;
            const isCurrentPlayer = table.players.some(p => p.id === this.network.playerId);
            
            return `
                <div class="table-card ${isFull ? 'full' : ''} ${isCurrentPlayer ? 'current' : ''}" data-table-id="${table.id}">
                    <div class="table-icon">${table.mode === '1v1' ? '🦒' : '🦏'}</div>
                    <h4>${table.mode === '1v1' ? 'HEAD-TO-HEAD' : 'SAFARI TRIO'}</h4>
                    <div class="table-meta">Table #${table.id.slice(-5).toUpperCase()}</div>
                    <div class="table-players">
                        ${Array.from({length: maxPlayers}, (_, i) => `
                            <div class="player-dot ${i < playerCount ? 'filled' : ''} ${isCurrentPlayer && table.players[i]?.id === this.network.playerId ? 'current' : ''}"></div>
                        `).join('')}
                    </div>
                    ${isFull ? '<div class="table-full">FULL</div>' : ''}
                </div>
            `;
        }).join('');

        // Add click handlers
        grid.querySelectorAll('.table-card:not(.empty):not(.full)').forEach(card => {
            card.addEventListener('click', () => this.joinTable(card.dataset.tableId));
        });
    }

    showCreateTableModal() {
        const mode = document.querySelector('.mode-card.selected')?.dataset.mode || '1v1';
        this.showModal('CREATE TABLE', `
            <p>Create a new ${mode === '1v1' ? 'Head-to-Head' : 'Safari Trio'} table?</p>
        `, [
            { text: 'CREATE', action: () => this.createTable(mode), class: 'primary' },
            { text: 'CANCEL', action: () => this.hideModal() }
        ]);
    }

    createTable(mode) {
        const name = document.getElementById('player-name').value.trim().toUpperCase();
        if (!name) {
            this.showModal('ERROR', 'Enter your name first!', [{ text: 'OK', action: () => this.hideModal() }]);
            return;
        }

        this.savePlayerName(name);
        
        // Check if we should add AI opponents (single player mode)
        const addAI = mode === '1v1' || mode === '3player';
        
        this.isSinglePlayer = addAI;
        if (addAI) {
            // Create local game with AI
            this.setupLocalGame(mode, name);
        } else {
            const result = this.network.createTable(mode, name);
            this.joinGame(result.tableId);
        }
        this.hideModal();
    }

    setupLocalGame(mode, playerName) {
        const playerCount = mode === '1v1' ? 2 : 3;
        this.engine = new CribbageEngine(playerCount);
        
        // Add human player
        this.engine.addPlayer(playerName, 'human_' + Date.now());
        
        // Add AI players
        const difficulties = ['medium', 'hard'];
        for (let i = 1; i < playerCount; i++) {
            const aiName = this.getAIName(i);
            const aiId = 'ai_' + i + '_' + Date.now();
            this.engine.addPlayer(aiName, aiId);
            this.aiPlayers.set(i, new CribbageAI(difficulties[(i-1) % difficulties.length]));
        }
        
        this.localPlayerIndex = 0;
        this.engine.setLocalPlayerIndex(0);
        this.engine.startGame();
        
        this.joinLocalGame();
    }

    getAIName(index) {
        const names = ['🦁 SIMBA', '🦓 ZARA', '🦏 KIFARU', '🐘 TEMBO', '🦒 TWIGA', '🐆 CHUI'];
        return names[(index - 1) % names.length];
    }

    joinLocalGame() {
        document.getElementById('landing-screen').classList.remove('active');
        document.getElementById('game-screen').classList.add('active');
        
        document.getElementById('table-id-display').textContent = 'LOCAL SAFARI';
        document.getElementById('mode-badge').textContent = this.engine.playerCount === 2 ? '1v1' : '3P';
        document.getElementById('status-dot').classList.add('connected');
        document.getElementById('status-text').textContent = 'LOCAL GAME';
        
        const state = this.engine.getState(this.localPlayerIndex);
        this.renderGameState(state);
        
        this.addLogEntry('Welcome to the Savannah! 🦁', 'system');
        this.checkAITurn(state);
    }

    joinTable(tableId) {
        const name = document.getElementById('player-name').value.trim().toUpperCase();
        if (!name) {
            this.showModal('ERROR', 'Enter your name first!', [{ text: 'OK', action: () => this.hideModal() }]);
            return;
        }

        this.savePlayerName(name);
        const result = this.network.joinTable(tableId, name);
        if (result.success) {
            this.joinGame(tableId);
        } else {
            this.showModal('ERROR', result.error, [{ text: 'OK', action: () => this.hideModal() }]);
        }
    }

    joinGame(tableId) {
        this.tableId = tableId;
        document.getElementById('landing-screen').classList.remove('active');
        document.getElementById('game-screen').classList.add('active');
        
        document.getElementById('table-id-display').textContent = `TABLE #${tableId.slice(-5).toUpperCase()}`;
        
        const tableState = this.network.getTableState();
        if (tableState?.state) {
            this.handleStateUpdate(tableState.state);
        }
        
        this.addLogEntry('Joined the safari!', 'system');
    }

    handleStateUpdate(state) {
        // Find our player index
        const playerIdx = state.players.findIndex(p => p.id === this.network.playerId);
        if (playerIdx !== -1) {
            this.localPlayerIndex = playerIdx;
            this.engine.setLocalPlayerIndex(playerIdx);
        }

        // Update engine state
        this.engine.phase = state.phase;
        this.engine.dealerIndex = state.dealerIndex;
        this.engine.currentPlayerIndex = state.currentPlayer;
        this.engine.scores = state.scores;
        this.engine.pegs = state.pegs;
        this.engine.crib = (state.crib || []).map(s => Card.fromString(s));
        this.engine.starter = state.starter ? Card.fromString(state.starter) : null;
        this.engine.playPile = (state.playPile || []).map(p => ({ card: Card.fromString(p.card), player: p.player }));
        this.engine.playCount = state.playCount;
        this.engine.hands = state.players.map((p, i) => 
            i === this.localPlayerIndex ? (state.hand || []).map(s => Card.fromString(s)) : []
        );

        this.renderGameState(state);
    }

    renderGameState(state) {
        // Update mode badge
        const mode = state.players.length === 2 ? '1v1' : '3P';
        document.getElementById('mode-badge').textContent = mode;

        // Update player scores on board
        this.renderCribBoard(state);

        // Update opponents
        this.renderOpponents(state);

        // Update center area
        this.renderCenterArea(state);

        // Update player hand
        this.renderPlayerHand(state);

        // Update actions
        this.renderActions(state);

        // Update phase indicator
        this.renderPhaseIndicator(state);

        // Update peg display
        this.renderPegDisplay(state);
    }

    renderCribBoard(state) {
        const track = document.getElementById('board-track');
        track.innerHTML = '';
        
        // Create 121 holes (standard cribbage board)
        for (let i = 1; i <= 121; i++) {
            const hole = document.createElement('div');
            hole.className = 'board-hole';
            hole.dataset.position = i;
            
            // Check for pegs
            state.players.forEach((player, idx) => {
                if (player.pegs[0] === i) {
                    hole.classList.add('peg-front');
                    hole.dataset.pegFront = idx;
                }
                if (player.pegs[1] === i) {
                    hole.classList.add('peg-back');
                    hole.dataset.pegBack = idx;
                }
            });
            
            track.appendChild(hole);
        }

        // Scroll to current leader
        const maxScore = Math.max(...state.scores);
        const leaderPos = maxScore % 121 || 121;
        const holeEl = track.querySelector(`[data-position="${leaderPos}"]`);
        if (holeEl) {
            holeEl.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }

        // Player score entries
        const scoreContainer = document.getElementById('player-scores');
        scoreContainer.innerHTML = state.players.map((player, idx) => `
            <div class="player-score-entry ${idx === state.currentPlayer ? 'current' : ''}">
                <span class="name">${this.escapeHtml(player.name)}</span>
                <span class="score">${player.score}</span>
            </div>
        `).join('');
    }

    renderOpponents(state) {
        const area = document.getElementById('opponents-area');
        const opponents = state.players.filter((_, i) => i !== this.localPlayerIndex);
        
        area.innerHTML = opponents.map((player, idx) => {
            const actualIdx = state.players.findIndex(p => p.id === player.id);
            const isDealer = actualIdx === state.dealerIndex;
            const isCurrent = actualIdx === state.currentPlayer && state.phase === 'PLAY';
            
            return `
                <div class="opponent-panel ${isCurrent ? 'current-turn' : ''} ${isDealer ? 'dealer' : ''}" data-player="${actualIdx}">
                    <div class="opponent-name">${this.escapeHtml(player.name)}</div>
                    <div class="opponent-cards">
                        ${Array.from({length: player.handSize}, (_, i) => `
                            <div class="opponent-card-back">🂠</div>
                        `).join('')}
                    </div>
                    <div class="opponent-score">SCORE: ${player.score}</div>
                    <div class="opponent-pegs">📍 ${player.pegs[0]} / 📍 ${player.pegs[1]}</div>
                </div>
            `;
        }).join('');
    }

    renderCenterArea(state) {
        // Dealer
        const dealer = state.players[state.dealerIndex];
        document.getElementById('dealer-name').textContent = dealer?.name || '--';
        document.getElementById('dealer-chip').style.display = state.phase !== 'WAITING' ? 'flex' : 'none';

        // Crib
        const cribCards = document.getElementById('crib-cards');
        if (state.phase === 'DISCARD' || state.phase === 'STARTER' || state.phase === 'PLAY') {
            cribCards.innerHTML = state.crib.map((cardStr, i) => `
                <div class="crib-card face-down" data-index="${i}">🂠</div>
            `).join('');
        } else if (state.phase === 'COUNT_CRIB' || state.phase === 'GAME_OVER') {
            cribCards.innerHTML = state.crib.map((cardStr, i) => `
                <div class="crib-card" data-index="${i}">${this.renderCardHtml(Card.fromString(cardStr))}</div>
            `).join('');
        } else {
            cribCards.innerHTML = '<div class="crib-card empty">🂠</div><div class="crib-card empty">🂠</div>';
        }
        document.getElementById('crib-count').textContent = state.cribCount || 0;

        // Starter
        const starterEl = document.getElementById('starter-card');
        if (state.starter) {
            const card = Card.fromString(state.starter);
            starterEl.className = `starter-card ${card.color}`;
            starterEl.innerHTML = `
                <span class="starter-rank">${card.rank}</span>
                <span class="starter-suit">${card.suit}</span>
            `;
        } else {
            starterEl.className = 'starter-card empty';
            starterEl.textContent = '?';
        }
    }

    renderCardHtml(card) {
        return `
            <span class="card-rank">${card.rank}</span>
            <span class="card-suit">${card.suit}</span>
            <span class="card-mini-rank">${card.rank}</span>
            <span class="card-mini-suit">${card.suit}</span>
        `;
    }

    renderPlayerHand(state) {
        const hand = state.hand || [];
        const container = document.getElementById('hand-cards');
        
        container.innerHTML = hand.map((cardStr, idx) => {
            const card = Card.fromString(cardStr);
            const isSelected = this.selectedCards.has(idx);
            const isDiscardSelected = this.discardSelection.has(idx);
            const disabled = (state.phase === 'PLAY' && (!state.canPlay || state.playCount + card.value > 31)) ||
                           (state.phase === 'DISCARD' && !state.canDiscard);
            
            return `
                <div class="card ${card.color} ${isSelected ? 'selected' : ''} ${isDiscardSelected ? 'discard-selected' : ''} ${disabled ? 'disabled' : ''}" 
                     data-index="${idx}" 
                     data-card="${cardStr}"
                     style="pointer-events: auto;">
                    ${this.renderCardHtml(card)}
                </div>
            `;
        }).join('');

        // Use event delegation on container for more reliable clicking
        container.onclick = (e) => {
            const cardEl = e.target.closest('.card');
            if (cardEl && container.contains(cardEl)) {
                this.onCardClick(cardEl);
            }
        };

        // Update the turn status bar on screen
        this.renderTurnStatus(state);
    }

    renderTurnStatus(state) {
        const bar = document.getElementById('turn-status');
        if (!bar) return;
        
        if (state.phase === 'DISCARD') {
            if (state.canDiscard) {
                const remaining = state.discardCount - this.discardSelection.size;
                bar.textContent = remaining > 0 
                    ? `YOUR TURN — SELECT ${remaining > 1 ? remaining + ' CARDS' : '1 CARD'} FOR CRIB`
                    : 'CLICK "DISCARD TO CRIB" TO CONTINUE';
                bar.className = 'turn-status yours';
            } else {
                bar.textContent = `${state.players[state.currentPlayer]?.name || 'OPPONENT'} IS DISCARDING...`;
                bar.className = 'turn-status waiting';
            }
        } else if (state.phase === 'PLAY') {
            if (state.canPlay) {
                bar.textContent = `YOUR TURN — CLICK A CARD TO PLAY (COUNT ${state.playCount}/31)`;
                bar.className = 'turn-status yours';
            } else {
                bar.textContent = `${state.players[state.currentPlayer]?.name || 'OPPONENT'} IS PLAYING — WAIT (COUNT ${state.playCount}/31)`;
                bar.className = 'turn-status waiting';
            }
        } else if (state.phase === 'COUNT_HAND' || state.phase === 'COUNT_CRIB') {
            if (state.currentPlayer === this.localPlayerIndex) {
                bar.textContent = 'YOUR TURN — CLICK "COUNT HAND"';
                bar.className = 'turn-status yours';
            } else {
                bar.textContent = `${state.players[state.currentPlayer]?.name || 'OPPONENT'} IS COUNTING...`;
                bar.className = 'turn-status waiting';
            }
        } else {
            bar.textContent = state.phase === 'GAME_OVER' ? 'GAME OVER' : (state.phase || '');
            bar.className = 'turn-status';
        }
    }

    onCardClick(cardEl) {
        // Read current state from engine at click time
        const state = this.engine.getState(this.localPlayerIndex);
        const idx = parseInt(cardEl.dataset.index);
        const cardStr = cardEl.dataset.card;
        
        if (state.phase === 'DISCARD' && state.canDiscard) {
            // Toggle discard selection
            if (this.discardSelection.has(idx)) {
                this.discardSelection.delete(idx);
                cardEl.classList.remove('discard-selected');
            } else {
                if (this.discardSelection.size < state.discardCount) {
                    this.discardSelection.add(idx);
                    cardEl.classList.add('discard-selected');
                }
            }
            this.updateDiscardButton(state);
            this.renderTurnStatus(state);
        } else if (state.phase === 'PLAY' && state.canPlay) {
            // Play card
            this.playCard(idx);
        } else if (state.phase === 'COUNT_HAND' || state.phase === 'COUNT_CRIB') {
            // Toggle selection for counting (visual only)
            if (this.selectedCards.has(idx)) {
                this.selectedCards.delete(idx);
                cardEl.classList.remove('selected');
            } else {
                this.selectedCards.add(idx);
                cardEl.classList.add('selected');
            }
        }
    }

    updateDiscardButton(state) {
        if (!state) state = this.engine.getState(this.localPlayerIndex);
        const ready = this.discardSelection.size === state.discardCount;
        const inlineBtn = document.getElementById('discard-btn');
        const modalBtn = document.getElementById('confirm-discard');
        const countEl = document.getElementById('discard-count');
        const preview = document.getElementById('discard-preview');
        
        if (inlineBtn) inlineBtn.disabled = !ready;
        if (modalBtn) modalBtn.disabled = !ready;
        if (countEl) countEl.textContent = state.discardCount - this.discardSelection.size;
        
        if (preview) {
            preview.innerHTML = Array.from(this.discardSelection).map(idx => {
                const card = Card.fromString(state.hand[idx]);
                return `<div class="card ${card.color}">${this.renderCardHtml(card)}</div>`;
            }).join('');
        }
    }

    renderActions(state) {
        const discardBtn = document.getElementById('discard-btn');
        const playBtn = document.getElementById('play-btn');
        const goBtn = document.getElementById('go-btn');
        const countBtn = document.getElementById('count-btn');

        // Hide all by default
        [discardBtn, playBtn, goBtn, countBtn].forEach(btn => {
            if (btn) btn.style.display = 'none';
        });

        if (state.phase === 'DISCARD' && state.canDiscard) {
            discardBtn.style.display = 'inline-block';
            discardBtn.disabled = this.discardSelection.size !== state.discardCount;
        } else if (state.phase === 'PLAY' && state.canPlay) {
            playBtn.style.display = 'inline-block';
            goBtn.style.display = 'inline-block';
            
            const hand = state.hand || [];
            const canPlayAny = hand.some((cardStr, i) => {
                const card = Card.fromString(cardStr);
                return state.playCount + card.value <= 31;
            });
            
            playBtn.disabled = !canPlayAny;
            goBtn.disabled = canPlayAny;
        } else if (state.phase === 'COUNT_HAND' && state.currentPlayer === this.localPlayerIndex) {
            countBtn.style.display = 'inline-block';
            countBtn.disabled = false;
            countBtn.textContent = 'COUNT HAND';
        } else if (state.phase === 'COUNT_CRIB' && state.currentPlayer === this.dealerIndex) {
            countBtn.style.display = 'inline-block';
            countBtn.disabled = false;
            countBtn.textContent = 'COUNT CRIB';
        }
    }

    renderPhaseIndicator(state) {
        const indicator = document.getElementById('phase-indicator');
        const label = document.getElementById('phase-label');
        const sub = document.getElementById('phase-sub');

        const phaseLabels = {
            'WAITING': 'WAITING FOR PLAYERS',
            'DEALING': 'DEALING CARDS',
            'DISCARD': 'DISCARD TO CRIB',
            'STARTER': 'STARTER CARD',
            'PLAY': 'PLAY PHASE',
            'COUNT_HAND': 'COUNTING HANDS',
            'COUNT_CRIB': 'COUNTING CRIB',
            'GAME_OVER': 'GAME OVER'
        };

        label.textContent = phaseLabels[state.phase] || state.phase;

        if (state.phase === 'PLAY') {
            sub.textContent = `COUNT: ${state.playCount} | ${state.players[state.currentPlayer]?.name}'S TURN`;
            indicator.style.display = 'block';
        } else if (state.phase === 'DISCARD') {
            sub.textContent = `${state.players[state.currentPlayer]?.name} DISCARDING`;
            indicator.style.display = 'block';
        } else if (state.phase === 'COUNT_HAND' || state.phase === 'COUNT_CRIB') {
            sub.textContent = `${state.players[state.currentPlayer]?.name} COUNTING`;
            indicator.style.display = 'block';
        } else if (state.phase === 'GAME_OVER') {
            const winner = state.players[state.winner];
            sub.textContent = `${winner?.name} WINS! 🏆`;
            indicator.style.display = 'block';
        } else {
            indicator.style.display = 'none';
        }
    }

    renderPegDisplay(state) {
        const player = state.players[this.localPlayerIndex];
        if (player) {
            document.getElementById('peg-front').textContent = player.pegs[0];
            document.getElementById('peg-back').textContent = player.pegs[1];
        }
    }

    async discardToCrib() {
        const cardIndices = Array.from(this.discardSelection).sort((a, b) => b - a);
        const result = this.engine.discardToCrib(this.localPlayerIndex, cardIndices);
        
        if (result.success) {
            this.discardSelection.clear();
            this.selectedCards.clear();
            this.hideDiscardModal();
            this.broadcastState();
            this.addLogEntry(`You discarded ${cardIndices.length} card(s) to the crib`, 'action');
        } else {
            this.showModal('ERROR', result.error, [{ text: 'OK', action: () => this.hideModal() }]);
        }
    }

    async playBestCard() {
        const state = this.engine.getState(this.localPlayerIndex);
        if (state.phase !== 'PLAY' || !state.canPlay) return;

        const hand = state.hand || [];
        // Find the highest-value card that keeps the running count <= 31
        let bestIdx = -1;
        hand.forEach((cardStr, i) => {
            const card = Card.fromString(cardStr);
            if (state.playCount + card.value <= 31) {
                if (bestIdx === -1 || card.value > Card.fromString(hand[bestIdx]).value) {
                    bestIdx = i;
                }
            }
        });

        if (bestIdx !== -1 && hand[bestIdx]) {
            await this.playCard(bestIdx);
        }
    }

    async playCard(cardIndex) {
        const handArr = this.engine.hands[this.localPlayerIndex] || [];
        const playedCard = handArr[cardIndex] ? handArr[cardIndex].toString() : '';
        const result = this.engine.playCard(this.localPlayerIndex, cardIndex);
        
        if (result.success) {
            this.selectedCards.clear();
            this.broadcastState();
            
            this.addLogEntry(`You played ${playedCard} (count: ${result.playCount})`, 'action');
            
            if (result.scoreResult?.points > 0) {
                this.addLogEntry(`Scored ${result.scoreResult.points}: ${result.scoreResult.reasons.join(', ')}`, 'score');
            }
            
            if (result.go) {
                this.addLogEntry('GO!', 'score');
            }
        } else {
            this.showModal('ILLEGAL PLAY', result.error, [{ text: 'OK', action: () => this.hideModal() }]);
        }
    }

    async sayGo() {
        const result = this.engine.sayGo(this.localPlayerIndex);
        
        if (result.success) {
            this.broadcastState();
            this.addLogEntry('You said GO', 'action');
        } else {
            this.showModal('CANNOT GO', result.error, [{ text: 'OK', action: () => this.hideModal() }]);
        }
    }

    async countHand() {
        if (this.engine.phase === 'COUNT_HAND' || this.engine.phase === 'COUNT_CRIB') {
            const r = this.engine.proceedToNextCount();
            if (r.handResult) {
                const who = this.engine.players[r.handPlayer].name;
                const desc = r.handResult.breakdown.length ? r.handResult.breakdown.join('; ') : 'no points';
                this.addLogEntry(`${who} counted hand: ${desc} (${r.handResult.points} pts)`, 'score');
            }
            if (r.dealerResult) {
                const who = this.engine.players[r.dealerPlayer].name;
                const desc = r.dealerResult.breakdown.length ? r.dealerResult.breakdown.join('; ') : 'no points';
                this.addLogEntry(`${who} counted hand: ${desc} (${r.dealerResult.points} pts)`, 'score');
            }
            if (r.cribResult) {
                const desc = r.cribResult.breakdown.length ? r.cribResult.breakdown.join('; ') : 'no points';
                this.addLogEntry(`Crib counted: ${desc} (${r.cribResult.points} pts)`, 'score');
            }
        }
        
        this.broadcastState();
    }

    broadcastState() {
        const state = this.engine.getState(this.localPlayerIndex);
        if (this.isSinglePlayer) {
            // Single-player: the engine is the single source of truth. Do NOT
            // run handleStateUpdate here — it wipes non-local hands to [] and
            // deadlocks the AI. Auto-advance STARTER -> PLAY, then re-render.
            this.autoAdvancePhase();
            const fresh = this.engine.getState(this.localPlayerIndex);
            this.renderGameState(fresh);
            this.checkAITurn(fresh);
        } else {
            this.network.broadcastState(state);
        }
    }

    autoAdvancePhase() {
        if (this.engine.phase === 'STARTER') {
            this.engine.startPlayPhase();
        }
    }

checkAITurn(state) {
        if (!this.isSinglePlayer) return;
        if (this.aiThinking) return;
        if (state.phase === 'GAME_OVER') return;

        const currentPlayer = state.currentPlayer;
        
        if (this.aiPlayers.has(currentPlayer)) {
            this.aiThinking = true;
            const delay = 800 + Math.random() * 1200;
            setTimeout(() => this.makeAIMove(currentPlayer, state), delay);
        }
    }

    async makeAIMove(aiIndex, state) {
        const ai = this.aiPlayers.get(aiIndex);
        if (!ai) {
            this.aiThinking = false;
            return;
        }

        const aiName = state.players[aiIndex]?.name || 'AI';
        const hand = this.engine.hands[aiIndex] || [];

        try {
            if (state.phase === 'DISCARD') {
                await this.aiDiscard(ai, aiIndex, aiName, hand, state);
            } else if (state.phase === 'PLAY') {
                await this.aiPlay(ai, aiIndex, aiName, hand, state);
            } else if (state.phase === 'COUNT_HAND' || state.phase === 'COUNT_CRIB') {
                await this.aiCount(ai, aiIndex, aiName, state);
            }
        } catch (e) {
            console.error('AI error:', e);
        }

        this.aiThinking = false;
        this.autoAdvancePhase();
        const newState = this.engine.getState(this.localPlayerIndex);
        this.renderGameState(newState);
        this.checkAITurn(newState);
    }

    async aiDiscard(ai, aiIndex, aiName, hand, state) {
        const isDealer = aiIndex === this.engine.dealerIndex;
        const discardCount = state.discardCount;
        const discardIndices = ai.chooseDiscard(hand, isDealer, this.engine.starter, this.engine.playerCount);
        
        // Capture the discarded card strings BEFORE the engine splices them out
        const discardedCards = discardIndices
            .filter(i => i >= 0 && i < hand.length)
            .map(i => hand[i].toString())
            .join(', ');
        
        const result = this.engine.discardToCrib(aiIndex, discardIndices.sort((a, b) => b - a));
        
        if (result.success) {
            this.addLogEntry(`${aiName} discarded ${discardCount} card(s) to the crib`, 'action');
        }
    }

    async aiPlay(ai, aiIndex, aiName, hand, state) {
        if (ai.shouldSayGo(hand, state.playCount)) {
            const result = this.engine.sayGo(aiIndex);
            if (result.success) {
                this.addLogEntry(`${aiName} says GO`, 'action');
            }
            return;
        }

        const cardIndex = ai.choosePlayCard(hand, state.playCount, this.engine.playPile);
        if (cardIndex === -1) {
            // Should not happen if shouldSayGo returned false, but fallback
            const result = this.engine.sayGo(aiIndex);
            if (result.success) this.addLogEntry(`${aiName} says GO`, 'action');
            return;
        }

        // Capture before the engine splices the card out of the hand
        const playedCard = hand[cardIndex] ? hand[cardIndex].toString() : '';
        const result = this.engine.playCard(aiIndex, cardIndex);
        if (result.success) {
            this.addLogEntry(`${aiName} played ${playedCard} (count: ${result.playCount})`, 'action');
            if (result.scoreResult?.points > 0) {
                this.addLogEntry(`${aiName} scored ${result.scoreResult.points}: ${result.scoreResult.reasons.join(', ')}`, 'score');
            }
            if (result.go) {
                this.addLogEntry('GO!', 'score');
            }
        }
    }

    async aiCount(ai, aiIndex, aiName, state) {
        if (state.phase === 'COUNT_HAND' || state.phase === 'COUNT_CRIB') {
            const r = this.engine.proceedToNextCount();
            if (r.handResult) {
                const who = this.engine.players[r.handPlayer].name;
                const desc = r.handResult.breakdown.length ? r.handResult.breakdown.join('; ') : 'no points';
                this.addLogEntry(`${who} counted hand: ${desc} (${r.handResult.points} pts)`, 'score');
            }
            if (r.dealerResult) {
                const who = this.engine.players[r.dealerPlayer].name;
                const desc = r.dealerResult.breakdown.length ? r.dealerResult.breakdown.join('; ') : 'no points';
                this.addLogEntry(`${who} counted hand: ${desc} (${r.dealerResult.points} pts)`, 'score');
            }
            if (r.cribResult) {
                const desc = r.cribResult.breakdown.length ? r.cribResult.breakdown.join('; ') : 'no points';
                this.addLogEntry(`Crib counted: ${desc} (${r.cribResult.points} pts)`, 'score');
            }
        }

        // makeAIMove re-renders and drives checkAITurn after this returns.
    }

    addLogEntry(message, type = 'system') {
        const log = document.getElementById('log-messages');
        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
        log.appendChild(entry);
        log.scrollTop = log.scrollHeight;
        
        this.gameLog.push({ message, type, time: Date.now() });
        if (this.gameLog.length > 100) this.gameLog.shift();
    }

    updateConnectionStatus(connected) {
        const dot = document.getElementById('status-dot');
        const text = document.getElementById('status-text');
        
        if (connected) {
            dot.classList.add('connected');
            text.textContent = 'CONNECTED';
        } else {
            dot.classList.remove('connected');
            text.textContent = 'DISCONNECTED';
        }
    }

    showModal(title, content, actions) {
        document.getElementById('modal-header').textContent = title;
        document.getElementById('modal-content').innerHTML = content;
        
        const actionsContainer = document.getElementById('modal-actions');
        actionsContainer.innerHTML = actions.map(a => 
            `<button class="pixel-btn ${a.class || ''}" data-action="${a.text}">${a.text}</button>`
        ).join('');
        
        actionsContainer.querySelectorAll('button').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = actions.find(a => a.text === btn.dataset.action);
                if (action?.action) action.action();
            });
        });
        
        document.getElementById('modal-overlay').classList.remove('hidden');
    }

    hideModal() {
        document.getElementById('modal-overlay').classList.add('hidden');
    }

    showDiscardModal(instruction, count) {
        document.getElementById('discard-instruction').innerHTML = instruction.replace('{count}', count);
        document.getElementById('discard-count').textContent = count;
        document.getElementById('confirm-discard').disabled = true;
        document.getElementById('discard-preview').innerHTML = '';
        document.getElementById('discard-modal').classList.remove('hidden');
    }

    hideDiscardModal() {
        document.getElementById('discard-modal').classList.add('hidden');
        this.discardSelection.clear();
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CribbageGame };
} else {
    window.CribbageGame = CribbageGame;
}