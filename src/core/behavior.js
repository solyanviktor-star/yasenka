// Движок поведения Яси (фаза 1): шкала дикости + взвешенный выбор поведения.
// ЧИСТЫЕ функции (без DOM) -> тестируются в node (см. tests/behavior.test.js).
// Грузится перед pet.js (manifest content_scripts). Доступ: window.Yasia.behavior.
//
// Идея: персонаж выбирает из БОЛЬШОЙ библиотеки поведений (данные в манифесте героя).
//   • on-биндинги (реакция на действие) играются детерминированно (это делает pet.js);
//   • автономные (idle-жизнь) выбираются pickBehavior() по состоянию, с весами,
//     cooldown'ами и анти-повтором.
// Дикость — один из входов: качает веса пакостей и частоту шкоды.
(function () {
  'use strict';

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // дикость 0..100 из статов + заброшенности (минуты с последнего взаимодействия).
  // s = { hunger, mood, bond, neglectMin }; k = config.WILD
  function wildnessOf(s, k) {
    s = s || {}; k = k || {};
    var w = 0;
    w += Math.max(0, (s.hunger || 0) - (k.hungerFrom || 40)) * (k.hungerK || 0.6);   // голод -> дичает
    w += Math.max(0, (k.moodFrom || 50) - (s.mood || 0)) * (k.moodK || 0.8);          // плохое настроение -> дичает
    w += Math.min(k.neglectCap || 25, s.neglectMin || 0) * (k.neglectK || 1.2);       // заброшенность -> дичает
    w -= (s.bond || 0) * (k.bondK || 0.4);                                            // привязанность усмиряет
    return clamp(w, 0, 100);
  }

  // интервал между пакостями (мс) из дикости: дикая -> часто, смирная -> редко.
  // ниже порога k.minWild -> 0 («не пакостить»; вызывающий проверит снова позже).
  function mischiefIntervalMs(wild, k) {
    k = k || {};
    if (wild < (k.minWild != null ? k.minWild : 18)) return 0;
    var f = (100 - clamp(wild, 0, 100)) / 100;            // 0 (дикая) .. 1 (смирная)
    var lo = k.minMs || 8000, hi = k.maxMs || 78000;
    return Math.round(lo + f * (hi - lo));
  }

  // условие "when": { hunger:'<45', bond:'>=45' } против состояния -> bool.
  function matchWhen(when, state) {
    if (!when) return true;
    state = state || {};
    for (var key in when) {
      if (!Object.prototype.hasOwnProperty.call(when, key)) continue;
      if (!cmp(state[key], String(when[key]))) return false;
    }
    return true;
  }
  function cmp(val, expr) {
    val = (typeof val === 'number') ? val : 0;
    var m = expr.match(/^\s*(<=|>=|<|>|=)?\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (!m) return true;
    var op = m[1] || '=', n = parseFloat(m[2]);
    if (op === '<') return val < n;
    if (op === '>') return val > n;
    if (op === '<=') return val <= n;
    if (op === '>=') return val >= n;
    return val === n;
  }

  // модификатор веса от состояния по типу поведения (kind). opt.wild = текущая дикость.
  function weightMod(c, state, opt) {
    var m = 1, W = opt.wild || 0;
    if (c.kind === 'prank') m *= 0.3 + (W / 100) * 1.7;                          // дикость качает пакости (×0.3..×2.0)
    if (c.kind === 'idle' && (state.energy || 100) < 40) m *= 1.6;               // устала -> больше idle-ритуалов
    if (c.kind === 'affection' && (state.bond || 0) >= (opt.bondFriend || 45)) m *= 1.5;   // доверие -> ласковее
    if (c.kind === 'emotion' && (state.mood || 50) < 38) m *= 1.4;               // в плохом настроении -> эмоции заметнее
    return m;
  }

  // взвешенный выбор автономного поведения.
  // cands = [{ id, weight, when, cooldown, kind }]; recent = { id: lastMs }; rng() -> [0,1).
  // opt = { wild, bondFriend, freshMs, repeatPenalty }.
  function pickBehavior(cands, state, recent, now, rng, opt) {
    cands = cands || []; recent = recent || {}; opt = opt || {};
    var elig = [], total = 0, i;
    for (i = 0; i < cands.length; i++) {
      var c = cands[i];
      if (!c || c.on) continue;                                   // on-биндинги — не для автоселектора
      if (!matchWhen(c.when, state)) continue;
      var last = recent[c.id] || 0;
      if (c.cooldown && (now - last) < c.cooldown * 1000) continue;
      var w = (c.weight || 1) * weightMod(c, state, opt);
      if (last && (now - last) < (opt.freshMs || 8000)) w *= (opt.repeatPenalty != null ? opt.repeatPenalty : 0.25);  // анти-повтор
      if (w <= 0) continue;
      elig.push({ c: c, w: w }); total += w;
    }
    if (total <= 0) return null;
    var r = (rng ? rng() : Math.random()) * total;
    for (i = 0; i < elig.length; i++) { r -= elig[i].w; if (r <= 0) return elig[i].c; }
    return elig[elig.length - 1].c;
  }

  var api = {
    wildnessOf: wildnessOf,
    mischiefIntervalMs: mischiefIntervalMs,
    matchWhen: matchWhen,
    pickBehavior: pickBehavior,
  };
  if (typeof window !== 'undefined') { var Y = (window.Yasia = window.Yasia || {}); Y.behavior = api; }
  if (typeof module !== 'undefined' && module.exports) module.exports = api;   // node (юнит-тесты)
})();
