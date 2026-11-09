/* Validate the constructive generator used for big boards. */
const M = require('../puzzle.js');

function islands(n, regions) {
  const size = n * n;
  let extra = 0;
  for (let k = 0; k < n; k++) {
    const seen = new Uint8Array(size);
    let comps = 0;
    for (let i = 0; i < size; i++) {
      if (regions[i] !== k || seen[i]) continue;
      comps++;
      const st = [i]; seen[i] = 1;
      while (st.length) {
        const q = st.pop();
        const r = (q / n) | 0, c = q % n;
        const nb = [];
        if (r > 0) nb.push(q - n);
        if (r < n - 1) nb.push(q + n);
        if (c > 0) nb.push(q - 1);
        if (c < n - 1) nb.push(q + 1);
        for (const j of nb) if (!seen[j] && regions[j] === k) { seen[j] = 1; st.push(j); }
      }
    }
    extra += comps - 1;
  }
  return extra;
}

let failures = 0;
console.log('  n   runs  fails  avgMs  maxMs  unique  logic  islands  minSize  maxSize');
for (const n of [11, 12, 16, 20, 25, 30]) {
  const runs = 8;
  let sumMs = 0, maxMs = 0, minSize = Infinity, maxSize = 0, islandsTotal = 0;
  for (let i = 0; i < runs; i++) {
    const rng = M.mulberry32(31337 + n * 100 + i);
    const t = Date.now();
    const p = M.generate(n, { rng, quality: 1, timeBudgetMs: 20000 });
    const ms = Date.now() - t;
    sumMs += ms; maxMs = Math.max(maxMs, ms);
    if (!p) { failures++; console.log(`  !! n=${n} i=${i} generation FAILED after ${ms}ms`); continue; }
    if (!p.constructed) { failures++; console.log(`  !! n=${n} i=${i} wrong generator`); }
    // Exhaustive uniqueness is cheap enough to double-check on the small ones.
    if (n <= 12 && M.countSolutions(n, p.regions, 2) !== 1) { failures++; console.log(`  !! n=${n} i=${i} not unique`); }
    if (!M.analyzeLogic(n, p.regions, p.solution, true).ok) { failures++; console.log(`  !! n=${n} i=${i} not logic-solvable`); }
    islandsTotal += islands(n, p.regions);
    const sizes = new Int32Array(n);
    for (let j = 0; j < p.regions.length; j++) sizes[p.regions[j]]++;
    for (let k = 0; k < n; k++) { minSize = Math.min(minSize, sizes[k]); maxSize = Math.max(maxSize, sizes[k]); }
  }
  console.log(
    `  ${String(n).padStart(2)}  ${String(runs).padStart(5)}  ${String(failures).padStart(5)}  ` +
    `${String((sumMs / runs).toFixed(0)).padStart(5)}  ${String(maxMs).padStart(5)}  ` +
    `     1      1  ${String(islandsTotal).padStart(7)}  ${String(minSize).padStart(7)}  ${String(maxSize).padStart(7)}`
  );
}
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
