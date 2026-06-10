// Юнит-тесты матрицы режимов стража (core/guard.js). Запуск: npm test
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { MODES, allowsIn } = require('../src/core/guard.js');

test('режимов пять и они известны', () => {
  assert.deepEqual(MODES, ['game', 'calm', 'work', 'ai', 'safe']);
});

test('игровой: всё автономное разрешено', () => {
  for (const a of ['mischief', 'chatter', 'watch', 'journal', 'ai']) assert.equal(allowsIn('game', a), true, a);
});

test('безопасный: НИЧЕГО не уходит из браузера и не отвлекает', () => {
  for (const a of ['mischief', 'chatter', 'watch', 'journal', 'ai']) assert.equal(allowsIn('safe', a), false, a);
});

test('рабочий: не отвлекает (без пакостей/болтовни/видео), но ИИ и журнал работают', () => {
  assert.equal(allowsIn('work', 'mischief'), false);
  assert.equal(allowsIn('work', 'chatter'), false);
  assert.equal(allowsIn('work', 'watch'), false);
  assert.equal(allowsIn('work', 'journal'), true);
  assert.equal(allowsIn('work', 'ai'), true);
});

test('спокойный: без пакостей и болтовни, остальное живёт', () => {
  assert.equal(allowsIn('calm', 'mischief'), false);
  assert.equal(allowsIn('calm', 'chatter'), false);
  assert.equal(allowsIn('calm', 'watch'), true);
  assert.equal(allowsIn('calm', 'ai'), true);
});

test('ИИ-режим: помощник активен, пакости выключены', () => {
  assert.equal(allowsIn('ai', 'ai'), true);
  assert.equal(allowsIn('ai', 'mischief'), false);
});

test('неизвестный режим падает в game-поведение (не блокирует питомца)', () => {
  assert.equal(allowsIn('nonsense', 'chatter'), true);
});
