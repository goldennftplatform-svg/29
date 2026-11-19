// Deterministic cribbage scoring regressions. These are the rules that used
// to be exercised only by human play, so a 15-point hand could silently lose
// points without any automated test noticing.
const assert = require('node:assert/strict');
const { Card, CribbageEngine, CribbageAI } = require('../cribbage-engine');

function makeEngine(playerCount = 2) {
    const e = new CribbageEngine(playerCount);
    for (let i = 0; i < playerCount; i++) e.addPlayer('P' + i, 'p' + i);
    return e;
}

function hand(strings) { return strings.map(s => Card.fromString(s)); }

function countHand(cards, starter, isCrib = false) {
    const e = makeEngine();
    if (isCrib) e.crib = hand(cards);
    else e.hands[0] = hand(cards);
    e.starter = Card.fromString(starter);
    return e.countHand(0, isCrib);
}

function scorePile(strings) {
    const e = makeEngine();
    const pile = hand(strings).map((card, i) => ({ card, player: i % 2 }));
    return e.scorePlay(pile);
}

function hasNumericKey(values, key) {
    return Object.prototype.hasOwnProperty.call(values, key);
}

// --- Hand / crib scoring -----------------------------------------------------
{
    // The reported shape: 3 fifteens (6), pair Jacks (2), two 9-10-J runs (6),
    // and nobs (1) = 15. The old scorer used the stray 5 instead of the run's
    // ranks and returned 12.
    const r = countHand(['J♦', '5♥', 'J♥', '10♣'], '9♥');
    assert.equal(r.points, 15, '15-point hand must score 15');
    assert.match(r.breakdown.join('; '), /2 runs of 3 for 6|Run of 3 x2 for 6/);
    assert.match(r.breakdown.join('; '), /1 nob for 1/);
    console.log('PASS  J-5-J-10 with 9 starter scores all 15 points');
}

{
    // Four spades plus the spade starter: 4-6-8-10 with 7 up is 10 points,
    // not just the flush. 7+8 is a fifteen (2), 6-7-8 is a run (3), and the
    // five-card flush is 5. No second fifteen exists in this hand.
    const r = countHand(['4♠', '6♠', '8♠', '10♠'], '7♠');
    assert.equal(r.points, 10, '4-6-8-10 spades with 7 spades must score 10');
    assert.deepEqual(r.breakdown, ['1 fifteen for 2', 'Run of 3 for 3', 'Flush for 5']);
    console.log('PASS  4-6-8-10 spades with 7 spades scores 10 (15 + run + flush)');
}

{
    // Same flush shape without the 7 up is correctly flush-only. This guards
    // against "fixing" the reported hand by awarding points that are not there.
    const r = countHand(['4♠', '6♠', '8♠', '10♠'], '2♠');
    assert.equal(r.points, 5, '4-6-8-10 spades with 2 spades scores only the flush');
    assert.deepEqual(r.breakdown, ['Flush for 5']);
    console.log('PASS  spade flush without the 7 starter stays at 5');
}

{
    // Stray low pair must not inflate the 6-7-8 run.
    const r = countHand(['6♠', '3♣', '7♣', '8♥'], '3♥');
    assert.equal(r.points, 7, '6-7-8 with a stray 3 pair scores 7, not 10');
    assert.match(r.breakdown.join('; '), /Run of 3 for 3/);
    console.log('PASS  run multiplicity uses the run ranks, not the lowest ranks');
}

{
    // A starter Jack is not the player's Jack and cannot score nobs.
    const r = countHand(['4♣', '5♦', '6♥', '9♣'], 'J♠');
    assert.equal(r.points, 9, 'Starter Jack must not score a phantom nob');
    assert.doesNotMatch(r.breakdown.join('; '), /nob/);
    console.log('PASS  starter Jack does not count as nobs');
}

{
    // Classic 29 hand: 8 fifteens (16), four 5s (12), nobs (1). The starter
    // is the club 5, so the hand's club Jack scores nobs.
    const r = countHand(['5♦', '5♥', '5♠', 'J♣'], '5♣');
    assert.equal(r.points, 29, 'The classic 29 hand still scores 29');
    console.log('PASS  classic 29 hand scores 29');
}

{
    // Crib 2-3-4-5 with a heart starter: two fifteens (4), run of five (5),
    // and a five-card crib flush (5) = 14.
    const withStarter = countHand(['2♥', '3♥', '4♥', '5♥'], '6♥', true);
    assert.equal(withStarter.points, 14, 'Crib flush scores 14');
    assert.match(withStarter.breakdown.join('; '), /Flush \(crib\) for 5/);
    console.log('PASS  crib flush and run scoring stay correct');
}

// --- Play / count scoring ----------------------------------------------------
{
    assert.equal(scorePile(['5♣', '10♥']).points, 2, '15 during play scores 2');
    const thirtyOne = scorePile(['10♣', 'J♦', 'Q♥', 'A♠']);
    assert.equal(thirtyOne.points, 0, '31 is awarded once by playCard, not again in scorePlay');
    console.log('PASS  play-phase 15 scores 2 and 31 is not double-counted');
}

{
    // A run must include the card just played.
    const stale = scorePile(['5♣', '6♦', '7♥', '9♠']);
    assert.equal(stale.points, 0, '9 does not complete the earlier 5-6-7 run');
    const completed = scorePile(['5♣', '7♦', '6♥']);
    assert.equal(completed.points, 3, '6 completes a 5-6-7 run even when played out of order');
    console.log('PASS  play runs require the last card and accept any play order');
}

{
    // Duplicated ranks multiply the completed run.
    const doubled = scorePile(['3♣', '4♦', '4♥', '5♠']);
    assert.equal(doubled.points, 6, '3-4-4-5 is two runs of 3 for 6');
    assert.match(doubled.reasons.join('; '), /Run of 3 x2 for 6/);
    console.log('PASS  duplicate ranks multiply play runs');
}

{
    const e = makeEngine(3);
    e.phase = 'PLAY';
    e.dealerIndex = 2;
    e.lastPlayIndex = 1;
    e.hands = [hand(['A♣']), hand(['2♣']), hand(['3♣'])];
    e.endPlayRound();
    assert.equal(e.currentPlayerIndex, 2, 'A new count starts after the last player, not at player 0');

    const allDone = makeEngine(3);
    allDone.phase = 'PLAY';
    allDone.dealerIndex = 1;
    allDone.lastPlayIndex = 1;
    allDone.hands = [[], [], []];
    allDone.endPlayRound();
    assert.equal(allDone.phase, 'COUNT_HAND');
    assert.equal(allDone.currentPlayerIndex, 2, 'Hand counting starts left of the dealer');
    console.log('PASS  new counts start after the last player who played');
}

{
    const e = makeEngine();
    e.phase = 'PLAY';
    e.currentPlayerIndex = 0;
    e.goCount = 1;
    e.lastPlayIndex = -1;
    e.hands = [[], []];
    assert.equal(e.sayGo(0).success, true);
    assert.equal(hasNumericKey(e.scores, '-1'), false, 'All-pass must not award GO to player -1');
    console.log('PASS  all-pass GO guard prevents player -1');
}

// --- Phase / attribution -----------------------------------------------------
{
    const e = makeEngine();
    e.phase = 'COUNT_HAND';
    e.dealerIndex = 1;
    e.currentPlayerIndex = 0;
    e.scores = [119, 50];
    e.hands[0] = hand(['5♣', '10♥']);
    e.hands[1] = hand(['2♣', '3♥']);
    e.starter = Card.fromString('5♦');
    const r = e.proceedToNextCount();
    assert.equal(e.winner, 0);
    assert.equal(e.phase, 'GAME_OVER', 'A win during hand counting must not be overwritten by COUNT_CRIB');
    assert.equal(r.phase, 'GAME_OVER');
    console.log('PASS  wins during counting are not overwritten');
}

{
    const e = makeEngine();
    e.phase = 'COUNT_HAND';
    e.dealerIndex = 1;
    e.currentPlayerIndex = 0;
    e.hands[0] = hand(['2♣', '3♦']);
    e.hands[1] = hand(['4♣', '5♦']);
    e.crib = hand(['9♣', '9♦']);
    e.starter = Card.fromString('6♥');
    const beforeCrib = e.proceedToNextCount();
    assert.equal(beforeCrib.phase, 'COUNT_CRIB');
    const afterCrib = e.proceedToNextCount();
    assert.equal(afterCrib.cribPlayer, 1, 'Crib event must name the owner before dealer rotation');
    console.log('PASS  crib score events are attributed before dealer rotation');
}

// --- AI evaluator mirrors the real scorer ------------------------------------
{
    const e = makeEngine();
    const ai = new CribbageAI('hard');
    const cases = [
        ['J♦', '5♥', 'J♥', '10♣', '9♥'],
        ['6♠', '3♣', '7♣', '8♥', '3♥'],
        ['3♣', '4♦', '4♥', '5♠', '9♥'],
        ['5♣', '5♦', '5♥', '5♠', 'J♣']
    ];
    for (const cards of cases) {
        const c = hand(cards);
        assert.equal(ai.countRunsStatic(c).points, e.countRuns(c).points,
            'AI run evaluation must match authoritative scoring for ' + cards.join(' '));
    }
    console.log('PASS  AI run evaluation matches the real scorer');
}

console.log('all cribbage scoring assertions passed');
