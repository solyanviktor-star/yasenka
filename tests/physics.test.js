// Юнит-тесты чистой физики платформера (core/physics.js). Запуск: node --test tests/
// Без браузера и зависимостей — node:test из коробки (node >= 18).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { ledgeJumpable, jumpArcPos, jumpPeakFor, isDropJump, ledgeFromRect, climbCandidates } = require('../src/core/physics.js');

// параметры как у Яси по умолчанию: ширина 46, прыжок вбок 120, вверх 150 (core/config.js)
const P = { W: 46, dx: 120, up: 150 };
const L = (x1, x2, y) => ({ x1, x2, y });   // полка: x-диапазон + верхняя грань

test('вверх в пределах PLAT_JUMP_UP — достижимо', () => {
  assert.equal(ledgeJumpable(L(100, 300, 500), L(100, 300, 360), P), true);   // dy = 140 <= 150
});

test('вверх выше PLAT_JUMP_UP — нет', () => {
  assert.equal(ledgeJumpable(L(100, 300, 500), L(100, 300, 340), P), false);  // dy = 160 > 150
});

test('вниз глубоко (до 4×up) — достижимо падением', () => {
  assert.equal(ledgeJumpable(L(100, 300, 100), L(100, 300, 600), P), true);   // dy = -500 >= -600
});

test('вниз глубже 4×up — нет', () => {
  assert.equal(ledgeJumpable(L(100, 300, 100), L(100, 300, 800), P), false);  // dy = -700 < -600
});

test('горизонтальный разрыв больше PLAT_JUMP_DX — нет', () => {
  // стоячие зоны: A=[123..277], B=[523..677] -> hgap = 523-277 = 246 > 120
  assert.equal(ledgeJumpable(L(100, 300, 500), L(500, 700, 500), P), false);
});

test('горизонтальный разрыв в пределах PLAT_JUMP_DX — да', () => {
  // A=[123..277], B=[373..527] -> hgap = 96 <= 120
  assert.equal(ledgeJumpable(L(100, 300, 500), L(350, 550, 500), P), true);
});

test('перекрывающиеся полки (hgap=0) на одной высоте — да', () => {
  assert.equal(ledgeJumpable(L(100, 300, 500), L(200, 400, 500), P), true);
});

test('целевая полка уже хитбокса (не встать) — нет', () => {
  assert.equal(ledgeJumpable(L(100, 300, 500), L(200, 240, 400), P), false);  // ширина 40 < W=46
});

test('исходная полка уже хитбокса — нет', () => {
  assert.equal(ledgeJumpable(L(200, 240, 500), L(100, 300, 400), P), false);
});

test('хитбокс шире (большой герой) делает узкую полку недостижимой', () => {
  const wide = { W: 92, dx: 120, up: 150 };
  assert.equal(ledgeJumpable(L(100, 300, 500), L(200, 290, 400), wide), false);   // 90 < 92
  assert.equal(ledgeJumpable(L(100, 300, 500), L(200, 290, 400), P), true);       // 90 >= 46
});

// ---------- дуга прыжка ----------
test('jumpArcPos: старт и финиш точные, середина выше обеих точек', () => {
  const a0 = jumpArcPos(100, 500, 300, 400, 150, 0);
  const a1 = jumpArcPos(100, 500, 300, 400, 150, 1);
  const am = jumpArcPos(100, 500, 300, 400, 150, 0.5);
  assert.deepEqual([a0.x, a0.y], [100, 500]);
  assert.deepEqual([Math.round(a1.x), Math.round(a1.y)], [300, 400]);
  assert.equal(am.x, 200);
  assert.ok(am.y < 400 && am.y < 500, 'апекс выше старта и цели');   // y растёт вниз
});

test('jumpPeakFor: вверх — горб покрывает перепад, вниз/вровень — минимум 46', () => {
  assert.equal(jumpPeakFor(500, 400), 150);   // (500-400)+50
  assert.equal(jumpPeakFor(400, 500), 46);    // вниз -> минимум
  assert.equal(jumpPeakFor(500, 500), 50);    // вровень -> небольшой горб
});

test('isDropJump: глубже 0.6×up — спуск падением, иначе дуга', () => {
  assert.equal(isDropJump(100, 100 + 91, 150), true);    // 91 > 90
  assert.equal(isDropJump(100, 100 + 90, 150), false);
  assert.equal(isDropJump(500, 400, 150), false);        // вверх — всегда дуга
});

// ---------- полка из прямоугольника ----------
const R = (left, right, top, height) => ({ left, right, top, width: right - left, height });
const VW = 1200, VH = 800;

test('ledgeFromRect: нормальный блок -> полка с клампом к краям', () => {
  const lg = ledgeFromRect(R(100, 400, 300, 40), VW, VH, 46, () => false);
  assert.deepEqual(lg, { x1: 100, x2: 400, y: 300 });
});

test('ledgeFromRect: мелкий/тонкий/за экраном -> null', () => {
  assert.equal(ledgeFromRect(R(100, 140, 300, 40), VW, VH, 46, () => false), null);   // width 40 < 44
  assert.equal(ledgeFromRect(R(100, 400, 300, 10), VW, VH, 46, () => false), null);   // height < 14
  assert.equal(ledgeFromRect(R(100, 400, 2, 40), VW, VH, 46, () => false), null);     // top < 6
  assert.equal(ledgeFromRect(R(100, 400, VH - 5, 40), VW, VH, 46, () => false), null); // ниже низа
});

test('ledgeFromRect: почти во весь экран -> null (контейнер/фон)', () => {
  assert.equal(ledgeFromRect(R(10, 10 + VW * 0.41, 300, 40), VW, VH, 46, () => false), null);
});

test('ledgeFromRect: широковатая обёртка с блоками внутри -> null, без блоков -> полка', () => {
  const r = R(100, 100 + VW * 0.3, 300, 40);   // 30% ширины: > 0.22, < 0.40
  assert.equal(ledgeFromRect(r, VW, VH, 46, () => true), null);
  assert.ok(ledgeFromRect(r, VW, VH, 46, () => false));
});

test('ledgeFromRect: hasInner НЕ зовётся для узких элементов (ленивость)', () => {
  let called = false;
  ledgeFromRect(R(100, 300, 300, 40), VW, VH, 46, () => { called = true; return true; });
  assert.equal(called, false);
});

// ---------- кандидаты свободного прыжка ----------
const CP = Object.assign({ minY: 62, lastLeftEl: null }, P);

test('climbCandidates: далёкая по горизонтали полка отсеяна (баг «летает через пол-экрана»)', () => {
  const stand = { x1: 0, x2: 1200, y: 796, floor: true };       // широкий пол
  const far = { x1: 900, x2: 1100, y: 700, el: {} };            // питомец у левого края (cx=100)
  assert.deepEqual(climbCandidates([far], stand, 100, CP), []);
});

test('climbCandidates: ближняя полка попадает с большим весом, чем дальняя', () => {
  const stand = { x1: 0, x2: 1200, y: 796, floor: true };
  const near = { x1: 80, x2: 260, y: 700, el: {} };             // у питомца под боком
  const far = { x1: 150, x2: 400, y: 700, el: {} };             // дальше по горизонтали
  const cand = climbCandidates([near, far], stand, 100, CP);
  assert.equal(cand.length, 2);
  const wNear = cand.find((c) => c.L === near).w, wFar = cand.find((c) => c.L === far).w;
  assert.ok(wNear > wFar);
});

test('climbCandidates: анти-пинг-понг и пол режут вес', () => {
  const leftEl = {};
  const stand = { x1: 100, x2: 400, y: 500, el: {} };
  const back = { x1: 100, x2: 400, y: 400, el: leftEl };        // только что покинутый блок
  const floor = { x1: 0, x2: 1200, y: 796, floor: true, el: null };
  const p2 = Object.assign({}, CP, { lastLeftEl: leftEl, up: 400 });   // up побольше, чтобы пол был достижим
  const cand = climbCandidates([back, floor], stand, 250, p2);
  const wBack = cand.find((c) => c.L === back).w, wFloor = cand.find((c) => c.L === floor).w;
  const wPlain = climbCandidates([{ x1: 100, x2: 400, y: 400, el: {} }], stand, 250, p2)[0].w;
  assert.ok(wBack < wPlain * 0.25, 'возврат на покинутый блок сильно подавлен');
  assert.ok(wFloor < wPlain, 'пол выбирается реже обычного блока');
});

test('climbCandidates: полки за верхом экрана игнорируются', () => {
  const stand = { x1: 100, x2: 400, y: 200, el: {} };
  const above = { x1: 100, x2: 400, y: 40, el: {} };            // y < minY=62
  assert.deepEqual(climbCandidates([above], stand, 250, CP), []);
});
