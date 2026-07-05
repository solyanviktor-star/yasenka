// Калькулятор Яси: безопасный разбор арифметики БЕЗ eval (рекурсивный спуск).
// ЧИСТЫЕ функции (без DOM) -> тестируются в node (tests/calc.test.js), как physics/behavior.
// Умеет: + - * / ^ (степень, правоассоц.), скобки, унарный минус, запятую как десятичную,
// пробелы/подчёркивания как разделители разрядов и «человеческие» проценты:
//   200 + 10%  = 220   (процент ОТ левого операнда при +/-)
//   200 * 10%  = 20    (при */ процент — просто /100)
//   50%        = 0.5
(function () {
  'use strict';

  function tokenize(src) {
    const s = String(src || '').replace(/[\s_]/g, '').replace(/,/g, '.').replace(/[×х]/g, '*').replace(/[÷:]/g, '/');
    const toks = [];
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c >= '0' && c <= '9' || c === '.') {
        let j = i;
        while (j < s.length && (s[j] >= '0' && s[j] <= '9' || s[j] === '.')) j++;
        const num = s.slice(i, j);
        if ((num.match(/\./g) || []).length > 1) return null;   // «1.2.3» — мусор
        toks.push({ t: 'num', v: parseFloat(num) });
        i = j;
      } else if ('+-*/^()%'.indexOf(c) >= 0) {
        toks.push({ t: c });
        i++;
      } else return null;   // незнакомый символ — не выражение (пусть с этим разбирается ИИ-чат)
    }
    return toks;
  }

  // Грамматика: expr := term (('+'|'-') term)* ; term := pow (('*'|'/') pow)* ;
  // pow := unary ('^' pow)? ; unary := '-' unary | primary '%'* ; primary := num | '(' expr ')'
  // Узел: {v: number, pct: bool} — pct раскрывается в контексте оператора (см. шапку).
  function parse(toks) {
    let p = 0;
    const peek = () => toks[p];
    const eat = (t) => (toks[p] && toks[p].t === t ? (p++, true) : false);

    function primary() {
      const tk = peek();
      if (!tk) return null;
      if (tk.t === 'num') { p++; return { v: tk.v, pct: false }; }
      if (eat('(')) {
        const e = expr();
        if (!e || !eat(')')) return null;
        return e;
      }
      return null;
    }
    function unary() {
      if (eat('-')) { const u = unary(); return u ? { v: -u.v, pct: u.pct } : null; }
      if (eat('+')) return unary();
      let n = primary();
      while (n && eat('%')) n = { v: n.v / 100, pct: true };   // 10% -> 0.1 с пометкой «процент»
      return n;
    }
    function pow() {
      const base = unary();
      if (!base) return null;
      if (eat('^')) {
        const e = pow();   // правоассоциативно: 2^3^2 = 2^9
        if (!e) return null;
        return { v: Math.pow(base.v, e.v), pct: false };
      }
      return base;
    }
    function term() {
      let n = pow();
      while (n) {
        if (eat('*')) { const r = pow(); if (!r) return null; n = { v: n.v * r.v, pct: false }; }
        else if (eat('/')) { const r = pow(); if (!r) return null; if (r.v === 0) return { err: 'div0' }; n = { v: n.v / r.v, pct: false }; }
        else break;
        if (n && n.err) return n;
      }
      return n;
    }
    function expr() {
      let n = term();
      while (n && !n.err) {
        if (eat('+')) { const r = term(); if (!r) return null; if (r.err) return r; n = { v: r.pct ? n.v + n.v * r.v : n.v + r.v, pct: false }; }
        else if (eat('-')) { const r = term(); if (!r) return null; if (r.err) return r; n = { v: r.pct ? n.v - n.v * r.v : n.v - r.v, pct: false }; }
        else break;
      }
      return n;
    }

    const out = expr();
    if (!out || out.err || p !== toks.length) return out && out.err ? out : null;   // хвост не дожёван = синтаксис битый
    return out;
  }

  // Формат: до 12 значащих, без хвостовых нулей, огромное/крошечное — экспонентой.
  function fmt(v) {
    if (!isFinite(v)) return null;
    if (v === 0) return '0';
    const a = Math.abs(v);
    if (a >= 1e15 || a < 1e-9) return v.toExponential(6).replace(/\.?0+e/, 'e');
    let s = v.toPrecision(12);
    if (s.indexOf('.') >= 0) s = s.replace(/\.?0+$/, '');
    return s;
  }

  // Публичный вход: строка -> { ok, value, text } | { ok:false, error:'empty'|'syntax'|'div0' }
  function calcEval(src) {
    const raw = String(src || '').trim();
    if (!raw) return { ok: false, error: 'empty' };
    if (!/\d/.test(raw)) return { ok: false, error: 'empty' };   // без цифр считать нечего
    const toks = tokenize(raw);
    if (!toks || !toks.length) return { ok: false, error: 'syntax' };
    const n = parse(toks);
    if (n && n.err === 'div0') return { ok: false, error: 'div0' };
    if (!n) return { ok: false, error: 'syntax' };
    const text = fmt(n.v);
    if (text == null) return { ok: false, error: 'syntax' };
    return { ok: true, value: n.v, text };
  }

  const pure = { calcEval, tokenize };
  if (typeof module !== 'undefined' && module.exports) module.exports = pure;   // node (юнит-тесты)
  if (typeof window !== 'undefined') { window.Yasia = window.Yasia || {}; window.Yasia.calc = pure; }
})();
