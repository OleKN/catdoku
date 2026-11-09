/* Generator benchmark / sanity checks. Run: node test/bench.js */
const M = require('../puzzle.js');

function check(label, cond) {
  if (!cond) throw new Error('FAILED: ' + label);
  console.log('  ok  ' + label);
}

console.log('--- sanity ---');
for (let n = 4; n <= 10; n++) {
  const rng = M.mulberry32(1234 + n);
  const sol = M._internals.randomSolution(n, rng);
  check(`randomSolution(${n})`, !!sol);
  check(`  is permutation`, new Set(sol).size === n);
  check(`  no diagonal touching`, sol.every((c, r) => r === 0 || Math.abs(c - sol[r - 1]) >= 2));

  const regions = M._internals.growRegions(n, sol, rng, 1.4);
  check(`growRegions(${n})`, !!regions);
  const counts = new Int32Array(n);
  for (let i = 0; i < regions.length; i++) counts[regions[i]]++;
  check(`  all ${n} regions present`, counts.every(c => c > 0));
  check(`  all cells assigned`, regions.every(r => r >= 0 && r < n));
  check(`  one cat per region`, sol.every((c, r) => { const k = regions[r * n + c]; let found = 0; for (let rr = 0; rr < n; rr++) if (regions[rr * n + sol[rr]] === k) found++; return found === 1; }));
  check(`  contains intended solution`, M.countSolutions(n, regions, 99) >= 1);
}

console.log('\n--- deduction engine on a hand-made tiny board ---');
// 4x4 example: build regions from a known solution [1,3,0,2] by hand.
{
  const n = 4;
  const sol = [1, 3, 0, 2];
  const regions = [
    0, 0, 1, 1,
    0, 2, 1, 1,
    2, 2, 2, 3,
    3, 3, 3, 3
  ];
  console.log('  solutions:', M.countSolutions(n, regions, 99));
  console.log('  logic solvable:', M.solveByLogic(n, regions, sol));
}

console.log('\n--- generation benchmark (seeded, 3 runs per size) ---');
console.log('  n   run   attempts   ms     unique  logicOK');
for (let n = 5; n <= 10; n++) {
  for (let run = 0; run < 3; run++) {
    const rng = M.mulberry32(9000 + n * 100 + run);
    const t0 = Date.now();
    const p = M.generate(n, { rng, maxAttempts: 20000, timeBudgetMs: 20000 });
    const ms = Date.now() - t0;
    if (!p) {
      console.log(`  ${n}   ${run}   FAILED (no puzzle in budget)  ${ms}ms`);
      continue;
    }
    const uniq = M.countSolutions(n, p.regions, 99);
    const logic = M.solveByLogic(n, p.regions, p.solution);
    console.log(`  ${n}   ${run}   ${String(p.attempts).padStart(6)}   ${String(ms).padStart(5)}   ${String(uniq).padStart(6)}  ${logic}`);
    check(`  puzzle ${n}#${run} unique`, uniq === 1);
    check(`  puzzle ${n}#${run} logic-solvable`, logic);
  }
}

console.log('\nAll checks passed.');
