/* Mewdoku — UI, input and game state. */
(function () {
  'use strict';

  var CAT_SVG =
    '<svg class="cat-svg" viewBox="0 0 64 64" aria-hidden="true">' +
      '<path class="cat-fill" d="M9 25 L11 7 L25 16 Q32 13 39 16 L53 7 L55 25 Q60 34 56 44 Q51 57 32 57 Q13 57 8 44 Q4 34 9 25 Z"/>' +
      '<path class="cat-ear-inner" d="M15 23 L16 13 L23 19 Z"/>' +
      '<path class="cat-ear-inner" d="M49 23 L48 13 L41 19 Z"/>' +
      '<ellipse class="cat-eye" cx="23" cy="33" rx="3.3" ry="4.4"/>' +
      '<ellipse class="cat-eye" cx="41" cy="33" rx="3.3" ry="4.4"/>' +
      '<path class="cat-nose" d="M29 41 Q32 44.5 35 41 Q32 39 29 41 Z"/>' +
      '<path class="cat-line" d="M32 44 Q29 48 26 45 M32 44 Q35 48 38 45"/>' +
      '<path class="cat-line" d="M20 41 L7 38 M20 44 L8 47 M44 41 L57 38 M44 44 L56 47"/>' +
    '</svg>';

  var X_SVG =
    '<svg class="x-svg" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M6 6 L18 18"/><path d="M18 6 L6 18"/>' +
    '</svg>';

  var MAX_HEARTS = 3;
  var EMPTY = 0, MARK = 1, CAT = 2;

  var board = document.getElementById('board');
  var boardWrap = document.querySelector('.board-wrap');
  var boardScroll = document.getElementById('boardScroll');
  var boardStage = document.querySelector('.board-stage');
  var regionLines = document.getElementById('regionLines');
  var overlay = document.getElementById('overlay');
  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var toastEl = document.getElementById('toast');
  var heartsEl = document.getElementById('hearts');
  var catCountEl = document.getElementById('catCount');
  var timerEl = document.getElementById('timer');
  var bestEl = document.getElementById('best');
  var difficultyEl = document.getElementById('difficulty');
  var toolXBtn = document.getElementById('toolX');
  var toolCatBtn = document.getElementById('toolCat');
  var toolPanBtn = document.getElementById('toolPan');
  var autoMarkBtn = document.getElementById('autoMark');
  var newPuzzleBtn = document.getElementById('newPuzzle');
  var rulesBtn = document.getElementById('rulesBtn');
  var Progression = MewdokuProgression;
  var profile = { xp: 0, tier: 0, size: 5 };
  var playerLevelEl = document.getElementById('playerLevel');
  var playerXPEl = document.getElementById('playerXP');
  var xpProgressEl = document.getElementById('xpProgress');
  var challengeInfoEl = document.getElementById('challengeInfo');

  var state = {
    size: 5,
    puzzle: null,
    solutionSet: null,
    cells: [],
    catsPlaced: 0,
    hearts: MAX_HEARTS,
    tool: 'x',
    autoMarkEnabled: false,
    autoMarks: new Set(),
    finished: true,
    lastTap: null,
    drag: null,
    palette: [],
    colors: [],
    startTime: null,
    elapsed: 0,
    running: false,
    paused: false,
    pauseStart: 0,
    timerId: null,
    pendingSeed: 0,
    challengeTier: 0,
    retryElapsed: 0,
    showRulesOnStart: false
  };

  var worker = null;
  var generationId = 0;
  var toastTimer = null;
  var touches = new Map();
  var gesture = null;
  var boardZoom = 1;

  // ------------------------------------------------------------- storage

  function storeGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function storeSet(key, value) {
    try { localStorage.setItem(key, value); return true; } catch (e) { return false; }
  }
  function saveProfile() {
    if (!storeSet('mewdoku.progress', JSON.stringify(profile))) {
      console.warn('Mewdoku: progress could not be saved to local storage.');
      toast('Progress is only available this session: storage is unavailable.');
    }
  }
  function loadProfile() {
    var raw = storeGet('mewdoku.progress');
    if (raw === null) return;
    var saved;
    try { saved = JSON.parse(raw); } catch (err) {
      if (!(err instanceof SyntaxError)) throw err;
      console.warn('Mewdoku: saved progress is not valid JSON.', err);
      toast('Saved progress could not be read. Starting fresh.');
      return;
    }
    if (Progression.valid(saved)) profile = { xp: saved.xp, tier: saved.tier, size: saved.size };
    else {
      console.warn('Mewdoku: saved progress has invalid values.');
      toast('Saved progress could not be read. Starting fresh.');
    }
  }
  function bestKey(n) { return 'mewdoku.best.' + n; }
  function getBest(n) {
    var v = Number(storeGet(bestKey(n)));
    return v > 0 ? v : null;
  }
  function saveBest(n, ms) {
    var prev = getBest(n);
    if (prev === null || ms < prev) {
      storeSet(bestKey(n), String(ms));
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------- utilities

  function formatTime(ms) {
    var total = Math.floor(ms / 1000);
    var m = Math.floor(total / 60);
    var s = total % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function canInteract() {
    return !!state.puzzle && !state.finished && overlay.hidden;
  }

  function toast(message) {
    toastEl.textContent = message;
    toastEl.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('is-visible'); }, 1900);
  }

  // Web Animations are used for the one-shot effects so they never clash with
  // the CSS keyframes attached to cells (error shake, cat pop, etc.).
  function waapi(el, frames, options) {
    if (reduceMotion || !el || typeof el.animate !== 'function') return;
    try { el.animate(frames, options); } catch (err) { /* older engines */ }
  }

  function bump(el) {
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }

  function restartAnimation(el, className, ms) {
    el.classList.remove(className);
    void el.offsetWidth;
    el.classList.add(className);
    setTimeout(function () { el.classList.remove(className); }, ms);
  }

  // A short shower of warm sparkles where a cat has just landed.
  function burst(el) {
    if (reduceMotion || !el) return;
    var wrap = document.createElement('span');
    wrap.className = 'burst';
    for (var k = 0; k < 7; k++) {
      var s = document.createElement('i');
      var angle = (Math.PI * 2 * k) / 7 + (Math.random() - .5) * .5;
      var dist = 20 + Math.random() * 18;
      s.style.setProperty('--dx', (Math.cos(angle) * dist).toFixed(1) + 'px');
      s.style.setProperty('--dy', (Math.sin(angle) * dist).toFixed(1) + 'px');
      s.style.setProperty('--rot', Math.round(Math.random() * 180 - 90) + 'deg');
      s.style.animationDelay = Math.round(Math.random() * 60) + 'ms';
      if (k % 3 === 0) s.className = 'star';
      wrap.appendChild(s);
    }
    el.appendChild(wrap);
    setTimeout(function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }, 900);
  }

  // New boards arrive as a diagonal wave of cells.
  function animateReveal(n) {
    if (reduceMotion) return;
    var step = n > 8 ? 16 : 26;
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        waapi(board.children[r * n + c], [
          { opacity: 0, transform: 'scale(.88) translateY(6px)' },
          { opacity: 1, transform: 'none' }
        ], {
          duration: 430,
          delay: (r + c) * step,
          easing: 'cubic-bezier(.2, .9, .3, 1.25)',
          fill: 'backwards'
        });
      }
    }
  }

  // A soft light wave travelling out along the row, column and neighbours of
  // a newly placed cat — a visual echo of the rules, not a board change.
  function pulseFrom(i) {
    if (reduceMotion || !state.puzzle) return;
    var n = state.puzzle.n;
    var r0 = (i / n) | 0;
    var c0 = i % n;
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        var j = r * n + c;
        if (j === i) continue;
        var affected = r === r0 || c === c0 ||
          (Math.abs(r - r0) <= 1 && Math.abs(c - c0) <= 1);
        if (!affected) continue;
        var dist = Math.max(Math.abs(r - r0), Math.abs(c - c0));
        waapi(board.children[j], [
          { filter: 'brightness(1)' },
          { filter: 'brightness(1.32)' },
          { filter: 'brightness(1)' }
        ], { duration: 460, delay: dist * 34, easing: 'ease-out' });
      }
    }
  }

  // ---------------------------------------------------------- auto-marking

  // Every square that a cat at index i proves impossible: the rest of its row,
  // column and region, plus all eight neighbours. Distances are used to stagger
  // the ✕ marks so they draw outward like a ripple from the nearest cat.
  function consequenceCells(i) {
    var p = state.puzzle;
    var n = p.n;
    var r0 = (i / n) | 0;
    var c0 = i % n;
    var reg = p.regions[i];
    var out = [];
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        var j = r * n + c;
        if (j === i) continue;
        if (r === r0 || c === c0 || p.regions[j] === reg ||
            (Math.abs(r - r0) <= 1 && Math.abs(c - c0) <= 1)) {
          out.push({ index: j, dist: Math.max(Math.abs(r - r0), Math.abs(c - c0)) });
        }
      }
    }
    return out;
  }

  // Rebuild the auto-✕ layer from the *current* set of cats. This keeps marks
  // correct when a cat is removed and never touches ✕ marks the player drew.
  function recomputeAutoMarks() {
    if (!state.autoMarkEnabled || !state.puzzle) return;
    var desired = new Map();
    for (var i = 0; i < state.cells.length; i++) {
      if (state.cells[i] !== CAT) continue;
      var cons = consequenceCells(i);
      for (var k = 0; k < cons.length; k++) {
        var d = cons[k].dist;
        if (!desired.has(cons[k].index) || d < desired.get(cons[k].index)) {
          desired.set(cons[k].index, d);
        }
      }
    }

    state.autoMarks.forEach(function (j) {
      if (!desired.has(j) && state.cells[j] === MARK) setCellState(j, EMPTY);
    });
    state.autoMarks.clear();

    desired.forEach(function (dist, j) {
      if (state.cells[j] !== EMPTY) return;
      setCellState(j, MARK);
      state.autoMarks.add(j);
      var el = board.children[j];
      if (el && !reduceMotion) {
        var delay = Math.min(dist, 6) * 26;
        var paths = el.querySelectorAll('.x-svg path');
        for (var q = 0; q < paths.length; q++) {
          paths[q].style.animationDelay = (delay + q * 70) + 'ms';
        }
      }
    });
  }

  function renderAutoMarkToggle() {
    autoMarkBtn.setAttribute('aria-pressed', String(state.autoMarkEnabled));
  }

  // ------------------------------------------------------------- colours

  function buildPalette(n, seed) {
    var count = Math.max(n + 4, 14);
    var offset = seed % 360;
    var palette = [];
    for (var i = 0; i < count; i++) {
      var h = Math.round((offset + i * 137.508) % 360);
      var s = 54 + (i % 3) * 7;
      var l = 86 + (i % 2) * 3;
      palette.push('hsl(' + h + ' ' + s + '% ' + l + '%)');
    }
    return palette;
  }

  // Greedy graph colouring so neighbouring regions never share a hue.
  function assignColors(n, regions, palette) {
    var adj = [];
    for (var i = 0; i < n; i++) adj.push(new Set());
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        var k = regions[r * n + c];
        if (r + 1 < n) {
          var kd = regions[(r + 1) * n + c];
          if (kd !== k) { adj[k].add(kd); adj[kd].add(k); }
        }
        if (c + 1 < n) {
          var kr = regions[r * n + c + 1];
          if (kr !== k) { adj[k].add(kr); adj[kr].add(k); }
        }
      }
    }
    var order = Array.from({ length: n }, function (_, i) { return i; });
    order.sort(function (a, b) { return adj[b].size - adj[a].size; });

    var color = new Array(n).fill(-1);
    var colored = new Uint8Array(n);
    var used = new Uint8Array(palette.length);

    for (var o = 0; o < order.length; o++) {
      var region = order[o];
      var forbidden = new Set();
      adj[region].forEach(function (j) { if (colored[j]) forbidden.add(color[j]); });
      var pick = -1;
      for (var p = 0; p < palette.length; p++) {
        if (!forbidden.has(p) && !used[p]) { pick = p; break; }
      }
      if (pick < 0) {
        for (var q = 0; q < palette.length; q++) {
          if (!forbidden.has(q)) { pick = q; break; }
        }
      }
      if (pick < 0) pick = 0;
      color[region] = pick;
      colored[region] = 1;
      used[pick] = 1;
    }
    return color;
  }

  // ------------------------------------------------------------- rendering

  function setAria(el, r, c, value) {
    var detail = value === CAT ? ', has a cat' : value === MARK ? ', marked empty' : '';
    el.setAttribute('aria-label', 'Row ' + (r + 1) + ', column ' + (c + 1) + detail);
  }

  function setCellState(i, value, animate) {
    state.cells[i] = value;
    var el = board.children[i];
    if (!el) return;
    el.innerHTML = value === CAT ? CAT_SVG : value === MARK ? X_SVG : '';
    el.classList.toggle('has-cat', value === CAT);
    el.classList.toggle('has-x', value === MARK);
    if (animate && value === CAT) {
      el.classList.remove('pop');
      void el.offsetWidth;
      el.classList.add('pop');
      burst(el);
    }
    var n = state.puzzle.n;
    setAria(el, (i / n) | 0, i % n, value);
  }

  function renderBoard() {
    var p = state.puzzle;
    var n = p.n;
    boardWrap.style.setProperty('--n', n);
    boardZoom = 1;
    updateBoardSize();
    boardScroll.scrollLeft = 0;
    boardScroll.scrollTop = 0;
    board.innerHTML = '';
    var frag = document.createDocumentFragment();
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        var i = r * n + c;
        var el = document.createElement('div');
        el.className = 'cell';
        el.dataset.i = String(i);
        el.setAttribute('role', 'gridcell');
        el.setAttribute('tabindex', '0');
        el.style.backgroundColor = state.palette[state.colors[p.regions[i]]];
        setAria(el, r, c, EMPTY);
        frag.appendChild(el);
      }
    }
    board.appendChild(frag);
    renderRegionLines(p);
    updatePanButton();
    if (n <= 12) animateReveal(n);
  }

  // The pan control only appears when the stage is actually bigger than the
  // scroll window, and it is never left active on a board that fits.
  function updatePanButton() {
    var scrollable = boardScroll.scrollWidth > boardScroll.clientWidth + 1 ||
                     boardScroll.scrollHeight > boardScroll.clientHeight + 1;
    toolPanBtn.hidden = !scrollable;
    if (!scrollable && state.tool === 'pan') setTool('x');
  }

  function updateBoardSize() {
    var rect = boardScroll.getBoundingClientRect();
    // Scrollbars must not change the zoom baseline as the board grows/shrinks.
    var viewport = Math.floor(Math.min(rect.width, rect.height));
    var base = state.size > 10 ? Math.max(viewport, state.size * 30) : viewport;
    boardZoom = state.size > 10 ? Math.max(viewport / base, Math.min(3, boardZoom)) : 1;
    var side = base * boardZoom;
    boardStage.style.width = side + 'px';
    boardStage.style.height = side + 'px';
    updatePanButton();
    return side;
  }

  // Region outlines are drawn as one SVG path: crisp, seamless corners, and
  // they scale cleanly with the board instead of relying on per-cell borders.
  function renderRegionLines(p) {
    var n = p.n;
    var segments = [];
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        var k = p.regions[r * n + c];
        if (c + 1 < n && p.regions[r * n + c + 1] !== k) {
          segments.push('M' + (c + 1) + ' ' + r + 'V' + (r + 1));
        }
        if (r + 1 < n && p.regions[(r + 1) * n + c] !== k) {
          segments.push('M' + c + ' ' + (r + 1) + 'H' + (c + 1));
        }
      }
    }
    // A hairline grid between every square, with the thicker region outlines
    // drawn on top so both layers stay legible.
    var grid = [];
    for (var g = 1; g < n; g++) {
      grid.push('M' + g + ' 0V' + n);
      grid.push('M0 ' + g + 'H' + n);
    }
    regionLines.setAttribute('viewBox', '0 0 ' + n + ' ' + n);
    regionLines.innerHTML =
      '<path class="cell-grid" d="' + grid.join(' ') + '" vector-effect="non-scaling-stroke"/>' +
      '<path class="region-edges" d="' + segments.join(' ') + '" vector-effect="non-scaling-stroke"/>';
  }

  function renderAllCells() {
    for (var i = 0; i < state.cells.length; i++) setCellState(i, state.cells[i]);
  }

  function renderHearts(pop) {
    heartsEl.innerHTML = '';
    for (var i = 0; i < MAX_HEARTS; i++) {
      var s = document.createElement('span');
      s.className = 'heart' + (i < state.hearts ? '' : ' is-lost');
      if (pop && i === state.hearts) s.classList.add('is-popping');
      s.textContent = '♥';
      heartsEl.appendChild(s);
    }
  }

  function renderCatCount() {
    var n = state.puzzle ? state.puzzle.n : state.size;
    catCountEl.textContent = state.catsPlaced + ' / ' + n;
  }

  function renderTimer() { timerEl.textContent = formatTime(state.elapsed); }

  function renderBest() {
    var best = getBest(state.size);
    bestEl.textContent = best === null ? '—' : formatTime(best);
  }

  function renderProgression() {
    var xp = profile.xp % Progression.xpPerLevel;
    playerLevelEl.textContent = 'Level ' + Progression.level(profile.xp);
    playerXPEl.textContent = xp + ' / ' + Progression.xpPerLevel + ' XP';
    xpProgressEl.value = xp;
    challengeInfoEl.textContent = Progression.tiers[state.challengeTier] +
      ' · adaptive difficulty · quick: ' +
      formatTime(Progression.targetTime(state.size, state.challengeTier) * .75);
  }

  // --------------------------------------------------------------- timer

  function startTimer() {
    if (state.running || state.finished) return;
    state.startTime = Date.now();
    state.elapsed = 0;
    state.paused = false;
    state.running = true;
    timerEl.classList.add('is-running');
    clearInterval(state.timerId);
    state.timerId = setInterval(function () {
      if (state.paused) return;
      state.elapsed = Date.now() - state.startTime;
      renderTimer();
    }, 200);
  }
  function ensureTimer() {
    if (!state.running && state.startTime === null) startTimer();
  }
  function pauseTimer() {
    if (state.running && !state.paused) { state.paused = true; state.pauseStart = Date.now(); }
  }
  function resumeTimer() {
    if (state.running && state.paused && !document.hidden && overlay.hidden) {
      state.startTime += Date.now() - state.pauseStart;
      state.paused = false;
    }
  }
  function stopTimer() {
    if (state.running) state.elapsed = (state.paused ? state.pauseStart : Date.now()) - state.startTime;
    state.running = false;
    state.paused = false;
    timerEl.classList.remove('is-running');
    clearInterval(state.timerId);
    renderTimer();
  }
  function resetTimer() {
    clearInterval(state.timerId);
    state.running = false;
    state.paused = false;
    state.startTime = null;
    state.elapsed = 0;
    timerEl.classList.remove('is-running');
    renderTimer();
  }

  // ------------------------------------------------------------- overlays

  function overlayHTML(kind, data) {
    data = data || {};
    if (kind === 'loading') {
      return '<div class="overlay-card"><div class="spinner-cat">🐱</div>' +
        '<div class="paw-trail" aria-hidden="true"><span>🐾</span><span>🐾</span><span>🐾</span></div>' +
        '<p class="loading-text">Finding a purr-fect puzzle<span class="loading-dots"></span></p></div>';
    }
    if (kind === 'win') {
      return '<div class="overlay-card"><div class="cat-parade" aria-hidden="true"><span>🐱</span><span>🐱</span><span>🐱</span></div>' +
        '<h2>Purr-fect!</h2>' +
        '<p>All ' + data.n + ' cats have their own cosy territory.</p>' +
        '<div class="result-time">' + formatTime(data.time) + '</div>' +
        '<div class="result-best">' + (data.isNewBest ? '<strong>✨ New best time!</strong>' : 'Best ' + formatTime(data.best)) + '</div>' +
        '<div class="result-progress"><strong>+' + data.reward.earned + ' XP' +
        (data.reward.pace === 'fast' ? ' · Quick-paw bonus!' : '') + '</strong>' +
        '<p>' + (data.reward.leveledUp ? 'Level up! ' : '') + 'Level ' + Progression.level(profile.xp) +
        ' · ' + (profile.xp % Progression.xpPerLevel) + ' / ' + Progression.xpPerLevel + ' XP</p>' +
        '<p>' + (data.reward.pace === 'slow' ? 'A gentler pace next time. ' : '') +
        'Next: ' + Progression.tiers[profile.tier] + ' · ' + profile.size + '×' + profile.size + '</p></div>' +
        '<div class="overlay-actions"><button type="button" class="btn btn--accent" data-action="new">Next puzzle</button></div>' +
        '</div>';
    }
    if (kind === 'lose') {
      return '<div class="overlay-card"><div class="overlay-emoji">😿</div>' +
        '<h2>Out of hearts</h2>' +
        '<p>Cross out impossible squares first — every cat can be found by logic alone, no guessing needed.</p>' +
        '<div class="overlay-actions">' +
        '<button type="button" class="btn btn--accent" data-action="retry">Try again</button>' +
        '<button type="button" class="btn btn--ghost" data-action="new">New puzzle</button>' +
        '</div></div>';
    }
    if (kind === 'error') {
      return '<div class="overlay-card"><div class="overlay-emoji">🙀</div>' +
        '<h2>Couldn\'t build a puzzle</h2>' +
        '<p>Something went wrong while arranging the cats. Give it another go.</p>' +
        '<div class="overlay-actions"><button type="button" class="btn btn--accent" data-action="new">Try again</button></div>' +
        '</div>';
    }
    if (kind === 'rules') {
      return '<div class="overlay-card"><div class="overlay-emoji">🐾</div>' +
        '<h2>How to play</h2>' +
        '<ul class="rules-list">' +
        '<li><span class="num">1</span><span>Place <strong>one cat in every coloured region</strong>.</span></li>' +
        '<li><span class="num">2</span><span>Each <strong>row</strong> and each <strong>column</strong> gets exactly one cat.</span></li>' +
        '<li><span class="num">3</span><span>Cats need personal space: <strong>no touching</strong>, not even diagonally.</span></li>' +
        '<li><span class="num">4</span><span>Tap for ✕, drag to paint ✕ marks, double-tap (or pick the 🐱 tool) to place a cat. A wrong cat costs a heart.</span></li>' +
        '</ul>' +
        '<p class="rules-note">Optional: switch on <strong>✕ Auto</strong> below the board to have impossible squares crossed out for you whenever a cat lands.</p>' +
        '<p class="rules-note">Every win earns XP: 40 for a quick solve, 25 for a steady solve, 20 for a slow solve. Every 100 XP earns a level. Quick wins raise logic complexity, then board size; slow wins ease the challenge. You can still choose any size.</p>' +
        '<p class="rules-note">Big boards: use two fingers to move and pinch to zoom, without changing tools. The ✋ Pan button also lets you drag with one finger or a mouse.</p>' +
        '<div class="overlay-actions"><button type="button" class="btn btn--accent" data-action="close">Got it</button></div>' +
        '</div>';
    }
    return '';
  }

  function addConfetti(container) {
    if (reduceMotion) return;
    var wrap = document.createElement('div');
    wrap.className = 'confetti';
    var glyphs = ['🐾', '💛', '✨', '🐱', '🧡', '🐟', '🤍', '⭐'];
    for (var i = 0; i < 26; i++) {
      var s = document.createElement('span');
      s.textContent = glyphs[i % glyphs.length];
      s.style.left = (2 + Math.random() * 94) + '%';
      s.style.animationDuration = (2 + Math.random() * 2.2) + 's';
      s.style.animationDelay = (Math.random() * 1.1) + 's';
      s.style.fontSize = (13 + Math.random() * 16) + 'px';
      s.style.setProperty('--spin', Math.round(180 + Math.random() * 540) + 'deg');
      wrap.appendChild(s);
    }
    container.appendChild(wrap);
  }

  function showOverlay(kind, data) {
    resetPointerInput();
    overlay.hidden = false;
    overlay.dataset.kind = kind;
    overlay.innerHTML = overlayHTML(kind, data);
    if (kind === 'win') addConfetti(overlay);
  }
  function hideOverlay() {
    overlay.hidden = true;
    overlay.dataset.kind = '';
    overlay.innerHTML = '';
  }

  // ------------------------------------------------------------- game logic

  function toggleX(i) {
    if (!canInteract()) return;
    if (state.cells[i] === CAT) return;
    ensureTimer();
    setCellState(i, state.cells[i] === MARK ? EMPTY : MARK);
    state.autoMarks.delete(i);   // a hand-edited ✕ is now the player's own
  }

  function removeCat(i) {
    if (!canInteract()) return;
    if (state.cells[i] !== CAT) return;
    setCellState(i, EMPTY);
    state.catsPlaced--;
    renderCatCount();
    recomputeAutoMarks();
  }

  function localConflict(i) {
    var n = state.puzzle.n;
    var r = (i / n) | 0;
    var c = i % n;
    var reg = state.puzzle.regions[i];
    for (var j = 0; j < state.cells.length; j++) {
      if (state.cells[j] !== CAT) continue;
      var r2 = (j / n) | 0;
      var c2 = j % n;
      if (r2 === r || c2 === c || state.puzzle.regions[j] === reg) return true;
      if (Math.abs(r2 - r) <= 1 && Math.abs(c2 - c) <= 1) return true;
    }
    return false;
  }

  function loseHeart(i) {
    var conflict = localConflict(i);
    state.hearts--;
    renderHearts(true);
    var el = board.children[i];
    if (el) restartAnimation(el, 'is-error', 650);
    restartAnimation(boardWrap, 'is-shaking', 500);
    toast(conflict ? 'Too close! Cats need their personal space.' : 'Not quite — that spot leads to a dead end.');
    if (state.hearts <= 0) {
      stopTimer();
      state.retryElapsed += state.elapsed;
      state.finished = true;
      showOverlay('lose');
    }
  }

  function placeCat(i) {
    if (!canInteract()) return;
    if (state.cells[i] === CAT) return;
    ensureTimer();
    if (!state.solutionSet.has(i)) {
      loseHeart(i);
      return;
    }
    setCellState(i, CAT, true);
    state.catsPlaced++;
    renderCatCount();
    bump(catCountEl);
    if (state.autoMarkEnabled) recomputeAutoMarks();
    else pulseFrom(i);
    checkWin();
  }

  function toggleCat(i) {
    if (!canInteract()) return;
    if (state.cells[i] === CAT) removeCat(i);
    else placeCat(i);
  }

  function checkWin() {
    if (state.finished) return;
    if (state.catsPlaced !== state.puzzle.n) return;
    for (var i = 0; i < state.cells.length; i++) {
      if ((state.cells[i] === CAT) !== state.solutionSet.has(i)) return;
    }
    stopTimer();
    state.finished = true;
    boardWrap.classList.add('is-won');
    bump(bestEl);
    var isNew = saveBest(state.size, state.elapsed);
    var reward = Progression.complete({
      xp: profile.xp, tier: state.challengeTier, size: state.puzzle.n
    }, state.retryElapsed + state.elapsed);
    profile = reward.profile;
    saveProfile();
    renderProgression();
    renderBest();
    showOverlay('win', {
      n: state.puzzle.n,
      time: state.elapsed,
      best: getBest(state.size),
      isNewBest: isNew,
      reward: reward
    });
  }

  function singleTap(i) {
    if (!canInteract()) return;
    if (state.cells[i] === CAT) { removeCat(i); return; }
    if (state.tool === 'cat') placeCat(i);
    else toggleX(i);
  }

  function handleTap(i) {
    if (!canInteract()) return;
    if (state.tool === 'pan') return;   // pan mode is view-only
    // With the cat tool every tap is already a complete action.
    if (state.tool === 'cat') { state.lastTap = null; singleTap(i); return; }

    var now = Date.now();
    var lt = state.lastTap;
    if (lt && lt.i === i && now - lt.t < 320) {
      state.lastTap = null;
      if (lt.prev === CAT) return;       // the first tap already removed that cat
      setCellState(i, lt.prev);          // undo the provisional ✕ from tap one
      placeCat(i);
      return;
    }
    state.lastTap = { i: i, t: now, prev: state.cells[i] };
    singleTap(i);
  }

  // ------------------------------------------------------------- pointer input

  function cellFromPoint(x, y) {
    var el = document.elementFromPoint(x, y);
    return el && el.closest ? el.closest('.cell') : null;
  }

  function paintDrag(i) {
    if (!canInteract()) return;
    if (state.cells[i] === CAT) return;
    var value = state.drag.paintValue;
    if (state.cells[i] === value) return;
    ensureTimer();
    setCellState(i, value);
    state.autoMarks.delete(i);   // a hand-edited ✕ is now the player's own
  }

  function resetPointerInput() {
    state.drag = null;
    state.lastTap = null;
    gesture = null;
    touches.forEach(function (point, id) {
      if (boardScroll.hasPointerCapture(id)) boardScroll.releasePointerCapture(id);
    });
    touches.clear();
  }

  function touchPair() {
    var points = Array.from(touches.values());
    return {
      x: (points[0].x + points[1].x) / 2,
      y: (points[0].y + points[1].y) / 2,
      distance: Math.max(1, Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y))
    };
  }

  function beginGesture() {
    var pair = touchPair();
    var rect = boardScroll.getBoundingClientRect();
    gesture = {
      distance: pair.distance,
      zoom: boardZoom,
      side: boardStage.offsetWidth,
      x: boardScroll.scrollLeft + pair.x - rect.left,
      y: boardScroll.scrollTop + pair.y - rect.top
    };
    state.drag = null;
    state.lastTap = null;
  }

  function moveGesture() {
    if (touches.size < 2) return;
    var pair = touchPair();
    var rect = boardScroll.getBoundingClientRect();
    boardZoom = gesture.zoom * pair.distance / gesture.distance;
    var side = updateBoardSize();
    boardScroll.scrollLeft = gesture.x * side / gesture.side - (pair.x - rect.left);
    boardScroll.scrollTop = gesture.y * side / gesture.side - (pair.y - rect.top);
  }

  function onPointerDown(e) {
    if (!canInteract()) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      boardScroll.setPointerCapture(e.pointerId);
      if (state.size > 10 && touches.size >= 2) {
        e.preventDefault();
        beginGesture();
        return;
      }
      if (gesture || touches.size > 1) return;
    }
    if (state.drag) return;
    var cell = e.target.closest ? e.target.closest('.cell') : null;
    if (!cell) return;
    var i = Number(cell.dataset.i);
    e.preventDefault();
    state.drag = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startIndex: i,
      startState: state.cells[i],
      lastIndex: -1,
      active: false,
      paintValue: MARK
    };
    boardScroll.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    if (touches.has(e.pointerId)) {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (gesture) {
        e.preventDefault();
        moveGesture();
        return;
      }
    }
    var d = state.drag;
    if (!d || d.id !== e.pointerId) return;
    if (state.tool === 'pan') {
      if (!d.active) {
        if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4) return;
        d.active = true;
        state.lastTap = null;
        d.panX = d.startX;
        d.panY = d.startY;
      }
      boardScroll.scrollLeft -= e.clientX - d.panX;
      boardScroll.scrollTop -= e.clientY - d.panY;
      d.panX = e.clientX;
      d.panY = e.clientY;
      return;
    }
    if (!d.active) {
      var dist = Math.hypot(e.clientX - d.startX, e.clientY - d.startY);
      if (dist < 9) return;
      d.active = true;
      state.lastTap = null;
      // Dragging from an ✕ erases marks; dragging from a blank cell paints them.
      d.paintValue = d.startState === MARK ? EMPTY : MARK;
      paintDrag(d.startIndex);
      d.lastIndex = d.startIndex;
    }
    var cell = cellFromPoint(e.clientX, e.clientY);
    if (!cell) return;
    var i = Number(cell.dataset.i);
    if (i !== d.lastIndex) {
      d.lastIndex = i;
      paintDrag(i);
    }
  }

  function onPointerUp(e) {
    touches.delete(e.pointerId);
    if (gesture) {
      if (touches.size >= 2) beginGesture();
      else if (!touches.size) gesture = null;
      if (boardScroll.hasPointerCapture(e.pointerId)) boardScroll.releasePointerCapture(e.pointerId);
      return;
    }
    var d = state.drag;
    if (!d || d.id !== e.pointerId) return;
    state.drag = null;
    if (boardScroll.hasPointerCapture(e.pointerId)) boardScroll.releasePointerCapture(e.pointerId);
    if (!d.active) handleTap(d.startIndex);
  }

  function onPointerCancel(e) {
    if (!touches.has(e.pointerId) && (!state.drag || state.drag.id !== e.pointerId)) return;
    touches.delete(e.pointerId);
    if (gesture && touches.size >= 2) beginGesture();
    else if (!touches.size) gesture = null;
    if (state.drag && state.drag.id === e.pointerId) state.drag = null;
    state.lastTap = null;
  }

  function onKeyDown(e) {
    var cell = e.target.closest ? e.target.closest('.cell') : null;
    if (!cell) return;
    var i = Number(cell.dataset.i);
    var n = state.puzzle ? state.puzzle.n : state.size;
    var r = (i / n) | 0;
    var c = i % n;
    var handled = true;
    switch (e.key) {
      case 'Enter':
      case ' ':
        state.lastTap = null;
        singleTap(i);
        break;
      case 'c':
      case 'C':
        state.lastTap = null;
        toggleCat(i);
        break;
      case 'ArrowUp':    focusCell(Math.max(0, r - 1), c, n); break;
      case 'ArrowDown':  focusCell(Math.min(n - 1, r + 1), c, n); break;
      case 'ArrowLeft':  focusCell(r, Math.max(0, c - 1), n); break;
      case 'ArrowRight': focusCell(r, Math.min(n - 1, c + 1), n); break;
      default: handled = false;
    }
    if (handled) e.preventDefault();
  }

  function focusCell(r, c, n) {
    var el = board.children[r * n + c];
    if (el) el.focus();
  }

  // ------------------------------------------------------------- generation

  function startPuzzle(p) {
    state.puzzle = p;
    state.solutionSet = new Set(Mewdoku.solutionCells(p));
    state.cells = new Array(p.n * p.n).fill(EMPTY);
    state.catsPlaced = 0;
    state.hearts = MAX_HEARTS;
    state.finished = false;
    state.lastTap = null;
    state.drag = null;
    state.autoMarks.clear();
    setTool('x');
    state.palette = buildPalette(p.n, state.pendingSeed);
    state.colors = assignColors(p.n, p.regions, state.palette);
    boardWrap.classList.remove('is-won', 'is-shaking');
    resetTimer();
    renderBoard();
    renderHearts();
    renderCatCount();
    renderBest();
    hideOverlay();
    if (state.showRulesOnStart) {
      state.showRulesOnStart = false;
      storeSet('mewdoku.seen', '1');
      showOverlay('rules');
    } else if (p.n > 10 && overlay.hidden) {
      toast('Big board! Use two fingers to move and pinch to zoom.');
    }
  }

  function showGenerationError() {
    state.finished = true;
    showOverlay('error');
  }

  function generateOnMainThread(n, id, seed) {
    // Two frames so the loading overlay actually paints before the synchronous work.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (id !== generationId) return;
        var p = Mewdoku.generate(n, {
          rng: Mewdoku.mulberry32(seed),
          quality: 6,
          difficulty: state.challengeTier,
          timeBudgetMs: 9000
        });
        if (id !== generationId) return;
        if (p) startPuzzle(p);
        else showGenerationError();
      });
    });
  }

  function initWorker() {
    if (!('Worker' in window)) return;
    try {
      worker = new Worker('worker.js');
      worker.onmessage = function (e) {
        var d = e.data || {};
        if (d.id !== generationId) return;
        if (d.puzzle) startPuzzle(d.puzzle);
        else showGenerationError();
      };
      worker.onerror = function () {
        try { worker.terminate(); } catch (err) { /* ignore */ }
        worker = null;
        generateOnMainThread(state.size, generationId, state.pendingSeed);
      };
    } catch (err) {
      worker = null;
    }
  }

  function requestPuzzle(n) {
    state.size = n;
    state.challengeTier = profile.tier;
    state.retryElapsed = 0;
    profile.size = n;
    difficultyEl.value = String(n);
    saveProfile();
    renderProgression();
    state.puzzle = null;
    state.finished = true;
    state.lastTap = null;
    state.drag = null;
    resetTimer();
    renderBest();
    showOverlay('loading');
    generationId++;
    var seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
    state.pendingSeed = seed;
    if (worker) worker.postMessage({ id: generationId, n: n, seed: seed, difficulty: state.challengeTier });
    else generateOnMainThread(n, generationId, seed);
  }

  function restartSame() {
    if (!state.puzzle) return;
    state.cells.fill(EMPTY);
    state.catsPlaced = 0;
    state.hearts = MAX_HEARTS;
    state.finished = false;
    state.lastTap = null;
    state.drag = null;
    state.autoMarks.clear();
    resetTimer();
    renderAllCells();
    renderHearts();
    renderCatCount();
    toast('Fresh start — you can do it!');
  }

  // --------------------------------------------------------------- wiring

  function setTool(tool) {
    state.tool = tool;
    state.lastTap = null;
    toolXBtn.classList.toggle('is-active', tool === 'x');
    toolCatBtn.classList.toggle('is-active', tool === 'cat');
    toolXBtn.setAttribute('aria-pressed', String(tool === 'x'));
    toolCatBtn.setAttribute('aria-pressed', String(tool === 'cat'));
    toolPanBtn.setAttribute('aria-pressed', String(tool === 'pan'));
    boardWrap.classList.toggle('is-panning', tool === 'pan');
  }

  function bindEvents() {
    boardScroll.addEventListener('pointerdown', onPointerDown);
    boardScroll.addEventListener('pointermove', onPointerMove);
    boardScroll.addEventListener('pointerup', onPointerUp);
    boardScroll.addEventListener('pointercancel', onPointerCancel);
    boardScroll.addEventListener('lostpointercapture', onPointerCancel);
    board.addEventListener('keydown', onKeyDown);
    board.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    toolXBtn.addEventListener('click', function () { setTool('x'); });
    toolCatBtn.addEventListener('click', function () { setTool('cat'); });
    toolPanBtn.addEventListener('click', function () {
      var turningOn = state.tool !== 'pan';
      setTool(turningOn ? 'pan' : 'x');
      if (turningOn) toast('Pan mode — drag to move around the big board.');
    });
    autoMarkBtn.addEventListener('click', function () {
      state.autoMarkEnabled = !state.autoMarkEnabled;
      storeSet('mewdoku.autoMark', state.autoMarkEnabled ? '1' : '0');
      renderAutoMarkToggle();
      restartAnimation(autoMarkBtn, 'is-flashing', 520);
      if (state.autoMarkEnabled) recomputeAutoMarks();
      else state.autoMarks.clear();   // keep the ✕ marks, just stop owning them
      toast(state.autoMarkEnabled
        ? 'Auto-✕ on — impossible squares are crossed out for you.'
        : 'Auto-✕ off — mark the squares yourself.');
    });
    newPuzzleBtn.addEventListener('click', function () { requestPuzzle(profile.size); });
    difficultyEl.addEventListener('change', function () {
      var n = Number(difficultyEl.value);
      requestPuzzle(n);
    });
    rulesBtn.addEventListener('click', function () {
      if (!overlay.hidden && overlay.dataset.kind !== 'rules') return;
      pauseTimer();
      showOverlay('rules');
    });

    window.addEventListener('resize', function () {
      resetPointerInput();
      updateBoardSize();
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) pauseTimer();
      else resumeTimer();
    });

    overlay.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-action]') : null;
      if (!btn) return;
      var action = btn.dataset.action;
      if (action === 'new') requestPuzzle(profile.size);
      else if (action === 'retry') { hideOverlay(); restartSame(); }
      else if (action === 'close') { hideOverlay(); resumeTimer(); }
    });
  }

  function registerSW() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* offline still works online */ });
    });
  }

  function init() {
    var saved = Number(storeGet('mewdoku.size'));
    profile.size = Progression.sizes.indexOf(saved) >= 0 ? saved : 5;
    loadProfile();
    state.size = profile.size;
    difficultyEl.value = String(state.size);
    state.showRulesOnStart = !storeGet('mewdoku.seen');
    state.autoMarkEnabled = storeGet('mewdoku.autoMark') === '1';
    renderAutoMarkToggle();
    bindEvents();
    initWorker();
    registerSW();
    renderHearts();
    renderCatCount();
    renderBest();
    requestPuzzle(state.size);
  }

  init();
})();
