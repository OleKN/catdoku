# 🐱 Mewdoku

A cosy, cat-themed logic puzzle that runs in the browser and installs on an
iPhone home screen like a native app. No numbers, no guessing — just cats who
want their personal space.

## The rules

The board is an **N×N grid split into N coloured regions**. Place one cat in
each region so that all four rules hold at once:

1. **One cat per region** — every coloured shape gets exactly one.
2. **One cat per row.**
3. **One cat per column.**
4. **No touching** — two cats may not be neighbours, including diagonally.

Since there are N regions, N rows and N columns, a solved board has exactly
N cats. Everything else gets crossed out with ✕ marks. (Because each row has
one cat, horizontal/vertical touching is already impossible — rule 4 really
means *cats in consecutive rows must be at least two columns apart*.)

## Features

- **Procedural puzzles** with a guaranteed **unique solution** that is always
  reachable by pure deduction from an empty board — no guessing required.
- Ten board sizes: 5×5 Kitten → 10×10 Legend, then the big boards
  **12×12 Estate, 16×16 Kingdom, 20×20 Empire and 25×25 Cosmos**. Big boards
  keep a comfortable minimum cell size and become scrollable: the floating
  **✋ Pan** button (shown only when needed) lets you drag around, while the ✕
  and 🐱 tools still paint and place normally.
- ✕ marks with **tap, drag-to-paint, and drag-to-erase**; double-tap or the 🐱
  tool to place a cat; tap a cat to remove it.
- Optional **✕ Auto** toggle: when a cat lands, every square its row, column,
  region and neighbours prove impossible is crossed out automatically in a
  staggered ripple. Marks you drew yourself are never overwritten, and auto
  marks are cleaned back up if you remove a cat. The setting is remembered.
- **Three hearts** — a wrong cat costs one. Local rule violations get a
  "too close!" hint; guesses that lead to a dead end get a different one.
- **Timer and best time per size**, saved in `localStorage`.
- Keyboard support: arrows to move, Enter/Space to mark, `C` to place a cat.
- **Motion design**: a drifting warm backdrop, a staggered wave when a board
  appears, ✕ marks that draw themselves, a warm halo + sparkle burst + light
  ripple when a cat lands, beating/breaking hearts, a board shake on mistakes,
  and a confetti-and-cats win celebration. Every effect is disabled when the
  device requests reduced motion.
- **Installable PWA**: standalone display, home-screen icon, safe-area aware
  layout, and full offline play via a service worker.
- Generation runs in a **Web Worker** so the loading animation never stutters
  (with a main-thread fallback).

## Running it locally

The service worker needs HTTP(S), so don't open `index.html` via `file://`.

```bash
cd mewdoku
python -m http.server 8000
# or: npx serve .
```

Then open <http://localhost:8000>. `localhost` counts as a secure context, so
the service worker and home-screen install both work there for testing.

## Hosting on GitHub Pages

Live site: **<https://olekn.github.io/catdoku/>**

There is no build step — the repository root *is* the site. Every asset uses a
relative path (`./`, `worker.js`, `sw.js`, `icons/…`), so the app works from the
project sub-path `/catdoku/` without any base-URL configuration. `.nojekyll`
disables Jekyll so the service worker and manifest are served verbatim.

Pages is already configured on this repo: **Settings → Pages → Build and
deployment → Deploy from a branch → `main` / `/ (root)`**. Every `git push` to
`main` redeploys automatically. If you fork this repo, do that one-time step
yourself under <https://github.com/<your-user>/<your-repo>/settings/pages>.

GitHub Pages serves over HTTPS, which is required for the service worker and
for Add to Home Screen on iOS. It also serves from the project sub-path
`/catdoku/` — the relative paths above are what make that work.

```bash
git add -A
git commit -m "Update game"
git push origin main
```

> If you'd rather deploy via GitHub Actions, switch the Pages source to
> **GitHub Actions** and add a workflow using `actions/configure-pages`,
> `actions/upload-pages-artifact` and `actions/deploy-pages`.

## Installing on iOS

1. Open **<https://olekn.github.io/catdoku/>** (or your own HTTPS host) in
   **Safari** — Chrome/Firefox on iOS cannot add home-screen web apps. Add to
   Home Screen requires HTTPS, which Pages provides.
3. Tap **Share → Add to Home Screen → Add**.
4. Launch **Mewdoku** from the home screen. It opens full-screen with no
   Safari chrome, uses the included `apple-touch-icon.png`, and keeps working
   offline.

> iOS reads `apple-mobile-web-app-capable`, `apple-mobile-web-app-title` and
> the `apple-touch-icon` link from `index.html`; other platforms use
> `manifest.webmanifest`.

## How puzzles are generated

`puzzle.js` is dependency-free and runs in both Node and the browser.

1. **Pick a hidden answer** — a random permutation of columns, one cat per row,
   with no diagonal touching.
2. **Grow regions** — a randomised multi-source flood fill out of the N cat
   cells. Every region stays connected and contains exactly its own cat.
3. **Refine** — random flood-filled shapes are far too loose (a 10×10 board can
   admit tens of thousands of valid arrangements). Boundary cells are moved
   between neighbouring regions — keeping both connected and keeping each
   region's cat — until exactly **one** solution remains.
4. **Prove it's fair** — a deduction engine solves the board from scratch using
   only forced singles, pointing claims, adjacency conflicts and
   proof-by-contradiction eliminations. If it stalls, the puzzle is rejected.
5. **Pick the gentlest board** — up to three candidates are sampled and the one
   needing the fewest "what-if" steps wins. Most puzzles need none at all.

Generation is fast: ~1 ms for 5×5 and well under a second for 10×10, even on a
phone. `worker.js` wraps all of this in a Web Worker.

**Big boards (12×12 and up)** use a different, constructive generator. The
search above stops scaling past ~11×11 (both the uniqueness hill-climb and the
exhaustive solver blow up). Instead the regions are built around a guaranteed
chain of forced moves: region *k* only ever claims cells that are already
impossible once cats 0…k-1 are placed, so each cat becomes a naked single in
turn. That proves a unique, no-guessing solution directly — no exhaustive
search — and generation stays a few milliseconds even at 25×25. An O(n²)
`verifyChain()` assertion and the deduction engine double-check every result.

## Tests

```bash
node test/final.js 40     # small boards: uniqueness, logic, connectivity, rules
node test/big2.js         # big boards 11..30: chain proof, logic, connectivity
node test/bench.js        # engine sanity checks and generation benchmark
node test/stats.js        # difficulty / region-size distribution
node tools/make-icons.js  # regenerate the PNG icons
```

`test/final.js` verifies that every generated puzzle has exactly one solution,
is connected, is solvable from an empty board, and that the answer satisfies
all four rules.

## File layout

| File | Purpose |
| --- | --- |
| `index.html` | App shell + iOS PWA meta tags |
| `styles.css` | Layout, pastel regions, animations, safe areas |
| `puzzle.js` | Generator, exact solver, deduction engine |
| `worker.js` | Off-main-thread generation |
| `app.js` | Game state, input (pointer + keyboard), UI |
| `sw.js` | Offline caching (network-first with cache fallback) |
| `manifest.webmanifest` | Install metadata |
| `icons/` | PNG icons + SVG favicon |

## Tweaking things

- **Board sizes / labels** — the `<select id="difficulty">` in `index.html`.
- **Colours** — `buildPalette()` in `app.js`.
- **Line weights** — `--cell-line` (hairline grid between every square),
  `--grid-line` (thicker region outlines) and `--line` (outer board border)
  in `styles.css`.
- **Big-board cell size** — `--min-cell` is set in `renderBoard()` (`app.js`);
  raise it for larger, more readable cells (and more scrolling).
- **Lives** — `MAX_HEARTS` in `app.js`.
- **Puzzle difficulty** — `generate(n, { quality, maxTrials, balanceMin, ... })`
  in `puzzle.js`; `quality` controls how many candidates are sampled.
- **Deploying an update** — `sw.js` fetches network-first, so content changes
  reach players on the next launch. If you **add or remove an asset file**,
  add it to the `ASSETS` list and bump `CACHE` so existing installs repopulate
  their offline cache.
