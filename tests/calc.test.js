// Юнит-тесты калькулятора (core/calc.js): чистый парсер без eval.
const test = require('node:test');
const assert = require('node:assert');
const { calcEval } = require('../src/core/calc.js');

const val = (s) => { const r = calcEval(s); assert.equal(r.ok, true, s + ' -> ' + JSON.stringify(r)); return r.value; };
const err = (s) => { const r = calcEval(s); assert.equal(r.ok, false, s + ' должен быть ошибкой'); return r.error; };

test('база: приоритеты, скобки, унарный минус', () => {
  assert.equal(val('2+2*2'), 6);
  assert.equal(val('(2+2)*2'), 8);
  assert.equal(val('-5+3'), -2);
  assert.equal(val('2*-3'), -6);
  assert.equal(val('10/4'), 2.5);
});

test('степень: правоассоциативная, с унарным минусом', () => {
  assert.equal(val('2^10'), 1024);
  assert.equal(val('2^3^2'), 512);       // 2^(3^2), не (2^3)^2
  assert.equal(val('-2^2'), 4);          // унарный минус связывает раньше: (-2)^2
});

test('проценты по-человечески: от левого при +/-, /100 при */', () => {
  assert.equal(val('200+10%'), 220);
  assert.equal(val('200-10%'), 180);
  assert.equal(val('200*10%'), 20);
  assert.equal(val('50%'), 0.5);
  assert.equal(val('200+10%+10%'), 242); // последовательно: 220 + 10% от 220
});

test('запятая как десятичная, пробелы/подчёркивания как разряды, × ÷', () => {
  assert.equal(val('1,5+1.5'), 3);
  assert.equal(val('1 000 000 / 4'), 250000);
  assert.equal(val('1_000+24'), 1024);
  assert.equal(val('3×4'), 12);
  assert.equal(val('12÷4'), 3);
});

test('ошибки: пусто, мусор, битый синтаксис, деление на ноль', () => {
  assert.equal(err(''), 'empty');
  assert.equal(err('привет'), 'empty');       // без цифр — не выражение (уйдёт в ИИ-чат)
  assert.equal(err('2++'), 'syntax');
  assert.equal(err('(2+3'), 'syntax');
  assert.equal(err('1.2.3'), 'syntax');
  assert.equal(err('5/0'), 'div0');
  assert.equal(err('2 alert(1)'), 'syntax');  // никакого исполнения кода — только арифметика
});

test('формат: хвостовые нули срезаны, крошечное/огромное — экспонентой', () => {
  assert.equal(calcEval('0.1+0.2').text, '0.3');           // классика плавающей точки причёсана toPrecision
  assert.equal(calcEval('10/4').text, '2.5');
  assert.match(calcEval('2^64').text, /^1\.844674e\+?19$/);
});
