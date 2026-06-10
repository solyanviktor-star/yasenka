// Юнит-тесты чистой физики платформера (core/physics.js). Запуск: node --test tests/
// Без браузера и зависимостей — node:test из коробки (node >= 18).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { ledgeJumpable } = require('../src/core/physics.js');

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
