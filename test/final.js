/* Final validation of the shipped generator defaults. */
const M = require('../puzzle.js');

function connected(n, regions, k) {
  const size = n * n;
  const seen = new Uint8Array(size);
  let seed = -1;
  for (let i = 0; i < size; i++) if (regions[i] === k) { seed = i; break; }
  const stack = [seed]; seen[seed] = 1;
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

const perSize = Number(process.argv[2] || 30);
let failures = 0;
console.log('  n  puzzles  fails  avgMs  maxMs  pureSingles  avgRounds  singleCellRegions  sizeMax');
for (let n = 5; n <= 10; n++) {
  let sumMs = 0, maxMs = 0, pure = 0, sumRounds = 0, sumSingles = 0, sizeMax = 0;
  for (let i = 0; i < perSize; i++) {
    const rng = M.mulberry32(700000 + n * 1000 + i);
    const t0 = Date.now();
    const p = M.generate(n, { rng });
    const ms = Date.now() - t0;
    sumMs += ms; maxMs = Math.max(maxMs, ms);
    if (!p) { failures++; console.log(`  !! generate failed n=${n} i=${i}`); continue; }
    if (M.countSolutions(n, p.regions, 2) !== 1) { failures++; console.log('  !! not unique'); continue; }
    if (!M.solveByLogic(n, p.regions, p.solution)) { failures++; console.log('  !! not logic-solvable'); continue; }
    for (let k = 0; k < n; k++) if (!connected(n, p.regions, k)) { failures++; console.log('  !! disconnected region'); break; }
    // verify the four rules on the answer
    const cells = M.solutionCells(p);
    const rows = new Set(), cols = new Set(), regs = new Set();
    for (const c of cells) { rows.add((c / n) | 0); cols.add(c % n); regs.add(p.regions[c]); }
    if (rows.size !== n || cols.size !== n || regs.size !== n) { failures++; console.log('  !! rule violation'); continue; }
    for (let a = 0; a < cells.length; a++) for (let b = a + 1; b < cells.length; b++) {
      const r1 = (cells[a] / n) | 0, c1 = cells[a] % n;
      const r2 = (cells[b] / n) | 0, c2 = cells[b] % n;
      if (Math.abs(r1 - r2) <= 1 && Math.abs(c1 - c2) <= 1) { failures++; console.log('  !! cats touching'); }
    }
    if (p.stats.rounds === 0) pure++;
    sumRounds += p.stats.rounds;
    const counts = new Int32Array(n);
    for (let j = 0; j < p.regions.length; j++) counts[p.regions[j]]++;
    for (let k = 0; k < n; k++) { if (counts[k] === 1) sumSingles++; sizeMax = Math.max(sizeMax, counts[k]); }
  }
  console.log(
    `  ${n}  ${String(perSize).padStart(7)}  ${String(failures).padStart(5)}  ` +
    `${String((sumMs / perSize).toFixed(0)).padStart(5)}  ${String(maxMs).padStart(5)}  ` +
    `${String(pure).padStart(11)}  ${String((sumRounds / perSize).toFixed(2)).padStart(10)}  ` +
    `${String((sumSingles / perSize).toFixed(1)).padStart(17)}  ${String(sizeMax).padStart(7)}`
  );
}
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
