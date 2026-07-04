// Юнит-тесты матрицы режимов стража (core/guard.js). Запуск: npm test
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { MODES, allowsIn } = require('../src/core/guard.js');

test('режима два: обычный и спокойный', () => {
  assert.deepEqual(MODES, ['normal', 'calm']);
});

test('обычный: всё автономное разрешено (поведение ведут статы/настроение)', () => {
  for (const a of ['mischief', 'chatter', 'watch', 'journal', 'ai']) assert.equal(allowsIn('normal', a), true, a);
});

test('спокойный: без пакостей и болтовни, остальное живёт', () => {
  assert.equal(allowsIn('calm', 'mischief'), false);
  assert.equal(allowsIn('calm', 'chatter'), false);
  assert.equal(allowsIn('calm', 'watch'), true);
  assert.equal(allowsIn('calm', 'journal'), true);
  assert.equal(allowsIn('calm', 'ai'), true);
});

test('неизвестный/старый режим падает в normal-поведение (не блокирует питомца)', () => {
  assert.equal(allowsIn('game', 'chatter'), true);   // старый сохранённый режим -> обычное поведение
  assert.equal(allowsIn('nonsense', 'mischief'), true);
});
