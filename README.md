# CRIBBAGE SAFARI 🦁🦓

Old School 8-Bit Multiplayer Cribbage with Safari Theme

## Features

- **Multiplayer**: 1v1 Head-to-Head or 3-Player Safari Trio
- **Authentic Cribbage Rules**: Full scoring (15s, pairs, runs, flushes, nobs)
- **Real-time Play**: WebSocket-based multiplayer (simulated via localStorage for GitHub Pages)
- **Safari 8-Bit Art Style**: Pixel-perfect retro aesthetic
- **Cribbage Board**: Visual peg tracking with 121 holes
- **Dealer Rotation**: Automatic dealer chip passing
- **Phases**: Deal → Discard → Starter → Play → Count Hands → Count Crib
- **Game Log**: Real-time action log

## Game Rules

### Cribbage Basics
- **Goal**: First to 121 points (peg around the board twice)
- **Deck**: Standard 52 cards
- **Deal**: 6 cards each (1v1), 5 cards each (3-player)
- **Discard**: 2 cards to crib (1v1), 1 card to crib (3-player)
- **Starter**: Cut card turned up after discard
- **Play**: Players alternate playing cards, count ≤ 31
- **Scoring**: During play + hand counting + crib counting

### Scoring
| Combination | Points |
|------------|--------|
| Fifteen (cards sum to 15) | 2 |
| Pair | 2 |
| Three of a Kind | 6 |
| Four of a Kind | 12 |
| Run of 3+ | 1 per card |
| Flush (4 same suit) | 4 (5 with starter) |
| Nobs (Jack of starter suit) | 1 |
| 31 exactly | 2 |
| GO (last card under 31) | 1 |

## Controls

- **Click cards** to select/discard
- **Space** - Play selected card (Play phase)
- **G** - Say GO (Play phase)
- **Enter** - Count hand/crib
- **Escape** - Close modals

## Deployment

### GitHub Pages
1. Push to `main` branch
2. Enable GitHub Pages in repo settings
3. Site deploys to `https://goldennftplatform-svg.github.io/29/`

### Local Development
```bash
# Simple HTTP server
npx serve .
# or
python -m http.server 8000
```

## Architecture

```
index.html      - Main HTML structure
styles.css      - Safari 8-bit theme (Press Start 2P + VT323 fonts)
cribbage-engine.js - Core game logic (pure JS, no deps)
network.js      - Multiplayer sync (localStorage for GH Pages)
game.js         - Game state & UI management
main.js         - Entry point & event handlers
```

## Multiplayer Note

For GitHub Pages (static hosting), multiplayer uses `localStorage` as a simple message bus. All players must have the page open in the same browser (or use a shared localStorage via same origin). For production, replace `network.js` with a WebSocket server.

## Credits

- Fonts: Press Start 2P, VT323 (Google Fonts)
- Inspired by classic 8-bit safari aesthetics
- Cribbage rules per American Cribbage Congress

---

**MADE FOR THE SAVANNAH** 🌴