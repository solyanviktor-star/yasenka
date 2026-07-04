// Юнит-тесты чистой математики раундов мини-игр (src/systems/games.js). Запуск: npm test
// Файл — IIFE контент-скрипта: в node он экспортирует pure-хелперы и выходит ДО обращения к window.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const pure = require('../src/systems/games.js');
const { sessionXp, zombieXp, hideXp, isNewBest, hearts, fmtSec } = pure;

test('экспорт: в node модуль отдаёт только чистые функции (без DOM-побочек)', () => {
  for (const k of ['sessionXp', 'zombieXp', 'hideXp', 'isNewBest', 'hearts', 'fmtSec']) assert.equal(typeof pure[k], 'function', k);
});

test('sessionXp: 0 -> утешительные 2, иначе зажат в 5..15', () => {
  assert.equal(sessionXp(0, 1.2), 2);
  assert.equal(sessionXp(-3, 1.2), 2);
  assert.equal(sessionXp(1, 1.2), 5);           // даже 1 поимка даёт минимум 5
  assert.equal(sessionXp(10, 1.2), 12);         // пропорционально счёту
  assert.equal(sessionXp(100, 1.2), 15);        // потолок сессии
});

test('zombieXp: победа 12..15 (меньше укусов -> больше), поражение по стомпам', () => {
  assert.equal(zombieXp(5, 0, true), 15);
  assert.equal(zombieXp(5, 3, true), 12);
  assert.equal(zombieXp(0, 3, false), 2);       // без стомпов — утешительные
  assert.equal(zombieXp(4, 3, false), 6);       // 4*1.5=6
  assert.ok(zombieXp(1, 3, false) >= 3);        // нижняя планка поражения
});

test('hideXp: быстрее -> больше, зажат в 5..15', () => {
  assert.equal(hideXp(10), 15);                 // 18-2=16 -> потолок 15
  assert.equal(hideXp(40), 10);
  assert.equal(hideXp(200), 5);                 // очень долго -> минимум
  assert.ok(hideXp(20) > hideXp(50), 'монотонно убывает по времени');
});

test('isNewBest: больше = лучше (по умолчанию), нулевой счёт не рекорд', () => {
  assert.equal(isNewBest(undefined, 0), false);
  assert.equal(isNewBest(undefined, 1), true);
  assert.equal(isNewBest(5, 5), false);
  assert.equal(isNewBest(5, 6), true);
});

test('isNewBest: lowerBetter (прятки) — меньшее время бьёт рекорд', () => {
  assert.equal(isNewBest(undefined, 12.3, true), true);   // первый забег = рекорд
  assert.equal(isNewBest(undefined, 0, true), false);     // нулевое время — мусор, не пишем
  assert.equal(isNewBest(10, 9.9, true), true);
  assert.equal(isNewBest(10, 10, true), false);
  assert.equal(isNewBest(10, 11, true), false);
});

test('hearts: жизни рисуются ❤️/🖤 и не ломаются на выходе за границы', () => {
  assert.equal(hearts(3, 3), '❤️❤️❤️');
  assert.equal(hearts(1, 3), '❤️🖤🖤');
  assert.equal(hearts(0, 3), '🖤🖤🖤');
  assert.equal(hearts(-1, 3), '🖤🖤🖤');        // укусов больше жизней -> не бросаем repeat(-1)
  assert.equal(hearts(9, 3), '❤️❤️❤️');
});

test('fmtSec: миллисекунды -> секунды с десятыми, отрицательное время не показываем', () => {
  assert.equal(fmtSec(12345), '12.3');
  assert.equal(fmtSec(0), '0.0');
  assert.equal(fmtSec(-500), '0.0');
});
