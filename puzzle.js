/*
 * Mewdoku puzzle engine.
 *
 * A board is an N x N grid partitioned into exactly N connected "regions".
 * The solver must place exactly N cats so that:
 *   1. every region holds exactly one cat
 *   2. every row holds exactly one cat
 *   3. every column holds exactly one cat
 *   4. no two cats touch, including diagonally
 *
 * Because each row holds one cat, horizontal/vertical touching is impossible,
 * so rule 4 reduces to: cats in consecutive rows must be >= 2 columns apart.
 *
 * This module is deliberately dependency-free and runs both in the browser
 * (as window.Mewdoku) and in Node (for tests / benchmarking).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Mewdoku = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- utilities

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  function orthogonal(idx, n) {
    var r = (idx / n) | 0;
    var c = idx % n;
    var out = [];
    if (r > 0) out.push(idx - n);
    if (r < n - 1) out.push(idx + n);
    if (c > 0) out.push(idx - 1);
    if (c < n - 1) out.push(idx + 1);
    return out;
  }

  function surrounding(idx, n) {
    var r = (idx / n) | 0;
    var c = idx % n;
    var out = [];
    for (var dr = -1; dr <= 1; dr++) {
      for (var dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        var rr = r + dr;
        var cc = c + dc;
        if (rr >= 0 && rr < n && cc >= 0 && cc < n) out.push(rr * n + cc);
      }
    }
    return out;
  }

  // ------------------------------------------------------------ solution seed

  // A random permutation p (cat column per row) with |p[r+1]-p[r]| >= 2.
  function randomSolution(n, rng) {
    var p = new Array(n).fill(-1);
    var used = new Uint8Array(n);

    function backtrack(r, prev) {
      if (r === n) return true;
      var order = shuffle(Array.from({ length: n }, function (_, i) { return i; }), rng);
      for (var i = 0; i < order.length; i++) {
        var c = order[i];
        if (used[c]) continue;
        if (r > 0 && Math.abs(c - prev) < 2) continue;
        used[c] = 1;
        p[r] = c;
        if (backtrack(r + 1, c)) return true;
        used[c] = 0;
        p[r] = -1;
      }
      return false;
    }

    return backtrack(0, -99) ? p : null;
  }

  // ------------------------------------------------------------ region growth

  // Randomized multi-source flood fill from the N cat cells. Every newly
  // claimed cell is orthogonally adjacent to its own region, so all regions
  // stay connected and each contains exactly its own cat.
  function growRegions(n, solution, rng, balance) {
    var size = n * n;
    var region = new Int8Array(size).fill(-1);
    var sizes = new Int32Array(n).fill(1);
    var seeds = [];
    var k;

    for (var r = 0; r < n; r++) {
      var cell = r * n + solution[r];
      region[cell] = r;
      seeds.push(cell);
    }

    var frontier = [];
    for (k = 0; k < n; k++) {
      if (orthogonal(seeds[k], n).some(function (i) { return region[i] === -1; })) {
        frontier.push({ cell: seeds[k], k: k });
      }
    }

    var remaining = size - n;
    var guard = size * size * 4 + 100;

    while (remaining > 0 && guard-- > 0) {
      if (frontier.length === 0) {
        // Extremely unlikely, but recover by scanning for any boundary cell.
        for (var i = 0; i < size; i++) {
          if (region[i] === -1) continue;
          var o = orthogonal(i, n).some(function (j) { return region[j] === -1; });
          if (o) frontier.push({ cell: i, k: region[i] });
        }
        if (frontier.length === 0) return null;
      }

      // Weighted pick: smaller regions grow first (keeps shapes balanced and
      // interesting) with a little randomness mixed in.
      var total = 0;
      var weights = new Float64Array(frontier.length);
      for (var f = 0; f < frontier.length; f++) {
        var w = 1 / Math.pow(sizes[frontier[f].k], balance);
        weights[f] = w;
        total += w;
      }
      var pick = rng() * total;
      var idx = 0;
      for (; idx < frontier.length - 1; idx++) {
        pick -= weights[idx];
        if (pick <= 0) break;
      }

      var entry = frontier[idx];
      var candidates = orthogonal(entry.cell, n).filter(function (j) { return region[j] === -1; });
      if (candidates.length === 0) {
        frontier.splice(idx, 1);
        continue;
      }
      var chosen = candidates[Math.floor(rng() * candidates.length)];
      region[chosen] = entry.k;
      sizes[entry.k]++;
      remaining--;
      frontier.push({ cell: chosen, k: entry.k });
    }

    if (remaining > 0) return null;
    return region;
  }

  // ---------------------------------------------------------------- context

  function buildContext(n, regions) {
    var size = n * n;
    var rows = [];
    var cols = [];
    var regs = [];
    var r, c, i;
    for (r = 0; r < n; r++) {
      var row = [];
      for (c = 0; c < n; c++) row.push(r * n + c);
      rows.push(row);
    }
    for (c = 0; c < n; c++) {
      var col = [];
      for (r = 0; r < n; r++) col.push(r * n + c);
      cols.push(col);
    }
    for (i = 0; i < n; i++) regs.push([]);
    for (i = 0; i < size; i++) regs[regions[i]].push(i);
    return {
      n: n,
      size: size,
      regions: regions,
      rows: rows,
      cols: cols,
      regs: regs,
      units: rows.concat(cols, regs)
    };
  }

  // ---------------------------------------------------------- exact solver

  // Counts solutions, stopping at `limit`. Returns 0, 1, or `limit`.
  function countSolutions(n, regions, limit) {
    limit = limit || 2;
    var colUsed = new Uint8Array(n);
    var regUsed = new Uint8Array(n);
    var count = 0;

    function backtrack(r, prevC) {
      if (count >= limit) return;
      if (r === n) {
        count++;
        return;
      }
      for (var c = 0; c < n; c++) {
        if (colUsed[c]) continue;
        if (r > 0 && Math.abs(c - prevC) < 2) continue;
        var reg = regions[r * n + c];
        if (regUsed[reg]) continue;
        colUsed[c] = 1;
        regUsed[reg] = 1;
        backtrack(r + 1, c);
        colUsed[c] = 0;
        regUsed[reg] = 0;
        if (count >= limit) return;
      }
    }

    backtrack(0, -99);
    return count;
  }

  // ------------------------------------------------------- deduction engine

  function makeState(size) {
    return { cat: new Uint8Array(size), ban: new Uint8Array(size), placed: 0 };
  }

  function cloneState(s) {
    return { cat: s.cat.slice(), ban: s.ban.slice(), placed: s.placed };
  }

  function hasCat(state, unit) {
    for (var i = 0; i < unit.length; i++) if (state.cat[unit[i]]) return true;
    return false;
  }

  function candidatesOf(state, unit) {
    var out = [];
    for (var i = 0; i < unit.length; i++) {
      var j = unit[i];
      if (!state.cat[j] && !state.ban[j]) out.push(j);
    }
    return out;
  }

  // Places a cat and applies every immediate consequence. Returns false on a
  // contradiction (the caller discards this state in that case).
  function applyCat(state, idx, ctx) {
    if (state.cat[idx] || state.ban[idx]) return false;
    var n = ctx.n;
    var r = (idx / n) | 0;
    var c = idx % n;
    var k = ctx.regions[idx];
    var units = [ctx.rows[r], ctx.cols[c], ctx.regs[k]];
    var i, j;

    for (i = 0; i < units.length; i++) {
      var u = units[i];
      for (j = 0; j < u.length; j++) {
        if (u[j] !== idx && state.cat[u[j]]) return false;
      }
    }
    var neigh = surrounding(idx, n);
    for (i = 0; i < neigh.length; i++) if (state.cat[neigh[i]]) return false;

    state.cat[idx] = 1;
    state.placed++;
    for (i = 0; i < units.length; i++) {
      var uu = units[i];
      for (j = 0; j < uu.length; j++) if (uu[j] !== idx) state.ban[uu[j]] = 1;
    }
    for (i = 0; i < neigh.length; i++) state.ban[neigh[i]] = 1;
    return true;
  }

  // "Naked single": a row / column / region with exactly one possible cell
  // left must take its cat there.
  // "Pointing": if all candidates of a region lie in one row, that row's cat
  // is supplied by the region, so the rest of the row can be crossed out.
  // "Adjacency conflict": a candidate cat that would leave the row above or
  // below with no legal column must be crossed out.
  function propagate(state, ctx) {
    var units = ctx.units;
    var guard = 0;

    while (true) {
      if (++guard > 4000) return false;
      var changed = false;
      var placedAny;

      // --- forced cats -----------------------------------------------------
      do {
        placedAny = false;
        for (var u = 0; u < units.length; u++) {
          var unit = units[u];
          var catCount = 0;
          var candCount = 0;
          var candIdx = -1;
          for (var a = 0; a < unit.length; a++) {
            var j = unit[a];
            if (state.cat[j]) catCount++;
            else if (!state.ban[j]) {
              candCount++;
              candIdx = j;
            }
          }
          if (catCount > 1) return false;
          if (catCount === 1) {
            for (var b = 0; b < unit.length; b++) {
              var jj = unit[b];
              if (!state.cat[jj] && !state.ban[jj]) {
                state.ban[jj] = 1;
                changed = true;
              }
            }
          } else {
            if (candCount === 0) return false;
            if (candCount === 1) {
              if (!applyCat(state, candIdx, ctx)) return false;
              changed = true;
              placedAny = true;
            }
          }
        }
      } while (placedAny);

      // --- pointing --------------------------------------------------------
      if (pointing(state, ctx)) changed = true;
      // --- adjacency conflict ---------------------------------------------
      if (adjacencyConflict(state, ctx)) changed = true;

      if (!changed) return true;
    }
  }

  function pointing(state, ctx) {
    var n = ctx.n;
    var changed = false;
    var i, j, cand;

    function ban(j) {
      if (!state.cat[j] && !state.ban[j]) {
        state.ban[j] = 1;
        changed = true;
      }
    }

    for (var k = 0; k < n; k++) {
      var R = ctx.regs[k];
      if (hasCat(state, R)) continue;
      cand = candidatesOf(state, R);
      if (cand.length === 0) continue;
      var r0 = (cand[0] / n) | 0;
      var c0 = cand[0] % n;
      if (cand.every(function (x) { return ((x / n) | 0) === r0; }) && !hasCat(state, ctx.rows[r0])) {
        for (j = 0; j < ctx.rows[r0].length; j++) {
          var rj = ctx.rows[r0][j];
          if (ctx.regions[rj] !== k) ban(rj);
        }
      }
      if (cand.every(function (x) { return (x % n) === c0; }) && !hasCat(state, ctx.cols[c0])) {
        for (j = 0; j < ctx.cols[c0].length; j++) {
          var cj = ctx.cols[c0][j];
          if (ctx.regions[cj] !== k) ban(cj);
        }
      }
    }

    for (var r = 0; r < n; r++) {
      if (hasCat(state, ctx.rows[r])) continue;
      cand = candidatesOf(state, ctx.rows[r]);
      if (!cand.length) continue;
      var kr = ctx.regions[cand[0]];
      if (cand.every(function (x) { return ctx.regions[x] === kr; }) && !hasCat(state, ctx.regs[kr])) {
        for (i = 0; i < ctx.regs[kr].length; i++) {
          var ri = ctx.regs[kr][i];
          if (((ri / n) | 0) !== r) ban(ri);
        }
      }
    }

    for (var c = 0; c < n; c++) {
      if (hasCat(state, ctx.cols[c])) continue;
      cand = candidatesOf(state, ctx.cols[c]);
      if (!cand.length) continue;
      var kc = ctx.regions[cand[0]];
      if (cand.every(function (x) { return ctx.regions[x] === kc; }) && !hasCat(state, ctx.regs[kc])) {
        for (i = 0; i < ctx.regs[kc].length; i++) {
          var ci = ctx.regs[kc][i];
          if ((ci % n) !== c) ban(ci);
        }
      }
    }
    return changed;
  }

  function adjacencyConflict(state, ctx) {
    var changed = false;
    for (var r = 0; r < ctx.n; r++) {
      if (hasCat(state, ctx.rows[r])) continue;
      var cand = candidatesOf(state, ctx.rows[r]);
      for (var a = 0; a < cand.length; a++) {
        var j = cand[a];
        if (state.ban[j] || state.cat[j]) continue;
        var c = j % ctx.n;
        for (var d = -1; d <= 1; d += 2) {
          var r2 = r + d;
          if (r2 < 0 || r2 >= ctx.n) continue;
          if (hasCat(state, ctx.rows[r2])) continue;
          var other = candidatesOf(state, ctx.rows[r2]);
          if (other.length && other.every(function (x) { return Math.abs((x % ctx.n) - c) <= 1; })) {
            state.ban[j] = 1;
            changed = true;
            break;
          }
        }
      }
    }
    return changed;
  }

  // Proof by contradiction on a single candidate: tentatively place a cat,
  // propagate, and if that leads to an impossibility the cell is ruled out.
  // This is a forced elimination, not a guess -- nothing is committed unless
  // the assumption is disproven.
  // Returns the number of newly ruled-out cells.
  function trialElimination(state, ctx) {
    var changed = 0;
    for (var i = 0; i < ctx.size; i++) {
      if (state.cat[i] || state.ban[i]) continue;
      var clone = cloneState(state);
      var bad = !applyCat(clone, i, ctx) || !propagate(clone, ctx);
      if (bad) {
        state.ban[i] = 1;
        changed++;
      }
    }
    return changed;
  }

  // Solves from an empty board using only the deductions above and reports
  // how much "what-if" reasoning was needed. A low `trials` count means an
  // approachable puzzle; 0 means plain singles/pointing suffice.
  function analyzeLogic(n, regions, solution, fastOnly) {
    var ctx = buildContext(n, regions);
    var state = makeState(ctx.size);
    var stats = {
      ok: false,
      trials: 0,
      rounds: 0,
      catsBeforeTrials: 0,
      bans: 0
    };
    var guard = 0;
    var startedTrials = false;

    while (true) {
      if (++guard > 200) return stats;
      if (!propagate(state, ctx)) return stats;
      if (!startedTrials) {
        stats.catsBeforeTrials = state.placed;
        startedTrials = true;
      }
      if (state.placed === n) break;
      if (fastOnly) return stats;   // large boards are proven by construction
      var eliminated = trialElimination(state, ctx);
      if (eliminated === 0) return stats;
      stats.trials += eliminated;
      stats.rounds++;
    }

    var expected = new Uint8Array(ctx.size);
    for (var r = 0; r < n; r++) expected[r * n + solution[r]] = 1;
    for (var i = 0; i < ctx.size; i++) {
      if (!!state.cat[i] !== !!expected[i]) return stats;
      if (state.ban[i]) stats.bans++;
    }
    stats.ok = true;
    return stats;
  }

  function solveByLogic(n, regions, solution) {
    return analyzeLogic(n, regions, solution).ok;
  }

  // ------------------------------------------------------ region refinement

  function connectedRegion(n, regions, k, skip, seed) {
    var size = n * n;
    var seen = new Uint8Array(size);
    var stack = [seed];
    seen[seed] = 1;
    var reached = 0;
    while (stack.length) {
      var cur = stack.pop();
      reached++;
      var nb = orthogonal(cur, n);
      for (var a = 0; a < nb.length; a++) {
        var j = nb[a];
        if (j === skip || seen[j] || regions[j] !== k) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    var total = 0;
    for (var i = 0; i < size; i++) if (regions[i] === k && i !== skip) total++;
    return reached === total;
  }

  // Random flood-filled regions are usually far too loose: a 9x9 board may
  // admit thousands of valid cat arrangements. Move individual boundary cells
  // between neighbouring regions (keeping both connected and keeping each
  // region's cat) until exactly one solution remains.
  function refineRegions(n, solution, regions, rng, options) {
    options = options || {};
    var cap = options.cap || 60;
    var maxSteps = options.maxSteps || 4000;
    var maxRegionSize = options.maxRegionSize === undefined ? size : options.maxRegionSize;
    var balanceBias = options.balanceBias === undefined ? 0 : options.balanceBias;
    var size = n * n;
    var cats = new Uint8Array(size);
    var seeds = [];
    for (var r = 0; r < n; r++) {
      var cell = r * n + solution[r];
      cats[cell] = 1;
      seeds.push(cell);
    }

    var score = countSolutions(n, regions, cap);
    var steps = 0;
    var result = { score: score, steps: 0 };

    while (score > 1 && steps < maxSteps) {
      steps++;
      var sizes = new Int32Array(n);
      for (var x = 0; x < size; x++) sizes[regions[x]]++;
      var moves = [];
      for (var i = 0; i < size; i++) {
        if (cats[i]) continue;
        var from = regions[i];
        var nb = orthogonal(i, n);
        for (var a = 0; a < nb.length; a++) {
          var to = regions[nb[a]];
          if (to !== from) moves.push([i, from, to]);
        }
      }
      if (!moves.length) break;

      var applied = false;
      for (var tries = 0; tries < 24 && !applied; tries++) {
        var mv = moves[Math.floor(rng() * moves.length)];
        var cell = mv[0];
        var src = mv[1];
        var dst = mv[2];
        // Keep regions from turning into one giant blob, and gently favour
        // moving cells from larger regions into smaller ones.
        if (sizes[dst] + 1 > maxRegionSize) continue;
        if (sizes[dst] >= sizes[src] && rng() < balanceBias) continue;
        if (!connectedRegion(n, regions, src, cell, seeds[src])) continue;
        regions[cell] = dst;
        var next = countSolutions(n, regions, cap);
        if (next <= score || (next < cap && rng() < 0.02)) {
          score = next;
          applied = true;
        } else {
          regions[cell] = src;
        }
      }
    }
    result.score = score;
    result.steps = steps;
    return result;
  }

  // -------------------------------------------------- constructive big boards

  /*
   * Random flood-filled regions need a hill-climbing search to become unique,
   * and that search stops scaling past ~12x12. For big boards we instead BUILD
   * a puzzle around a guaranteed chain of forced moves.
   *
   * Reveal order is rows 0..n-1. Just before cat k is placed, every cell in
   * rows 0..k-1 is banned (those rows already hold cats) and every cell in a
   * column p[0..k-1] is banned (those columns already hold cats). So a cell
   * (r,c) is certainly impossible at step k when r < k or c is a used column.
   *
   * Region k is grown by a randomised BFS from its own cat through exactly
   * those cells. The cat itself is never banned (cats don't share rows,
   * columns, regions or corners), so region k has precisely one legal square
   * left at step k: it is a forced naked single. Repeating gives all n cats,
   * which also proves the solution is unique.
   */
  function constructRegions(n, solution, rng) {
    var size = n * n;
    var region = new Int8Array(size).fill(-1);
    var isCat = new Uint8Array(size);
    var colOwner = new Int32Array(n);   // colOwner[c] = row whose cat sits in column c
    var catCells = [];
    var r, i;

    for (r = 0; r < n; r++) {
      colOwner[solution[r]] = r;
      var idx = r * n + solution[r];
      isCat[idx] = 1;
      catCells.push(idx);
    }
    // A non-cat cell (r,c) is impossible at step k when k > r (its row already
    // has a cat) or k > colOwner[c] (its column already has a cat). So it may
    // join region k only when k > min(r, colOwner[c]).
    var limit = new Int32Array(size);
    for (i = 0; i < size; i++) limit[i] = Math.min((i / n) | 0, colOwner[i % n]);

    var sizes = new Int32Array(n);
    var frontier = [];
    for (var k = 0; k < n; k++) {
      region[catCells[k]] = k;
      sizes[k] = 1;
      frontier.push({ cell: catCells[k], k: k });
    }
    var remaining = size - n;
    var guard = size * 10;

    // Randomised multi-source flood fill: every region stays connected (it only
    // ever grows from one of its own cells) and every claimed cell is chain-safe.
    while (remaining > 0 && guard-- > 0 && frontier.length) {
      var total = 0;
      var weights = new Float64Array(frontier.length);
      for (var f = 0; f < frontier.length; f++) {
        var w = 1 / Math.pow(sizes[frontier[f].k], 1.3);
        weights[f] = w;
        total += w;
      }
      var pick = rng() * total;
      var fi = 0;
      for (; fi < frontier.length - 1; fi++) {
        pick -= weights[fi];
        if (pick <= 0) break;
      }
      var entry = frontier[fi];
      var open = [];
      var nb = orthogonal(entry.cell, n);
      for (var a = 0; a < nb.length; a++) {
        var j = nb[a];
        if (region[j] !== -1 || isCat[j]) continue;
        if (entry.k <= limit[j]) continue;
        open.push(j);
      }
      if (!open.length) {
        frontier.splice(fi, 1);
        continue;
      }
      var chosen = open[Math.floor(rng() * open.length)];
      region[chosen] = entry.k;
      sizes[entry.k]++;
      remaining--;
      frontier.push({ cell: chosen, k: entry.k });
    }

    // Region n-1 may claim any non-cat cell. Let it absorb whatever is left by
    // growing from its own cells, so it stays connected too.
    if (remaining > 0) {
      var queue = [];
      for (i = 0; i < size; i++) if (region[i] === n - 1) queue.push(i);
      for (var head = 0; head < queue.length; head++) {
        var near = orthogonal(queue[head], n);
        for (var b = 0; b < near.length; b++) {
          var q = near[b];
          if (region[q] !== -1 || isCat[q]) continue;
          region[q] = n - 1;
          queue.push(q);
          remaining--;
        }
      }
    }
    // Final fallback: prefer a chain-safe region the cell actually touches so
    // it stays connected; only a fully enclosed cell becomes a tiny island.
    for (i = 0; i < size; i++) {
      if (region[i] !== -1) continue;
      var near2 = orthogonal(i, n);
      var chosenRegion = -1;
      for (var b2 = 0; b2 < near2.length; b2++) {
        var kk = region[near2[b2]];
        if (kk > limit[i] && kk > chosenRegion) chosenRegion = kk;
      }
      region[i] = chosenRegion >= 0 ? chosenRegion : n - 1;
    }
    return region;
  }

  function connectedComponents(n, regions, k) {
    var size = n * n;
    var seen = new Uint8Array(size);
    var comps = [];
    for (var i = 0; i < size; i++) {
      if (regions[i] !== k || seen[i]) continue;
      var comp = [];
      var stack = [i];
      seen[i] = 1;
      while (stack.length) {
        var cur = stack.pop();
        comp.push(cur);
        var nb = orthogonal(cur, n);
        for (var a = 0; a < nb.length; a++) {
          if (!seen[nb[a]] && regions[nb[a]] === k) {
            seen[nb[a]] = 1;
            stack.push(nb[a]);
          }
        }
      }
      comps.push(comp);
    }
    return comps;
  }

  // Region n-1 can own any non-cat cell (everything is banned by step n-1), so
  // re-homing a cell there is always chain-safe. Use that to stitch every
  // island back to a region's main body along a short path.
  function repairRegions(n, regions, solution) {
    var size = n * n;
    var last = n - 1;
    var catLast = last * n + solution[last];
    var pass, i, k, x, c, y;

    for (pass = 0; pass < 24; pass++) {
      var comps = connectedComponents(n, regions, last);
      var main = comps[0];
      for (c = 0; c < comps.length; c++) {
        if (comps[c].indexOf(catLast) >= 0) main = comps[c];
      }
      var mainSet = new Uint8Array(size);
      for (x = 0; x < main.length; x++) mainSet[main[x]] = 1;

      // BFS over the whole grid from region n-1's main body, with parents.
      var parent = new Int32Array(size).fill(-1);
      var queue = [];
      for (x = 0; x < main.length; x++) {
        parent[main[x]] = main[x];
        queue.push(main[x]);
      }
      for (var head = 0; head < queue.length; head++) {
        var nb = orthogonal(queue[head], n);
        for (var a = 0; a < nb.length; a++) {
          if (parent[nb[a]] === -1) {
            parent[nb[a]] = queue[head];
            queue.push(nb[a]);
          }
        }
      }

      var changed = false;
      // Re-home stray n-1 cells and the path leading back to the main body.
      for (i = 0; i < size; i++) {
        if (regions[i] !== last || mainSet[i]) continue;
        var j = i;
        while (!mainSet[j]) {
          regions[j] = last;
          changed = true;
          j = parent[j];
        }
      }
      // Islands of any other region join n-1 (always chain-safe); the next
      // pass stitches those in too.
      for (k = 0; k < last; k++) {
        var cs = connectedComponents(n, regions, k);
        if (cs.length <= 1) continue;
        var biggest = cs[0];
        for (c = 1; c < cs.length; c++) if (cs[c].length > biggest.length) biggest = cs[c];
        for (c = 0; c < cs.length; c++) {
          if (cs[c] === biggest) continue;
          for (y = 0; y < cs[c].length; y++) {
            regions[cs[c][y]] = last;
            changed = true;
          }
        }
      }
      if (!changed) break;
    }
  }

  function allConnected(n, regions) {
    for (var k = 0; k < n; k++) {
      if (connectedComponents(n, regions, k).length !== 1) return false;
    }
    return true;
  }

  // Direct O(n^2) proof that every non-cat cell of region k is impossible at
  // step k. That forces each cat in turn, which proves a unique solution
  // without the (very slow at this size) exhaustive solver.
  function verifyChain(n, regions, solution) {
    var colOwner = new Int32Array(n);
    var perRegion = new Int32Array(n);
    var r, i;
    for (r = 0; r < n; r++) {
      colOwner[solution[r]] = r;
      perRegion[regions[r * n + solution[r]]]++;
    }
    for (r = 0; r < n; r++) {
      if (perRegion[r] !== 1) return false;
      var catCell = r * n + solution[r];
      if (regions[catCell] !== r) return false;
    }
    for (i = 0; i < n * n; i++) {
      if (i === ((i / n) | 0) * n + solution[(i / n) | 0]) continue; // a cat cell
      var k = regions[i];
      var row = (i / n) | 0;
      var c = i % n;
      if (!(k > row || k > colOwner[c])) return false;
    }
    return true;
  }

  function generateLarge(n, options) {
    options = options || {};
    var rng = options.rng || Math.random;
    var attempts = options.maxAttempts || 12;
    var deadline = Date.now() + (options.timeBudgetMs || 8000);

    for (var a = 1; a <= attempts; a++) {
      if (Date.now() > deadline) break;
      var solution = randomSolution(n, rng);
      if (!solution) continue;
      var regions = constructRegions(n, solution, rng);
      repairRegions(n, regions, solution);
      if (!allConnected(n, regions)) continue;
      if (!validRegions(n, regions, solution)) continue;
      if (!verifyChain(n, regions, solution)) continue;
      var stats = analyzeLogic(n, regions, solution, true);
      if (!stats.ok) continue;
      return {
        n: n,
        regions: Array.from(regions),
        solution: solution.slice(),
        attempts: a,
        stats: stats,
        constructed: true
      };
    }
    return null;
  }

  // ------------------------------------------------------------- generation

  /**
   * Generate a puzzle of size n with a unique, deductively solvable answer.
   * Returns { n, regions, solution, attempts, stats } or null if nothing
   * suitable was found within the budget.
   *
   * options:
   *   rng            - random source (default Math.random)
   *   quality        - sample this many valid puzzles, keep the easiest (1..8)
   *   maxTrials      - reject puzzles needing more "what-if" eliminations
   *   timeBudgetMs   - hard stop for the search
   */
  function generate(n, options) {
    options = options || {};
    // The search-based generator is tuned for the small boards; beyond 10x10
    // it becomes impractical, so switch to the constructive chain builder.
    if (n > 10 && !options.forceSearch) return generateLarge(n, options);
    var rng = options.rng || Math.random;
    var maxAttempts = options.maxAttempts || 40;
    var timeBudget = options.timeBudgetMs || 8000;
    var quality = Math.max(1, Math.min(8, options.quality || 3));
    var maxTrials = options.maxTrials === undefined ? Infinity : options.maxTrials;
    var deadline = Date.now() + timeBudget;
    var best = null;
    var found = 0;

    for (var attempt = 1; attempt <= maxAttempts; attempt++) {
      if (Date.now() > deadline) break;
      var solution = randomSolution(n, rng);
      if (!solution) continue;
      var bMin = options.balanceMin === undefined ? 0.8 : options.balanceMin;
      var bMax = options.balanceMax === undefined ? 2.6 : options.balanceMax;
      var balance = bMin + rng() * (bMax - bMin);
      var regions = growRegions(n, solution, rng, balance);
      if (!regions) continue;
      if (!validRegions(n, regions, solution)) continue;
      if (refineRegions(n, solution, regions, rng, options).score !== 1) continue;
      if (!validRegions(n, regions, solution)) continue;
      if (countSolutions(n, regions, 2) !== 1) continue;

      var stats = analyzeLogic(n, regions, solution);
      if (!stats.ok || stats.trials > maxTrials) continue;

      var puzzle = {
        n: n,
        regions: Array.from(regions),
        solution: solution.slice(),
        attempts: attempt,
        stats: stats
      };
      found++;
      // A board solved purely by singles/pointing is the gentlest kind.
      if (stats.rounds === 0) return puzzle;
      if (!best || stats.rounds < best.stats.rounds ||
          (stats.rounds === best.stats.rounds && stats.trials < best.stats.trials)) {
        best = puzzle;
      }
      if (found >= quality) break;
    }
    return best;
  }

  // Sanity check: N connected regions, each holding exactly one cat.
  function validRegions(n, regions, solution) {
    var seen = new Uint8Array(n);
    for (var i = 0; i < regions.length; i++) {
      if (regions[i] < 0 || regions[i] >= n) return false;
      seen[regions[i]] = 1;
    }
    for (var k = 0; k < n; k++) if (!seen[k]) return false;
    var per = new Int32Array(n);
    for (var r = 0; r < n; r++) per[regions[r * n + solution[r]]]++;
    for (var q = 0; q < n; q++) if (per[q] !== 1) return false;
    return true;
  }

  function solutionCells(puzzle) {
    return puzzle.solution.map(function (c, r) { return r * puzzle.n + c; });
  }

  return {
    generate: generate,
    generateLarge: generateLarge,
    countSolutions: countSolutions,
    solveByLogic: solveByLogic,
    analyzeLogic: analyzeLogic,
    constructRegions: constructRegions,
    refineRegions: refineRegions,
    solutionCells: solutionCells,
    mulberry32: mulberry32,
    _internals: {
      randomSolution: randomSolution,
      growRegions: growRegions,
      buildContext: buildContext,
      propagate: propagate,
      makeState: makeState,
      applyCat: applyCat,
      connectedRegion: connectedRegion
    }
  };
});
