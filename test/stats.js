/* Full validation + difficulty distribution. Run: node test/stats.js [perSize] */
const M = require('../puzzle.js');
const perSize = Number(process.argv[2] || 20);

function connected(n, regions, k) {
  const size = n * n;
  const seen = new Uint8Array(size);
  let seed = -1;
  for (let i = 0; i < size; i++) if (regions[i] === k) { seed = i; break; }
  const stack = [seed];
  seen[seed] = 1;
  let reached = 0;
  while (stack.length) {
    const cur = stack.pop(); reached++;
    const r = (cur / n) | 0, c = cur % n;
    const nb = [];
    if (r > 0) nb.push(cur - n);
    if (r < n - 1) nb.push(cur + n);
    if (c > 0) nb.push(cur - 1);
    if (c < n - 1) nb.push(cur + 1);
    for (const j of nb) if (!seen[j] && regions[j] === k) { seen[j] = 1; stack.push(j); }
  }
  let total = 0;
  for (let i = 0; i < size; i++) if (regions[i] === k) total++;
  return reached === total;
}

console.log('  n  count  avgMs  maxMs  trials[0/1-3/4-9/10+]  minSize  maxSize  fails');
for (let n = 5; n <= 10; n++) {
  const times = [];
  const buckets = [0, 0, 0, 0];
  let minSize = Infinity, maxSize = 0, fails = 0;
  for (let i = 0; i < perSize; i++) {
    const rng = M.mulberry32(100000 + n * 1000 + i);
    const t0 = Date.now();
    const p = M.generate(n, { rng, quality: 1, timeBudgetMs: 15000 });
    times.push(Date.now() - t0);
    if (!p) { fails++; continue; }
    if (M.countSolutions(n, p.regions, 2) !== 1) { fails++; console.log('  !! not unique n=' + n + ' i=' + i); continue; }
    if (!M.solveByLogic(n, p.regions, p.solution)) { fails++; console.log('  !! not logic n=' + n + ' i=' + i); continue; }
    for (let k = 0; k < n; k++) if (!connected(n, p.regions, k)) { fails++; console.log('  !! disconnected n=' + n + ' i=' + i); break; }
    const t = p.stats.trials;
    buckets[t === 0 ? 0 : t <= 3 ? 1 : t <= 9 ? 2 : 3]++;
    const counts = new Int32Array(n);
    for (let j = 0; j < p.regions.length; j++) counts[p.regions[j]]++;
    minSize = Math.min(minSize, ...counts);
    maxSize = Math.max(maxSize, ...counts);
  }
  const avg = (times.reduce((a, b) => a + b, 0) / times.length).toFixed(0);
  const max = Math.max(...times);
  console.log(
    `  ${n}  ${String(perSize).padStart(5)}  ${String(avg).padStart(5)}  ${String(max).padStart(5)}  ` +
    `${buckets.map(b => String(b).padStart(3)).join('/').padStart(18)}  ` +
    `${String(minSize).padStart(7)}  ${String(maxSize).padStart(7)}  ${fails}`
  );
}
console.log('\ndone.');
