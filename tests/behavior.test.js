// Юнит-тесты движка поведения (core/behavior.js): дикость + взвешенный выбор. Запуск: npm test
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { wildnessOf, mischiefIntervalMs, matchWhen, pickBehavior } = require('../src/core/behavior.js');

const K = { hungerFrom: 40, hungerK: 0.6, moodFrom: 50, moodK: 0.8, neglectCap: 25, neglectK: 1.2, bondK: 0.4, minWild: 18, minMs: 8000, maxMs: 78000 };

test('дикость: голодная+заброшенная+низкий bond дичее сытой+глаженой', () => {
  const wildOne = wildnessOf({ hunger: 95, mood: 25, bond: 5, neglectMin: 25 }, K);
  const tame = wildnessOf({ hunger: 0, mood: 80, bond: 90, neglectMin: 0 }, K);
  assert.ok(wildOne > 70, 'дикая должна быть высокой: ' + wildOne);
  assert.ok(tame < 10, 'ручная должна быть низкой: ' + tame);
});

test('дикость: привязанность усмиряет (монотонно)', () => {
  const base = { hunger: 70, mood: 40, neglectMin: 10 };
  const low = wildnessOf(Object.assign({ bond: 0 }, base), K);
  const high = wildnessOf(Object.assign({ bond: 100 }, base), K);
  assert.ok(high < low, `bond должен снижать дикость: ${high} < ${low}`);
});

test('дикость: зажата в 0..100', () => {
  assert.equal(wildnessOf({ hunger: 100, mood: 0, bond: 0, neglectMin: 100 }, K), 100);
  assert.equal(wildnessOf({ hunger: 0, mood: 100, bond: 100, neglectMin: 0 }, K), 0);
});

test('интервал пакостей: ниже порога -> 0 (не пакостит)', () => {
  assert.equal(mischiefIntervalMs(10, K), 0);
  assert.equal(mischiefIntervalMs(17, K), 0);
  assert.ok(mischiefIntervalMs(18, K) > 0);
});

test('интервал пакостей: дикая -> часто, смирная -> редко (монотонно убывает)', () => {
  const wildIv = mischiefIntervalMs(100, K), midIv = mischiefIntervalMs(50, K);
  assert.ok(wildIv <= K.minMs + 1, 'дикая ~minMs: ' + wildIv);
  assert.ok(midIv > wildIv && midIv < K.maxMs, 'середина между: ' + midIv);
});

test('matchWhen: операторы сравнения', () => {
  assert.equal(matchWhen({ energy: '<45' }, { energy: 30 }), true);
  assert.equal(matchWhen({ energy: '<45' }, { energy: 60 }), false);
  assert.equal(matchWhen({ bond: '>=45' }, { bond: 45 }), true);
  assert.equal(matchWhen({ mood: '>50' }, { mood: 50 }), false);
  assert.equal(matchWhen(null, {}), true);                 // нет условия -> подходит
  assert.equal(matchWhen({ hunger: '>10' }, {}), false);   // нет ключа -> 0 -> не >10
});

test('pickBehavior: on-биндинги в автоселектор не попадают', () => {
  const cands = [{ id: 'eat', on: 'feed', weight: 100 }];
  assert.equal(pickBehavior(cands, {}, {}, 0, () => 0.5), null);
});

test('pickBehavior: пустой/неподходящий пул -> null', () => {
  assert.equal(pickBehavior([], {}, {}, 0, () => 0.5), null);
  const cands = [{ id: 'yawn', when: { energy: '<40' }, weight: 5 }];
  assert.equal(pickBehavior(cands, { energy: 90 }, {}, 0, () => 0.5), null);
});

test('pickBehavior: cooldown отсекает недавно сыгранное', () => {
  const cands = [{ id: 'yawn', weight: 5, cooldown: 60 }];
  const now = 100000;
  assert.equal(pickBehavior(cands, {}, { yawn: now - 30000 }, now, () => 0.5), null);   // 30с < 60с cooldown
  assert.ok(pickBehavior(cands, {}, { yawn: now - 90000 }, now, () => 0.5));            // 90с > cooldown
});

test('pickBehavior: детерминированный взвешенный выбор по rng', () => {
  const cands = [{ id: 'a', weight: 1 }, { id: 'b', weight: 3 }];   // total=4 (модификаторов нет: kind не задан)
  assert.equal(pickBehavior(cands, {}, {}, 0, () => 0.1).id, 'a');   // 0.1*4=0.4 -> первый (вес 1)
  assert.equal(pickBehavior(cands, {}, {}, 0, () => 0.9).id, 'b');   // 0.9*4=3.6 -> второй
});

test('pickBehavior: дикость качает веса пакостей', () => {
  const cands = [{ id: 'crack', kind: 'prank', weight: 10 }];
  // при нулевой дикости вес ×0.3, при максимальной ×2.0 — оба выбираются (один кандидат), проверяем что не падает и не null
  assert.ok(pickBehavior(cands, {}, {}, 0, () => 0.5, { wild: 0 }));
  assert.ok(pickBehavior(cands, {}, {}, 0, () => 0.5, { wild: 100 }));
});
