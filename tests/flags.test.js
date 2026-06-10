// Юнит-тесты фиче-флагов (core/flags.js): set/disable/load + watch() — внешние правки из попапа. Запуск: npm test
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');

// flags.js — браузерный IIFE на window; собираем минимальный стенд (стабы storage/events) и грузим модуль заново
function makeStand(stored) {
  let onChangedCb = null;
  const synced = {};
  const emitted = [];
  global.window = {
    Yasia: {
      storage: {
        syncGet: (defaults, cb) => cb(stored ? { yasiaFlags: stored } : defaults),
        syncSet: (o) => Object.assign(synced, o),
        onChanged: (cb) => { onChangedCb = cb; },
      },
      events: { emit: (n, p) => emitted.push({ n, p }) },
    },
  };
  delete require.cache[require.resolve('../src/core/flags.js')];
  require('../src/core/flags.js');
  return {
    flags: global.window.Yasia.flags,
    synced,
    emitted,
    fireChange: (ch, area) => onChangedCb && onChangedCb(ch, area),
  };
}

test('дефолты: основные способности включены, планируемые игры выключены', () => {
  const { flags } = makeStand();
  for (const n of ['tamagotchi', 'mediaDownload', 'notes', 'aiAssistant', 'skills', 'memory', 'games']) assert.equal(flags.enabled(n), true, n);
  assert.equal(flags.enabled('zombies'), false);
  assert.equal(flags.enabled('bowGame'), false);
});

test('set: переключает, пишет в sync и эмитит flags:changed; неизвестный флаг игнорируется', () => {
  const { flags, synced, emitted } = makeStand();
  assert.equal(flags.set('games', false), true);
  assert.equal(flags.enabled('games'), false);
  assert.equal(synced.yasiaFlags.games, false);
  assert.deepEqual(emitted[emitted.length - 1].p && { name: emitted[emitted.length - 1].p.name, on: emitted[emitted.length - 1].p.on }, { name: 'games', on: false });
  assert.equal(flags.set('nonsense', true), false);
  assert.equal(flags.enabled('nonsense'), false);
});

test('disable: гасит флаг и эмитит flags:disabled с причиной', () => {
  const { flags, emitted } = makeStand();
  flags.disable('notes', 'init failed');
  assert.equal(flags.enabled('notes'), false);
  const ev = emitted.find((e) => e.n === 'flags:disabled');
  assert.ok(ev && ev.p.name === 'notes' && /init failed/.test(ev.p.reason));
});

test('load: подтягивает сохранённый выбор поверх дефолтов', (t, done) => {
  const { flags } = makeStand({ games: false, zombies: true });
  flags.load((all) => {
    assert.equal(all.games, false);
    assert.equal(all.zombies, true);
    assert.equal(all.notes, true);   // не тронутый ключ остаётся дефолтным
    done();
  });
});

test('watch: правка yasiaFlags из попапа применяется и эмитит flags:changed по каждому отличию', (t, done) => {
  const { flags, emitted, fireChange } = makeStand();
  flags.load(() => {
    emitted.length = 0;
    fireChange({ yasiaFlags: { newValue: { games: false, notes: true } } }, 'sync');
    assert.equal(flags.enabled('games'), false);
    assert.equal(flags.enabled('notes'), true);
    const changed = emitted.filter((e) => e.n === 'flags:changed');
    assert.equal(changed.length, 1);                       // диф ровно один: notes не менялся
    assert.deepEqual({ name: changed[0].p.name, on: changed[0].p.on }, { name: 'games', on: false });
    done();
  });
});

test('watch: чужая область (local) и посторонние ключи не трогают флаги', (t, done) => {
  const { flags, emitted, fireChange } = makeStand();
  flags.load(() => {
    emitted.length = 0;
    fireChange({ yasiaFlags: { newValue: { games: false } } }, 'local');
    fireChange({ hunger: { newValue: 50 } }, 'sync');
    assert.equal(flags.enabled('games'), true);
    assert.equal(emitted.filter((e) => e.n === 'flags:changed').length, 0);
    done();
  });
});
