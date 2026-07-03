// Юнит-тесты чистых функций реплаера (systems/replier.js): разбор ссылок, фильтр целей,
// дедуп, обрезка карты отвеченных, паузы, ключ дня. Запуск: npm test
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { normHandle, parseStatusHref, targetFilterReason, collectTargets, parseHandles, pickFreshOriginal, prunePostMap, jitterMs, todayKey } = require('../src/systems/replier.js');

test('normHandle: срезает @, пробелы и регистр', () => {
  assert.equal(normHandle(' @UserName '), 'username');
  assert.equal(normHandle('user'), 'user');
  assert.equal(normHandle(''), '');
  assert.equal(normHandle(null), '');
});

test('parseStatusHref: валидная ссылка на статус -> {handle, postId, postUrl}', () => {
  const m = parseStatusHref('/SomeUser/status/1234567890/photo/1');
  assert.deepEqual(m, { handle: 'someuser', postId: '1234567890', postUrl: 'https://x.com/SomeUser/status/1234567890' });
});

test('parseStatusHref: не-статусные и мусорные href -> null', () => {
  assert.equal(parseStatusHref('/home'), null);
  assert.equal(parseStatusHref('/user/likes'), null);
  assert.equal(parseStatusHref(''), null);
  assert.equal(parseStatusHref('/user/status/abc'), null);   // id только цифры
});

const OK = { handle: 'alice', postId: '1', postUrl: 'https://x.com/alice/status/1', text: 'x'.repeat(40) };

test('targetFilterReason: годная цель -> null', () => {
  assert.equal(targetFilterReason(OK, { myHandle: 'me', replied: {}, seen: new Set() }), null);
});

test('targetFilterReason: каждая причина отбраковки', () => {
  assert.equal(targetFilterReason(null, {}), 'meta');
  assert.equal(targetFilterReason({ handle: 'a' }, {}), 'meta');                                    // нет postId
  assert.equal(targetFilterReason(Object.assign({}, OK, { promoted: true }), {}), 'promo');
  assert.equal(targetFilterReason(Object.assign({}, OK, { repost: true }), {}), 'repost');
  assert.equal(targetFilterReason(Object.assign({}, OK, { reply: true }), {}), 'reply');            // чужой реплай под постом — не цель
  assert.equal(targetFilterReason(OK, { myHandle: 'alice' }), 'self');                              // не отвечаем сами себе
  assert.equal(targetFilterReason(Object.assign({}, OK, { text: 'коротко' }), {}), 'short');        // <=30 симв.
  assert.equal(targetFilterReason(OK, { replied: { 1: 1700000000 } }), 'replied');                  // уже отвечен
  assert.equal(targetFilterReason(OK, { seen: new Set(['1']) }), 'dup');                            // дубликат в этом сборе
});

test('targetFilterReason: ровно 30 символов — ещё «короткий», 31 — годится', () => {
  assert.equal(targetFilterReason(Object.assign({}, OK, { text: 'a'.repeat(30) }), {}), 'short');
  assert.equal(targetFilterReason(Object.assign({}, OK, { text: 'a'.repeat(31) }), {}), null);
});

test('collectTargets: фильтр + дедуп + max + статус wait', () => {
  const cands = [
    OK,
    Object.assign({}, OK),                                                        // дубль по postId
    { handle: 'bob', postId: '2', postUrl: 'u2', text: 'y'.repeat(40) },
    { handle: 'me', postId: '3', postUrl: 'u3', text: 'z'.repeat(40) },           // свой
    { handle: 'carol', postId: '4', postUrl: 'u4', text: 'w'.repeat(40) },
  ];
  const out = collectTargets(cands, { myHandle: 'me', replied: {}, seen: new Set(), max: 2 });
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((t) => t.postId), ['1', '2']);
  assert.ok(out.every((t) => t.st === 'wait'));
});

test('collectTargets: seen мутируется -> дедуп работает порциями между прокрутками', () => {
  const seen = new Set();
  const a = collectTargets([OK], { seen });
  const b = collectTargets([OK], { seen });   // «вторая прокрутка» видит ту же карточку
  assert.equal(a.length, 1);
  assert.equal(b.length, 0);
});

// ---------- цели «по @никам»: parseHandles + pickFreshOriginal (посты из синдикации) ----------

test('parseHandles: запятые/пробелы/точки с запятой, @, регистр, дедуп, мусор', () => {
  assert.deepEqual(parseHandles('@Alice, bob  CAROL;bob'), ['alice', 'bob', 'carol']);
  assert.deepEqual(parseHandles('  '), []);
  assert.deepEqual(parseHandles(null), []);
  assert.deepEqual(parseHandles('ok, длинный-невалидный-ник!!!'), ['ok']);   // не [A-Za-z0-9_] — отбрасываем
  assert.deepEqual(parseHandles('a'.repeat(16)), []);                        // X-ник максимум 15 символов
});

// nowTs фиксирован -> тесты не зависят от часов машины; окно по умолчанию 36ч
const NOW = 1_700_000_000;
const P = (id, ageH, extra) => Object.assign({ id, text: 't' + id, createdTs: NOW - ageH * 3600, isReply: false, isRepost: false, url: 'u' + id }, extra);

test('pickFreshOriginal: окно свежести — старше recencyHours не берём, внутри берём', () => {
  assert.equal(pickFreshOriginal([P('1', 40)], { recencyHours: 36, nowTs: NOW }), null);      // 40ч > 36ч
  assert.equal(pickFreshOriginal([P('1', 10)], { recencyHours: 36, nowTs: NOW }).id, '1');    // 10ч — свежий
  assert.equal(pickFreshOriginal([P('1', 10)], { recencyHours: 6, nowTs: NOW }), null);       // узкое окно режет
});

test('pickFreshOriginal: берётся НОВЕЙШИЙ по createdTs, а не первый (закреплённый твит первым — норма синдикации)', () => {
  const best = pickFreshOriginal([P('pin', 30), P('new', 2), P('mid', 12)], { nowTs: NOW });
  assert.equal(best.id, 'new');
});

test('pickFreshOriginal: реплаи и репосты отфильтрованы', () => {
  const posts = [P('r', 1, { isReply: true }), P('rt', 2, { isRepost: true }), P('ok', 20)];
  assert.equal(pickFreshOriginal(posts, { nowTs: NOW }).id, 'ok');
  assert.equal(pickFreshOriginal([P('r', 1, { isReply: true })], { nowTs: NOW }), null);
});

test('pickFreshOriginal: отвеченные (replied) и уже стоящие в очереди (queued) пропускаются', () => {
  const posts = [P('a', 1), P('b', 2)];
  assert.equal(pickFreshOriginal(posts, { nowTs: NOW, replied: { a: 123 } }).id, 'b');
  assert.equal(pickFreshOriginal(posts, { nowTs: NOW, queued: new Set(['a']) }).id, 'b');
  assert.equal(pickFreshOriginal(posts, { nowTs: NOW, replied: { a: 1 }, queued: new Set(['b']) }), null);
});

test('pickFreshOriginal: пустой/битый список и битые посты -> null', () => {
  assert.equal(pickFreshOriginal([], { nowTs: NOW }), null);
  assert.equal(pickFreshOriginal(null, { nowTs: NOW }), null);
  assert.equal(pickFreshOriginal([{}, { id: 'x' }, P('noTs', 0, { createdTs: 0 })], { nowTs: NOW, recencyHours: 36 }), null);   // createdTs=0 — вне окна
});

test('prunePostMap: до cap не трогает, выше cap режет до keep (остаются свежие)', () => {
  const small = { a: 1, b: 2 };
  assert.deepEqual(prunePostMap(small, 5, 3), small);
  const big = {};
  for (let i = 0; i < 10; i++) big['p' + i] = i;   // ts растут: p0 самый старый
  const out = prunePostMap(big, 8, 4);
  assert.deepEqual(Object.keys(out).sort(), ['p6', 'p7', 'p8', 'p9']);
});

test('jitterMs: в границах min..max сек и max<min нормализуется', () => {
  assert.equal(jitterMs(25, 90, 0), 25000);
  assert.equal(jitterMs(25, 90, 1), 90000);
  assert.equal(jitterMs(90, 25, 0.5), 90000);   // кривой ввод: max<min -> max=min
  assert.equal(jitterMs(0, 0, 0), 1000);        // нули -> минимум 1с, не «пулемёт»
});

test('todayKey: формат YYYY-MM-DD с ведущими нулями', () => {
  assert.equal(todayKey(new Date(2026, 0, 5)), '2026-01-05');
  assert.match(todayKey(), /^\d{4}-\d{2}-\d{2}$/);
});
