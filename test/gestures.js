/* Dependency-free regression checks for the app's pointer handlers. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function element() {
  const classes = new Set();
  return {
    hidden: true, dataset: {}, children: [], style: {}, attributes: {},
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      toggle(name, on) { if (on) classes.add(name); else classes.delete(name); }
    },
    setAttribute(name, value) { this.attributes[name] = value; },
    closest() { return this.dataset.i === undefined ? null : this; }
  };
}

const elements = new Map();
function getElement(id) {
  if (!elements.has(id)) elements.set(id, element());
  return elements.get(id);
}
const scroll = getElement('boardScroll');
const stage = getElement('.board-stage');
scroll.clientWidth = scroll.clientHeight = 300;
scroll.scrollLeft = scroll.scrollTop = 0;
scroll.getBoundingClientRect = () => ({ left: 10, top: 20, width: 300, height: 300 });
const captured = new Set();
scroll.setPointerCapture = id => captured.add(id);
scroll.hasPointerCapture = id => captured.has(id);
scroll.releasePointerCapture = id => {
  captured.delete(id);
  ui.onPointerCancel({ pointerId: id }); // lostpointercapture after normal release
};
Object.defineProperty(stage, 'offsetWidth', { get: () => parseFloat(stage.style.width) });
Object.defineProperty(scroll, 'scrollWidth', { get: () => stage.offsetWidth });
Object.defineProperty(scroll, 'scrollHeight', { get: () => stage.offsetWidth });
const board = getElement('board');
for (let i = 0; i < 625; i++) {
  const cell = element();
  cell.dataset.i = String(i);
  board.children.push(cell);
}
let hitCell = board.children[1];
const context = vm.createContext({
  document: {
    getElementById: getElement, querySelector: getElement,
    elementFromPoint: () => hitCell
  },
  window: { matchMedia: () => ({ matches: true }) },
  localStorage: { getItem: () => null, setItem() {} },
  setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {}
});
const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
assert.equal(source.split('  init();').length, 2);
vm.runInContext(source.replace('  init();', `globalThis.ui = {
  state, onPointerDown, onPointerMove, onPointerUp, onPointerCancel,
  resetPointerInput, setTool, updateBoardSize,
  get touchCount() { return touches.size; }
};`), context);
const ui = context.ui;
ui.state.size = 25;
ui.state.puzzle = { n: 25, regions: new Array(625).fill(0) };
ui.state.cells = new Array(625).fill(0);
ui.state.solutionSet = new Set([0]);
ui.state.finished = false;
getElement('overlay').hidden = true;
ui.updateBoardSize();

function event(id, x = 110, y = 120, type = 'touch', index = 0) {
  return {
    pointerId: id, clientX: x, clientY: y, pointerType: type,
    button: 0, target: board.children[index], preventDefault() {}
  };
}
function down(...args) { ui.onPointerDown(event(...args)); }
function move(...args) { ui.onPointerMove(event(...args)); }
function up(id) { ui.onPointerUp(event(id)); }
function cancel(id) {
  ui.onPointerCancel(event(id));
  if (captured.has(id)) scroll.releasePointerCapture(id);
}
function emptyBoard() {
  assert.ok(ui.state.cells.every(value => value === 0), 'gesture must not edit cells');
  assert.equal(ui.state.hearts, 3);
}
function close(actual, expected) { assert.ok(Math.abs(actual - expected) < .01, `${actual} != ${expected}`); }

assert.equal(stage.offsetWidth, 750);
ui.setTool('cat');
scroll.scrollLeft = 100;
scroll.scrollTop = 120;
down(1, 110, 120);
down(2, 210, 120);
move(1, 60, 120);
move(2, 260, 120);
assert.equal(stage.offsetWidth, 1500);
close(scroll.scrollLeft, 350); // the content under the midpoint stays anchored
close(scroll.scrollTop, 340);
assert.equal(ui.state.tool, 'cat');
emptyBoard();
move(1, 40, 100);
move(2, 240, 100);
close(scroll.scrollLeft, 370);
close(scroll.scrollTop, 360);
up(1);
move(2, 200, 80);
up(2);
emptyBoard();
assert.equal(ui.touchCount, 0);
assert.equal(captured.size, 0);

// A normal touch tap works immediately after the gesture.
down(3);
up(3);
assert.equal(ui.state.cells[0], 2);
assert.equal(ui.state.catsPlaced, 1);
down(4);
up(4);
assert.equal(ui.state.cells[0], 0);

// Lost capture on normal release must not break double-tap placement.
ui.setTool('x');
down(5);
up(5);
assert.equal(ui.state.cells[0], 1);
down(6);
up(6);
assert.equal(ui.state.cells[0], 2);
ui.state.cells.fill(0);
ui.state.catsPlaced = 0;
ui.resetPointerInput();

// Zoom clamps to full-board fit and a bounded close-up.
down(7, 110, 120);
down(8, 210, 120);
move(8, 111, 120);
assert.equal(stage.offsetWidth, 300);
scroll.clientWidth = 290;
assert.equal(ui.updateBoardSize(), 300, 'scrollbars must not alter the zoom baseline');
scroll.clientWidth = 300;
move(8, 10110, 120);
assert.equal(stage.offsetWidth, 2250);
cancel(7);
move(8, 130, 120);
up(8);
emptyBoard();

// Three fingers and cancellation rebase without causing jumps or cell input.
down(9, 110, 120);
down(10, 210, 120);
down(11, 160, 200);
up(9);
const before = stage.offsetWidth;
move(10, 210, 120);
assert.equal(stage.offsetWidth, before);
cancel(10);
up(11);
emptyBoard();

// Painting and erasing still work, as does mouse/one-finger Pan.
ui.setTool('x');
down(12, 110, 120, 'mouse');
move(12, 130, 120, 'mouse');
up(12);
assert.equal(ui.state.cells[0], 1);
assert.equal(ui.state.cells[1], 1);
down(13);
move(13, 130, 120);
up(13);
emptyBoard();
for (const type of ['touch', 'mouse']) {
  ui.setTool('pan');
  scroll.scrollLeft = scroll.scrollTop = 100;
  down(14, 110, 120, type);
  move(14, 90, 90, type);
  up(14);
  assert.equal(scroll.scrollLeft, 120);
  assert.equal(scroll.scrollTop, 130);
  emptyBoard();
}

// Overlay/resize cleanup cannot leave an old gesture or drag active.
down(15);
down(16, 210, 120);
ui.resetPointerInput();
up(15);
up(16);
assert.equal(ui.touchCount, 0);
assert.equal(captured.size, 0);
emptyBoard();

// Small boards ignore the extra finger and do not zoom.
ui.state.size = 5;
ui.setTool('x');
const smallSide = ui.updateBoardSize();
assert.equal(smallSide, 300);
down(17);
down(18, 210, 120);
move(18, 260, 120);
up(18);
up(17);
assert.equal(stage.offsetWidth, smallSide);
assert.equal(ui.state.cells[0], 1);
console.log('ALL GESTURE CHECKS PASSED');
