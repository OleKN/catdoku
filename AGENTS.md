# AGENTS.md — project context

Read this before changing anything. It records what this project is, how it is
deployed, and the decisions made while building it (through 2026-11-09).

## What this is

**Mewdoku / catdoku** — a cosy cat-themed logic puzzle. Static site, no
framework, no build step, no dependencies. It is an installable PWA: the
primary target is an iPhone home-screen app that also works offline.

- Repo: <https://github.com/OleKN/catdoku>
- Live: **<https://cat.bausk.no/>**
- Docs: `README.md` (rules, running locally, hosting, iOS install)

### The rules — do not change

The board is an **N×N grid split into exactly N connected, coloured regions**.
Place exactly one cat in each region so that:

1. one cat per region
2. one cat per row
3. one cat per column
4. no two cats touch, **including diagonally**

There are N regions, N rows and N columns, so a solved board has exactly N
cats. Because each row has one cat, rule 4 reduces to: cats in consecutive rows
must be at least two columns apart (`|p[r+1] - p[r]| >= 2`, where `p[r]` is the
cat column in row `r`).

## Deployment — read before touching paths

- **GitHub Pages, deploy from branch `main`, folder `/ (root)`.** Push to `main`
  redeploys automatically. Repo is **public** (a private repo blocks Pages on
  the free plan).
- Custom domain `cat.bausk.no` lives in the root **`CNAME`** file. DNS is at
  one.com: one record, `CNAME cat -> olekn.github.io` (no repo name, no path).
  The `_github-pages-challenge-*` TXT record is **optional** domain
  verification, not needed for the site to work.
- **`.nojekyll` must stay** — otherwise Jekyll mangles the service worker and
  manifest.
- **All asset URLs are relative** (`./`, `worker.js`, `sw.js`, `icons/…`).
  This is deliberate: the site has to work both at a domain root and at the
  project sub-path `/catdoku/`. Never introduce absolute `/...` or hard-coded
  `github.io` URLs in app code.
- `https://olekn.github.io/catdoku/` 301-redirects to the custom domain.
- HTTPS is enforced and the certificate is issued. `<https://cat.bausk.no/>`
  serves all assets with correct MIME types.
- `sw.js` is network-first with a cache fallback; cache name is
  **`mewdoku-v10`**. Content updates propagate without a version bump, but
  **adding/removing an asset file requires updating `ASSETS` and bumping
  `CACHE`**.
- No `gh` CLI and no `GITHUB_TOKEN` in this environment; `git push` works via
  Git Credential Manager. The GitHub REST API is reachable with the stored
  credential if a settings change is ever needed.
- The sandbox's DNS for `cat.bausk.no` was unreliable (stale NXDOMAIN). To
  verify a deploy, use Google DoH
  (`https://dns.google/resolve?name=cat.bausk.no&type=A`) or bypass DNS:
  `curl --resolve cat.bausk.no:443:185.199.108.153 https://cat.bausk.no/`.

## Architecture

| File | Role |
| --- | --- |
| `index.html` | App shell, iOS PWA meta tags, scroll/pan containers |
| `styles.css` | Layout, pastel regions, hairline cell grid, region outlines, animations |
| `puzzle.js` | Generator + exact solver + deduction engine (UMD: Node + browser) |
| `worker.js` | Off-main-thread generation (`importScripts('puzzle.js')`) |
| `app.js` | Game state, pointer/keyboard input, rendering, auto-mark, pan |
| `sw.js` | Offline caching |
| `manifest.webmanifest` | Install metadata (`start_url`/`scope` are `./`) |
| `icons/` | PNG icons + SVG favicon |
| `test/` | Node validation scripts |
| `tools/make-icons.js` | Dependency-free PNG icon generator |

### Generator — two strategies, do not merge them

- **n <= 10 (`generate`)**: random flood-filled regions → boundary-cell
  refinement hill climb until exactly one solution → `analyzeLogic` proves the
  board is solvable from empty by pure deduction → sample up to `quality`
  candidates and keep the gentlest. This is the "no guessing" guarantee.
- **n > 10 (`generateLarge`)**: the search above does **not** scale (the
  uniqueness hill climb and the exhaustive solver blow up past ~11×11; a 16×16
  attempt took minutes). Big boards use a **constructive** generator that builds
  regions around a guaranteed chain of forced naked singles: region `k` may
  only claim cells already impossible once cats `0..k-1` are placed. That
  proves uniqueness and logic-solvability by construction. `verifyChain()` is
  an O(n²) assertion of the invariant, `repairRegions()` fixes disconnected
  islands, and `analyzeLogic(..., true)` (fast-only, skipping trial elimination)
  is the final check. Generation is ~5 ms at 25×25.
- `analyzeLogic(n, regions, solution, fastOnly)` — `fastOnly` skips trial
  elimination, which is what makes large boards cheap to verify.

## Features and decisions made in this conversation

**Chosen by the user:** procedural generator (not hand-authored levels);
3 hearts / strikes; ✕ marks with tap + drag paint + drag erase; double-tap or
🐱 tool to place a cat; difficulty by board size; timer + best time per size;
win state; installable iOS PWA.

**Explicitly declined — do not add without asking:** hints, undo / restart
button. (A "Try again" on the lose screen is fine; it is a game-over action,
not an undo feature.)

**Added later at the user's request:**
- Motion design: ambient drifting orbs/paws, staggered board reveal, ✕ marks
  that draw themselves, cat halo + sparkles + light ripple on placement, heart
  beats/breaks, board shake, confetti and a cat parade on win, loading paw
  trail. **Every effect must respect `prefers-reduced-motion`** (CSS media
  query + `reduceMotion` guard for Web Animations in `app.js`).
- Optional **✕ Auto** toggle (off by default, persisted in `localStorage`):
  when a cat lands, cross out its row/column/region/8-neighbours in a
  staggered ripple. It recomputes from the *current* cat set, never overwrites
  hand-drawn marks, and cleans its marks back up when a cat is removed.
- A **hairline grid between every square** (`--cell-line`) in addition to the
  thicker region outlines (`--grid-line`) and outer border (`--line`). Drawn as
  two SVG paths in `#regionLines`; keep it.
- Big boards up to **25×25** and a scrollable, pannable board.

**Board sizes:** 5, 6, 7, 8, 9, 10 (search generator) and 12, 16, 20, 25
(constructive generator). Valid sizes are listed in `init()` in `app.js`.

**Big-board UI:** `--min-cell: 30px` makes `.board-stage` larger than the
`.board-scroll` viewport; the floating **✋ Pan** FAB appears only when the
board is actually scrollable. Pan mode uses native touch scrolling plus mouse
drag panning and is view-only. ✕/🐱 tools still paint/place normally.
**Never put a `transform` on `.board-wrap`** — it becomes the containing block
for the `position: fixed` full-screen overlay. Shake uses `.board-scroll`.

## Workflow / checks

```bash
# local dev (service worker needs HTTP, file:// will not work)
python -m http.server 8000

# before pushing
node test/final.js 40     # small boards: uniqueness, logic, connectivity, rules
node test/big2.js         # big boards 11..30: chain proof, logic, connectivity
node test/bench.js        # engine sanity + generation benchmark
node test/stats.js        # difficulty / region-size distribution
node tools/make-icons.js  # regenerate PNG icons
```

`test/final.js` and `test/big2.js` must both report `ALL CHECKS PASSED`. The
browser preview at `http://localhost:8000` is useful for visual checks; verify
there are no console errors after interaction changes.

## Current state (2026-11-09)

- `main` at `75953b9`, clean working tree, `origin` =
  `https://github.com/OleKN/catdoku.git`.
- Live at <https://cat.bausk.no/> with HTTPS enforced; all assets 200; old
  github.io URL redirects.
- Everything requested so far has been delivered. Open questions / possible
  future work: sound effects, dark mode, a daily puzzle, more hearts on big
  boards (currently always 3).
