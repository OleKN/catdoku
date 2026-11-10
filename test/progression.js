/* XP, adaptation, candidate ranking, and UI/worker integration. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const P = require('../progression.js');
const M = require('../puzzle.js');

for (const size of P.sizes) {
  for (let tier = 0; tier < P.tiers.length; tier++) {
    const profile = { xp: 80, size, tier };
    const target = P.targetTime(size, tier);
    for (const [elapsed, earned, pace] of [
      [0, 40, 'fast'], [target * .75, 40, 'fast'],
      [target * .75 + 1, 25, 'steady'], [target * 1.5 - 1, 25, 'steady'],
      [target * 1.5, 20, 'slow'], [target * 10, 20, 'slow']
    ]) {
      const result = P.complete(profile, elapsed);
      assert.equal(result.earned, earned);
      assert.equal(result.pace, pace);
      assert.equal(result.profile.xp, 80 + earned);
      assert.equal(result.leveledUp, true);
      assert(P.valid(result.profile));
      assert.deepEqual(profile, { xp: 80, size, tier });
    }
    const steady = P.complete(profile, target).profile;
    assert.equal(steady.size, size);
    assert.equal(steady.tier, tier);
  }
}
assert.equal(P.level(0), 1);
assert.equal(P.level(99), 1);
assert.equal(P.level(100), 2);
assert.equal(P.complete({ xp: 0, tier: 0, size: 5 }, 0).leveledUp, false);
assert.deepEqual(P.complete({ xp: 0, tier: 3, size: 10 }, 0).profile,
  { xp: 40, tier: 1, size: 12 });
assert.deepEqual(P.complete({ xp: 0, tier: 0, size: 12 }, 1e9).profile,
  { xp: 20, tier: 1, size: 10 });
assert.deepEqual(P.complete({ xp: 0, tier: 3, size: 25 }, 0).profile,
  { xp: 40, tier: 3, size: 25 });
assert.deepEqual(P.complete({ xp: 0, tier: 0, size: 5 }, 1e9).profile,
  { xp: 20, tier: 0, size: 5 });
for (const invalid of [null, {}, { xp: -1, tier: 0, size: 5 },
  { xp: 1.2, tier: 0, size: 5 }, { xp: 0, tier: 4, size: 5 },
  { xp: 0, tier: 0, size: 11 }, { xp: Number.MAX_SAFE_INTEGER, tier: 0, size: 5 }]) {
  assert.equal(P.valid(invalid), false);
  assert.throws(() => P.complete(invalid, 1000));
}
assert.throws(() => P.complete({ xp: 0, tier: 0, size: 5 }, -1));
assert.throws(() => P.complete({ xp: 0, tier: 0, size: 5 }, NaN));
assert.throws(() => M.generate(5, { difficulty: 4 }));

function connected(p, region) {
  const first = p.regions.indexOf(region);
  const seen = new Set([first]), queue = [first];
  for (const cell of queue) {
    const r = Math.floor(cell / p.n), c = cell % p.n;
    for (const [row, col] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
      if (row < 0 || col < 0 || row >= p.n || col >= p.n) continue;
      const next = row * p.n + col;
      if (!seen.has(next) && p.regions[next] === region) { seen.add(next); queue.push(next); }
    }
  }
  return seen.size === p.regions.filter(k => k === region).length;
}

let distinct = 0;
for (const size of P.sizes) {
  const scores = [];
  for (let tier = 0; tier < 4; tier++) {
    const puzzle = M.generate(size, {
      rng: M.mulberry32(1234 + size), quality: 6, difficulty: tier, timeBudgetMs: 30000
    });
    assert(puzzle, `Generation failed at ${size}, tier ${tier}`);
    assert(puzzle.stats.ok);
    assert(M.analyzeLogic(size, puzzle.regions, puzzle.solution, size > 10).ok);
    if (size <= 10) assert.equal(M.countSolutions(size, puzzle.regions, 2), 1);
    else assert.equal(puzzle.constructed, true);
    for (let k = 0; k < size; k++) assert(connected(puzzle, k));
    assert.equal(new Set(puzzle.solution).size, size);
    assert.equal(new Set(M.solutionCells(puzzle).map(i => puzzle.regions[i])).size, size);
    for (let r = 1; r < size; r++) assert(Math.abs(puzzle.solution[r] - puzzle.solution[r - 1]) >= 2);
    scores.push(M.difficultyScore(puzzle));
  }
  for (let i = 1; i < scores.length; i++) assert(scores[i] >= scores[i - 1], `${size}: tiers not ordered`);
  if (scores[3] > scores[0]) distinct++;
  console.log(`${size}x${size} tier scores: ${scores.map(s => s.toFixed(2)).join(', ')}`);
}
assert.equal(distinct, P.sizes.length, 'Every tested size must offer a measurable complexity shift');

// Expose the private UI functions only inside this VM, without production hooks.
function uiHarness(saved) {
  const elements = new Map(), storage = new Map(Object.entries(saved || {}));
  const warnings = [], requests = [], generated = [], frames = [];
  let now = 100000;
  function element() {
    return {
      textContent: '', innerHTML: '', hidden: true, dataset: {}, children: [],
      classList: { add() {}, remove() {}, toggle() {} },
      appendChild(child) { this.children.push(child); },
      setAttribute() {}, style: { setProperty() {} }, addEventListener() {}
    };
  }
  function get(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); }
  const context = {
    Mewdoku: { ...M, generate(n, options) { generated.push({ n, ...options }); return null; } },
    MewdokuProgression: P,
    document: { getElementById: get, querySelector: get, createElement: element, hidden: false },
    window: { matchMedia: () => ({ matches: true }), Worker: true },
    Worker: function () { this.postMessage = d => requests.push(d); },
    console: { warn: (...args) => warnings.push(args) },
    Date: { now: () => now },
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    Set, Number,
    setTimeout() {}, clearTimeout() {}, clearInterval() {},
    requestAnimationFrame: fn => frames.push(fn)
  };
  const code = fs.readFileSync(require.resolve('../app.js'), 'utf8').replace('  init();',
    `window.test = { state, checkWin, loseHeart, restartSame, requestPuzzle, initWorker,
      pauseTimer, resumeTimer, stopTimer, loadProfile,
      getProfile: function () { return profile; },
      setProfile: function (p) { profile = p; } };`);
  vm.runInNewContext(code, context);
  return { ...context.window.test, elements, storage, requests, generated, warnings, frames,
    setNow(value) { now = value; } };
}
const ui = uiHarness();
ui.setProfile({ xp: 80, tier: 3, size: 5 });
Object.assign(ui.state, {
  size: 5, challengeTier: 3, puzzle: { n: 5 }, solutionSet: new Set([0, 7, 14, 16, 23]),
  cells: Array.from({ length: 25 }, (_, i) => [0, 7, 14, 16, 23].includes(i) ? 2 : 0),
  catsPlaced: 5, finished: false, elapsed: 10000
});
ui.checkWin();
assert.equal(ui.getProfile().xp, 120);
assert.equal(ui.getProfile().size, 6);
assert.match(ui.elements.get('overlay').innerHTML, /Level up!/);
assert.match(ui.elements.get('overlay').innerHTML, /\+40 XP/);
ui.checkWin();
assert.equal(ui.getProfile().xp, 120, 'A completed board must not award XP twice');
assert.equal(JSON.parse(ui.storage.get('mewdoku.progress')).size, 6);
ui.initWorker();
ui.requestPuzzle(ui.getProfile().size);
assert.equal(ui.requests[0].n, 6);
assert.equal(ui.requests[0].difficulty, 1);
assert.equal(ui.elements.get('difficulty').value, '6');
ui.requestPuzzle(8);
assert.equal(ui.getProfile().xp, 120, 'Manual size changes must preserve XP');
assert.equal(ui.getProfile().size, 8);

const retry = uiHarness();
Object.assign(retry.state, {
  puzzle: { n: 5, regions: new Array(25).fill(0) }, cells: new Array(25).fill(0),
  hearts: 1, finished: false, elapsed: 80000
});
retry.loseHeart(0);
assert.equal(retry.getProfile().xp, 0, 'Losses must not earn XP');
assert.equal(retry.state.retryElapsed, 80000);
retry.restartSame();
assert.equal(retry.state.retryElapsed, 80000, 'Retries must retain failed-attempt time');
Object.assign(retry.state, {
  solutionSet: new Set([0, 7, 14, 16, 23]), catsPlaced: 5, elapsed: 1000,
  cells: Array.from({ length: 25 }, (_, i) => [0, 7, 14, 16, 23].includes(i) ? 2 : 0)
});
retry.checkWin();
assert.equal(retry.getProfile().xp, 20, 'A memorized retry must not earn a speed bonus');
Object.assign(retry.state, { running: true, startTime: 90000, paused: false });
retry.pauseTimer();
retry.setNow(200000);
retry.stopTimer();
assert.equal(retry.state.elapsed, 10000, 'Paused time must not affect completion pace');

const fallback = uiHarness({ 'mewdoku.progress': '{"xp":160,"tier":2,"size":9}' });
fallback.loadProfile();
assert.equal(fallback.getProfile().xp, 160);
fallback.requestPuzzle(9);
while (fallback.frames.length) fallback.frames.shift()();
assert.equal(fallback.generated[0].difficulty, 2);
assert.equal(fallback.generated[0].quality, 6);
const corrupt = uiHarness({ 'mewdoku.progress': 'not json' });
corrupt.loadProfile();
assert.equal(corrupt.getProfile().xp, 0);
assert.equal(corrupt.warnings.length, 1);

let workerRequest;
vm.runInNewContext(fs.readFileSync(require.resolve('../worker.js'), 'utf8'), {
  importScripts() {},
  Mewdoku: { mulberry32: M.mulberry32, generate(n, options) { workerRequest = { n, ...options }; return null; } },
  self: { postMessage() {}, set onmessage(fn) { fn({ data: { id: 1, n: 9, seed: 1, difficulty: 2 } }); } }
});
assert.equal(workerRequest.difficulty, 2);
assert.equal(workerRequest.quality, 6);
console.log('ALL PROGRESSION CHECKS PASSED');
