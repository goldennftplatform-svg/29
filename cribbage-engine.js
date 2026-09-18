const SUITS = ['♣', '♦', '♥', '♠'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const RANK_VALUES = { 'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 10, 'Q': 10, 'K': 10 };
const RANK_ORDER = { 'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13 };

class Card {
    constructor(rank, suit) {
        this.rank = rank;
        this.suit = suit;
        this.id = `${rank}${suit}`;
        this.color = (suit === '♥' || suit === '♦') ? 'red' : 'black';
        this.value = RANK_VALUES[rank];
        this.order = RANK_ORDER[rank];
    }

    toString() {
        return `${this.rank}${this.suit}`;
    }

    static fromString(str) {
        const suit = str.slice(-1);
        const rank = str.slice(0, -1);
        return new Card(rank, suit);
    }

    equals(other) {
        return this.rank === other.rank && this.suit === other.suit;
    }
}

class Deck {
    constructor() {
        this.cards = [];
        this.reset();
    }

    reset() {
        this.cards = [];
        for (const suit of SUITS) {
            for (const rank of RANKS) {
                this.cards.push(new Card(rank, suit));
            }
        }
    }

    shuffle() {
        for (let i = this.cards.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
        }
    }

    deal(count) {
        return this.cards.splice(0, count);
    }

    draw() {
        return this.cards.pop();
    }

    remaining() {
        return this.cards.length;
    }
}

class CribbageEngine {
    constructor(playerCount = 2) {
        this.playerCount = playerCount;
        this.players = [];
        this.dealerIndex = 0;
        this.crib = [];
        this.starter = null;
        this.playPile = [];
        this.playCount = 0;
        this.currentPlayerIndex = 0;
        this.phase = 'WAITING'; // WAITING, DEALING, DISCARD, STARTER, PLAY, COUNT_HAND, COUNT_CRIB, GAME_OVER
        this.scores = [];
        this.pegs = []; // [front, back] for each player
        this.lastPlayIndex = -1;
        this.goCount = 0;
        this.hands = [];
        this.winner = null;
    }

    addPlayer(name, id) {
        if (this.players.length >= this.playerCount) return false;
        this.players.push({ id, name, connected: true });
        this.scores.push(0);
        this.pegs.push([0, 0]); // [front, back]
        this.hands.push([]);
        return true;
    }

    removePlayer(id) {
        const idx = this.players.findIndex(p => p.id === id);
        if (idx !== -1) {
            this.players[idx].connected = false;
        }
    }

    startGame() {
        if (this.players.length < 2) return false;
        this.dealerIndex = Math.floor(Math.random() * this.players.length);
        this.newRound();
        return true;
    }

    newRound() {
        this.phase = 'DEALING';
        this.crib = [];
        this.starter = null;
        this.playPile = [];
        this.playCount = 0;
        this.currentPlayerIndex = (this.dealerIndex + 1) % this.playerCount;
        this.lastPlayIndex = -1;
        this.goCount = 0;

        const deck = new Deck();
        deck.shuffle();

        const cardsPerPlayer = this.playerCount === 2 ? 6 : 5;
        
        for (let i = 0; i < this.playerCount; i++) {
            this.hands[i] = deck.deal(cardsPerPlayer).sort((a, b) => a.order - b.order);
        }

        this.starter = deck.draw();
        
        this.phase = 'DISCARD';
        this.currentPlayerIndex = (this.dealerIndex + 1) % this.playerCount;
        
        return {
            hands: this.hands.map((h, i) => i === this.getLocalPlayerIndex() ? h : h.map(() => null)),
            starter: this.starter,
            dealerIndex: this.dealerIndex,
            currentPlayer: this.currentPlayerIndex,
            phase: this.phase,
            discardCount: this.playerCount === 2 ? 2 : 1
        };
    }

    getLocalPlayerIndex() {
        // This would be set by the game client
        return 0;
    }

    setLocalPlayerIndex(idx) {
        this.localPlayerIndex = idx;
    }

    discardToCrib(playerIndex, cardIndices) {
        if (this.phase !== 'DISCARD') return { success: false, error: 'Not discard phase' };
        if (playerIndex !== this.currentPlayerIndex) return { success: false, error: 'Not your turn' };

        const expectedDiscards = this.playerCount === 2 ? 2 : 1;
        if (cardIndices.length !== expectedDiscards) {
            return { success: false, error: `Must discard ${expectedDiscards} cards` };
        }

        // Sort indices descending to splice correctly
        cardIndices.sort((a, b) => b - a);
        const discarded = [];
        for (const idx of cardIndices) {
            if (idx >= 0 && idx < this.hands[playerIndex].length) {
                discarded.push(this.hands[playerIndex].splice(idx, 1)[0]);
            }
        }

        this.crib.push(...discarded);
        this.crib.sort((a, b) => a.order - b.order);

        // Move to next player
        this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.playerCount;
        
        // Check if all players have discarded
        const allDiscarded = this.hands.every((hand, i) => 
            hand.length === (this.playerCount === 2 ? 4 : 4)
        );

        if (allDiscarded) {
            this.phase = 'STARTER';
            this.currentPlayerIndex = (this.dealerIndex + 1) % this.playerCount;
        }

        return { 
            success: true, 
            crib: this.crib,
            hands: this.hands,
            currentPlayer: this.currentPlayerIndex,
            phase: this.phase
        };
    }

    startPlayPhase() {
        this.phase = 'PLAY';
        this.playPile = [];
        this.playCount = 0;
        this.currentPlayerIndex = (this.dealerIndex + 1) % this.playerCount;
        this.lastPlayIndex = -1;
        this.goCount = 0;
    }

    playCard(playerIndex, cardIndex) {
        if (this.phase !== 'PLAY') return { success: false, error: 'Not play phase' };
        if (playerIndex !== this.currentPlayerIndex) return { success: false, error: 'Not your turn' };

        const hand = this.hands[playerIndex];
        if (cardIndex < 0 || cardIndex >= hand.length) return { success: false, error: 'Invalid card' };

        const card = hand[cardIndex];
        if (this.playCount + card.value > 31) {
            return { success: false, error: 'Count would exceed 31' };
        }

        // Play the card
        hand.splice(cardIndex, 1);
        this.playPile.push({ card, player: playerIndex });
        this.playCount += card.value;
        this.lastPlayIndex = playerIndex;
        this.goCount = 0;

        // Check for scoring
        const scoreResult = this.scorePlay(this.playPile);
        
        // Check for 31 or GO
        if (this.playCount === 31) {
            this.awardPoints(playerIndex, 2, '31 for 2');
            this.endPlayRound();
        } else if (this.canAnyonePlay()) {
            this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.playerCount;
        } else {
            // No one can play - GO
            this.awardPoints(this.lastPlayIndex, 1, 'GO');
            this.endPlayRound();
        }

        return {
            success: true,
            playPile: this.playPile,
            playCount: this.playCount,
            scores: [...this.scores],
            pegs: this.pegs.map(p => [...p]),
            currentPlayer: this.currentPlayerIndex,
            scoreResult,
            go: !this.canAnyonePlay() && this.playCount < 31
        };
    }

    canAnyonePlay() {
        for (let i = 0; i < this.playerCount; i++) {
            const idx = (this.currentPlayerIndex + i) % this.playerCount;
            if (this.hands[idx].some(c => this.playCount + c.value <= 31)) {
                return true;
            }
        }
        return false;
    }

    endPlayRound() {
        this.playPile = [];
        this.playCount = 0;
        this.lastPlayIndex = -1;
        
        // Check if all cards played
        const allEmpty = this.hands.every(h => h.length === 0);
        if (allEmpty) {
            this.phase = 'COUNT_HAND';
            this.currentPlayerIndex = (this.dealerIndex + 1) % this.playerCount;
        } else {
            // Next player starts new count
            this.currentPlayerIndex = (this.lastPlayIndex + 1) % this.playerCount;
            // Skip players with no cards
            while (this.hands[this.currentPlayerIndex].length === 0) {
                this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.playerCount;
            }
        }
    }

    sayGo(playerIndex) {
        if (this.phase !== 'PLAY') return { success: false, error: 'Not play phase' };
        if (playerIndex !== this.currentPlayerIndex) return { success: false, error: 'Not your turn' };

        // Check if player actually can play
        const canPlay = this.hands[playerIndex].some(c => this.playCount + c.value <= 31);
        if (canPlay) {
            return { success: false, error: 'You have a legal play' };
        }

        this.goCount++;
        this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.playerCount;

        if (this.goCount >= this.playerCount - 1) {
            // Everyone passed - last player gets GO point
            this.awardPoints(this.lastPlayIndex, 1, 'GO');
            this.endPlayRound();
        }

        return {
            success: true,
            currentPlayer: this.currentPlayerIndex,
            goCount: this.goCount
        };
    }

    scorePlay(pile) {
        const cards = pile.map(p => p.card);
        let points = 0;
        const reasons = [];

        // 15s and 31s
        const sum = cards.reduce((s, c) => s + c.value, 0);
        if (sum === 15) { points += 2; reasons.push('15 for 2'); }
        else if (sum === 31) { points += 2; reasons.push('31 for 2'); }

        // Pairs, trips, quads
        const lastCard = cards[cards.length - 1];
        let pairCount = 1;
        for (let i = cards.length - 2; i >= 0; i--) {
            if (cards[i].rank === lastCard.rank) pairCount++;
            else break;
        }
        if (pairCount === 2) { points += 2; reasons.push('Pair for 2'); }
        else if (pairCount === 3) { points += 6; reasons.push('Three of a kind for 6'); }
        else if (pairCount === 4) { points += 12; reasons.push('Four of a kind for 12'); }

        // Runs
        const runLength = this.findRun(cards);
        if (runLength >= 3) {
            points += runLength;
            reasons.push(`Run of ${runLength} for ${runLength}`);
        }

        if (points > 0) {
            const player = pile[pile.length - 1].player;
            this.awardPoints(player, points, reasons.join(', '));
        }

        return { points, reasons };
    }

    findRun(cards) {
        // Check for run ending with last card
        const ranks = [...new Set(cards.map(c => c.order))].sort((a, b) => a - b);
        if (ranks.length < 3) return 0;
        
        let maxRun = 0;
        let currentRun = 1;
        for (let i = 1; i < ranks.length; i++) {
            if (ranks[i] === ranks[i-1] + 1) {
                currentRun++;
                maxRun = Math.max(maxRun, currentRun);
            } else {
                currentRun = 1;
            }
        }
        return maxRun >= 3 ? maxRun : 0;
    }

    countHand(playerIndex, isCrib = false) {
        const cards = isCrib ? [...this.crib] : [...this.hands[playerIndex]];
        if (this.starter) cards.push(this.starter);
        
        let points = 0;
        const breakdown = [];

        // 15s
        const fifteens = this.countFifteens(cards);
        points += fifteens.count * 2;
        if (fifteens.count > 0) breakdown.push(`${fifteens.count} fifteen${fifteens.count > 1 ? 's' : ''} for ${fifteens.count * 2}`);

        // Pairs
        const pairs = this.countPairs(cards);
        points += pairs.points;
        if (pairs.points > 0) breakdown.push(pairs.desc);

        // Runs
        const runs = this.countRuns(cards);
        points += runs.points;
        if (runs.points > 0) breakdown.push(runs.desc);

        // Flush
        const flush = this.countFlush(cards, isCrib);
        points += flush.points;
        if (flush.points > 0) breakdown.push(flush.desc);

        // Nobs (Jack of same suit as starter)
        if (this.starter) {
            const nobs = cards.filter(c => c.rank === 'J' && c.suit === this.starter.suit).length;
            if (nobs > 0) {
                points += nobs;
                breakdown.push(`${nobs} nob${nobs > 1 ? 's' : ''} for ${nobs}`);
            }
        }

        if (points > 0) {
            this.awardPoints(playerIndex, points, breakdown.join('; '));
        }

        return { points, breakdown, cards: cards.map(c => c.toString()) };
    }

    countFifteens(cards) {
        let count = 0;
        const n = cards.length;
        for (let mask = 1; mask < (1 << n); mask++) {
            let sum = 0;
            for (let i = 0; i < n; i++) {
                if (mask & (1 << i)) sum += cards[i].value;
            }
            if (sum === 15) count++;
        }
        return { count };
    }

    countPairs(cards) {
        const rankCounts = {};
        for (const c of cards) {
            rankCounts[c.rank] = (rankCounts[c.rank] || 0) + 1;
        }
        let points = 0;
        const descs = [];
        for (const [rank, count] of Object.entries(rankCounts)) {
            if (count === 2) { points += 2; descs.push('Pair for 2'); }
            else if (count === 3) { points += 6; descs.push('Three of a kind for 6'); }
            else if (count === 4) { points += 12; descs.push('Four of a kind for 12'); }
        }
        return { points, desc: descs.join(', ') };
    }

    countRuns(cards) {
        const uniqueRanks = [...new Set(cards.map(c => c.order))].sort((a, b) => a - b);
        if (uniqueRanks.length < 3) return { points: 0, desc: '' };

        // Find all runs
        let maxRunLen = 0;
        let runCount = 0;
        
        for (let i = 0; i < uniqueRanks.length; i++) {
            let len = 1;
            for (let j = i + 1; j < uniqueRanks.length; j++) {
                if (uniqueRanks[j] === uniqueRanks[j-1] + 1) len++;
                else break;
            }
            if (len > maxRunLen) {
                maxRunLen = len;
                runCount = 1;
            } else if (len === maxRunLen && len >= 3) {
                runCount++;
            }
        }

        if (maxRunLen < 3) return { points: 0, desc: '' };

        // Count multiplicity for each rank in the run
        const rankCounts = {};
        for (const c of cards) {
            if (uniqueRanks.includes(c.order)) {
                rankCounts[c.order] = (rankCounts[c.order] || 0) + 1;
            }
        }

        let multiplicity = 1;
        for (let i = 0; i < maxRunLen; i++) {
            multiplicity *= (rankCounts[uniqueRanks[i]] || 1);
        }

        const points = maxRunLen * multiplicity;
        return { 
            points, 
            desc: `Run of ${maxRunLen}${multiplicity > 1 ? ` x${multiplicity}` : ''} for ${points}` 
        };
    }

    countFlush(cards, isCrib) {
        const handCards = isCrib ? cards.slice(0, 4) : cards.slice(0, 4);
        const suits = handCards.map(c => c.suit);
        const allSame = suits.every(s => s === suits[0]);
        
        if (!allSame) return { points: 0, desc: '' };
        
        if (isCrib) {
            // Crib flush needs starter too
            if (this.starter && this.starter.suit === suits[0]) {
                return { points: 5, desc: 'Flush (crib) for 5' };
            }
            return { points: 0, desc: '' };
        } else {
            // Hand flush: 4 if no starter match, 5 if starter matches
            if (this.starter && this.starter.suit === suits[0]) {
                return { points: 5, desc: 'Flush for 5' };
            }
            return { points: 4, desc: 'Flush for 4' };
        }
    }

    awardPoints(playerIndex, points, reason) {
        this.scores[playerIndex] += points;
        this.updatePegs(playerIndex);
        this.logScore(playerIndex, points, reason);
        this.checkWin(playerIndex);
    }

    updatePegs(playerIndex) {
        const score = this.scores[playerIndex];
        const front = score % 121;
        const back = Math.floor(score / 121) % 121;
        this.pegs[playerIndex] = [front, back];
    }

    logScore(playerIndex, points, reason) {
        // Handled by game.js
    }

    checkWin(playerIndex) {
        if (this.scores[playerIndex] >= 121) {
            this.winner = playerIndex;
            this.phase = 'GAME_OVER';
        }
    }

    proceedToNextCount() {
        if (this.phase === 'COUNT_HAND') {
            // Count current player's hand
            const handWho = this.currentPlayerIndex;
            const result = this.countHand(this.currentPlayerIndex);
            this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.playerCount;
            
            if (this.currentPlayerIndex === this.dealerIndex) {
                // Count dealer's hand
                const dealerResult = this.countHand(this.dealerIndex);
                // The dealer counts the crib next, so the dealer is the
                // acting player during COUNT_CRIB (the UI's count button
                // reads state.currentPlayer for whose turn it is).
                this.currentPlayerIndex = this.dealerIndex;
                this.phase = 'COUNT_CRIB';
                return {
                    phase: this.phase,
                    currentPlayer: this.currentPlayerIndex,
                    handResult: result,
                    handPlayer: handWho,
                    dealerResult,
                    dealerPlayer: this.dealerIndex
                };
            }
            
            return { phase: this.phase, currentPlayer: this.currentPlayerIndex, handResult: result, handPlayer: handWho };
        } else if (this.phase === 'COUNT_CRIB') {
            const result = this.countHand(this.dealerIndex, true);
            this.endRound();
            return { phase: this.phase, cribResult: result };
        }
    }

    endRound() {
        // Check for winner
        if (this.winner !== null) {
            this.phase = 'GAME_OVER';
            return;
        }

        // Rotate dealer
        this.dealerIndex = (this.dealerIndex + 1) % this.playerCount;
        this.newRound();
    }

    getState(forPlayer = null) {
        const state = {
            phase: this.phase,
            players: this.players.map((p, i) => ({
                id: p.id,
                name: p.name,
                score: this.scores[i],
                pegs: this.pegs[i],
                handSize: this.hands[i]?.length || 0,
                isDealer: i === this.dealerIndex,
                connected: p.connected
            })),
            dealerIndex: this.dealerIndex,
            currentPlayer: this.currentPlayerIndex,
            crib: this.crib.map(c => c.toString()),
            cribCount: this.crib.length,
            starter: this.starter ? this.starter.toString() : null,
            playPile: this.playPile.map(p => ({ card: p.card.toString(), player: p.player })),
            playCount: this.playCount,
            scores: [...this.scores],
            winner: this.winner
        };

        if (forPlayer !== null) {
            state.hand = this.hands[forPlayer]?.map(c => c.toString()) || [];
            state.canPlay = this.phase === 'PLAY' && this.currentPlayerIndex === forPlayer;
            state.canDiscard = this.phase === 'DISCARD' && this.currentPlayerIndex === forPlayer;
            state.discardCount = this.playerCount === 2 ? 2 : 1;
        }

        return state;
    }
}

class CribbageAI {
    constructor(difficulty = 'medium') {
        this.difficulty = difficulty; // 'easy', 'medium', 'hard'
        this.weights = this.getWeights(difficulty);
    }

    getWeights(difficulty) {
        const configs = {
            easy: { cribValue: 0.5, playAggression: 0.3, countAccuracy: 0.6, randomness: 0.4 },
            medium: { cribValue: 0.8, playAggression: 0.6, countAccuracy: 0.9, randomness: 0.2 },
            hard: { cribValue: 1.0, playAggression: 0.9, countAccuracy: 1.0, randomness: 0.05 }
        };
        return configs[difficulty] || configs.medium;
    }

    // Choose cards to discard to crib
    chooseDiscard(hand, isDealer, starter = null, playerCount = 2) {
        const discardCount = playerCount === 2 ? 2 : 1;
        const bestDiscard = this.findBestDiscard(hand, isDealer, starter, discardCount);
        return bestDiscard.map(c => hand.indexOf(c));
    }

    findBestDiscard(hand, isDealer, starter, discardCount) {
        const combos = this.getCombinations(hand, discardCount);
        let bestScore = -Infinity;
        let bestCombo = combos[0];

        for (const discard of combos) {
            const keep = hand.filter(c => !discard.includes(c));
            let score = this.evaluateHand(keep, starter, false);
            
            // Crib value consideration
            const cribValue = this.evaluateCribPotential(discard, starter, isDealer);
            score += cribValue * this.weights.cribValue;

            // Add some randomness based on difficulty
            score += (Math.random() - 0.5) * this.weights.randomness * 10;

            if (score > bestScore) {
                bestScore = score;
                bestCombo = discard;
            }
        }

        return bestCombo;
    }

    evaluateCribPotential(discard, starter, isDealer) {
        // Dealer wants good crib, non-dealer wants bad crib for opponent
        const multiplier = isDealer ? 1 : -0.5;
        const cards = [...discard];
        if (starter) cards.push(starter);
        return this.evaluateHand(cards, starter, true) * multiplier;
    }

    // Choose card to play during play phase
    choosePlayCard(hand, playCount, playPile) {
        const validCards = hand.filter((c, i) => playCount + c.value <= 31).map((c, i) => ({ card: c, index: hand.indexOf(c) }));
        
        if (validCards.length === 0) return -1; // Must say GO

        let bestScore = -Infinity;
        let bestCard = validCards[0];

        for (const { card, index } of validCards) {
            let score = this.evaluatePlay(card, playCount, playPile, hand);
            
            // Prefer playing 5s, 10s, face cards (more likely to make 15/31)
            if (card.value === 5) score += 2 * this.weights.playAggression;
            if (card.value === 10) score += 1.5 * this.weights.playAggression;
            
            // Avoid playing cards that set up opponent for 15/31
            const newCount = playCount + card.value;
            if (newCount === 5 || newCount === 10 || newCount === 15 || newCount === 21 || newCount === 26) {
                score -= 1 * this.weights.playAggression;
            }

            // Add randomness
            score += (Math.random() - 0.5) * this.weights.randomness * 5;

            if (score > bestScore) {
                bestScore = score;
                bestCard = { card, index };
            }
        }

        return bestCard.index;
    }

    evaluatePlay(card, playCount, playPile, hand) {
        let score = 0;
        const newCount = playCount + card.value;
        const newPile = [...playPile, { card }];

        // Immediate scoring
        const playScore = this.scorePlayStatic(newPile);
        score += playScore.points * 3; // Heavy weight on immediate points

        // Strategic considerations
        if (newCount === 15) score += 5;
        if (newCount === 31) score += 10;
        if (newCount > 25 && newCount < 31) score += 2; // Close to 31

        // Avoid setting up opponent
        const dangerousCounts = [5, 10, 15, 21, 26];
        if (dangerousCounts.includes(newCount)) score -= 3;

        // Prefer playing from pairs/trips
        const sameRank = hand.filter(c => c.rank === card.rank).length;
        if (sameRank >= 2) score += 1;

        return score;
    }

    scorePlayStatic(pile) {
        const cards = pile.map(p => p.card);
        let points = 0;

        const sum = cards.reduce((s, c) => s + c.value, 0);
        if (sum === 15) points += 2;
        else if (sum === 31) points += 2;

        const lastCard = cards[cards.length - 1];
        let pairCount = 1;
        for (let i = cards.length - 2; i >= 0; i--) {
            if (cards[i].rank === lastCard.rank) pairCount++;
            else break;
        }
        if (pairCount === 2) points += 2;
        else if (pairCount === 3) points += 6;
        else if (pairCount === 4) points += 12;

        const runLength = this.findRunStatic(cards);
        if (runLength >= 3) points += runLength;

        return { points };
    }

    findRunStatic(cards) {
        const ranks = [...new Set(cards.map(c => c.order))].sort((a, b) => a - b);
        if (ranks.length < 3) return 0;
        
        let maxRun = 0;
        let currentRun = 1;
        for (let i = 1; i < ranks.length; i++) {
            if (ranks[i] === ranks[i-1] + 1) {
                currentRun++;
                maxRun = Math.max(maxRun, currentRun);
            } else {
                currentRun = 1;
            }
        }
        return maxRun >= 3 ? maxRun : 0;
    }

    // Decide whether to say GO
    shouldSayGo(hand, playCount) {
        const canPlay = hand.some(c => playCount + c.value <= 31);
        if (!canPlay) return true;
        
        // Sometimes say GO strategically (rare)
        if (this.difficulty === 'hard' && Math.random() < 0.02) {
            // Only if playing would be really bad
            const validCards = hand.filter(c => playCount + c.value <= 31);
            const avgScore = validCards.reduce((s, c) => s + this.evaluatePlay(c, playCount, [], hand), 0) / validCards.length;
            return avgScore < -2;
        }
        return false;
    }

    // Evaluate hand for discard decisions
    evaluateHand(cards, starter, isCrib) {
        let points = 0;
        const allCards = [...cards];
        if (starter) allCards.push(starter);

        // 15s
        points += this.countFifteensStatic(allCards) * 2;

        // Pairs
        points += this.countPairsStatic(allCards).points;

        // Runs
        points += this.countRunsStatic(allCards).points;

        // Flush (only for non-crib hands with 4+ cards same suit)
        if (!isCrib && cards.length >= 4) {
            const flush = this.countFlushStatic(cards, starter, false);
            points += flush.points;
        }

        // Nobs
        if (starter) {
            const nobs = cards.filter(c => c.rank === 'J' && c.suit === starter.suit).length;
            points += nobs;
        }

        return points;
    }

    countFifteensStatic(cards) {
        let count = 0;
        const n = cards.length;
        for (let mask = 1; mask < (1 << n); mask++) {
            let sum = 0;
            for (let i = 0; i < n; i++) {
                if (mask & (1 << i)) sum += cards[i].value;
            }
            if (sum === 15) count++;
        }
        return count;
    }

    countPairsStatic(cards) {
        const rankCounts = {};
        for (const c of cards) {
            rankCounts[c.rank] = (rankCounts[c.rank] || 0) + 1;
        }
        let points = 0;
        for (const count of Object.values(rankCounts)) {
            if (count === 2) points += 2;
            else if (count === 3) points += 6;
            else if (count === 4) points += 12;
        }
        return { points };
    }

    countRunsStatic(cards) {
        const uniqueRanks = [...new Set(cards.map(c => c.order))].sort((a, b) => a - b);
        if (uniqueRanks.length < 3) return { points: 0 };

        let maxRunLen = 0;
        for (let i = 0; i < uniqueRanks.length; i++) {
            let len = 1;
            for (let j = i + 1; j < uniqueRanks.length; j++) {
                if (uniqueRanks[j] === uniqueRanks[j-1] + 1) len++;
                else break;
            }
            if (len > maxRunLen) maxRunLen = len;
        }

        if (maxRunLen < 3) return { points: 0 };

        const rankCounts = {};
        for (const c of cards) {
            if (uniqueRanks.includes(c.order)) {
                rankCounts[c.order] = (rankCounts[c.order] || 0) + 1;
            }
        }

        let multiplicity = 1;
        for (let i = 0; i < maxRunLen; i++) {
            multiplicity *= (rankCounts[uniqueRanks[i]] || 1);
        }

        return { points: maxRunLen * multiplicity };
    }

    countFlushStatic(cards, starter, isCrib) {
        const handCards = cards.slice(0, 4);
        const suits = handCards.map(c => c.suit);
        const allSame = suits.every(s => s === suits[0]);
        
        if (!allSame) return { points: 0 };
        
        if (isCrib) {
            if (starter && starter.suit === suits[0]) return { points: 5 };
            return { points: 0 };
        } else {
            if (starter && starter.suit === suits[0]) return { points: 5 };
            return { points: 4 };
        }
    }

    getCombinations(arr, k) {
        if (k === 0) return [[]];
        if (k > arr.length) return [];
        if (k === arr.length) return [arr];
        
        const result = [];
        const combine = (start, current) => {
            if (current.length === k) {
                result.push([...current]);
                return;
            }
            for (let i = start; i < arr.length; i++) {
                current.push(arr[i]);
                combine(i + 1, current);
                current.pop();
            }
        };
        combine(0, []);
        return result;
    }
}

// Export for both Node and browser
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Card, Deck, CribbageEngine, CribbageAI, SUITS, RANKS, RANK_VALUES, RANK_ORDER };
} else {
    window.Card = Card;
    window.Deck = Deck;
    window.CribbageEngine = CribbageEngine;
    window.CribbageAI = CribbageAI;
    window.SUITS = SUITS;
    window.RANKS = RANKS;
    window.RANK_VALUES = RANK_VALUES;
    window.RANK_ORDER = RANK_ORDER;
}