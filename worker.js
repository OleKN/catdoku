/* Puzzle generation off the main thread so the loading animation stays smooth. */
importScripts('puzzle.js');

self.onmessage = function (e) {
  var d = e.data || {};
  var rng = Mewdoku.mulberry32(d.seed >>> 0);
  var puzzle = Mewdoku.generate(d.n, {
    rng: rng,
    quality: 6,
    difficulty: d.difficulty,
    timeBudgetMs: 9000
  });
  self.postMessage({ id: d.id, puzzle: puzzle });
};
