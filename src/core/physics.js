// Чистые функции физики платформера — ПЕРВЫЙ шаг выноса платформера из pet.js (v0.1 роадмапа).
// Без состояния и DOM: только геометрия «полок» (ledges). Благодаря этому файл грузится и в браузере
// (window.Yasia.physics, манифест ставит его до pet.js), и в node для юнит-тестов (tests/physics.test.js).
// Параметры физики передаются аргументом p = { W: ширина питомца, dx: PLAT_JUMP_DX, up: PLAT_JUMP_UP } —
// pet.js подставляет свои текущие значения (они меняются с размером героя).
(() => {
  'use strict';

  // достижим ли прыжок с полки A на полку B (вверх/вбок/вниз, в пределах физики прыжка).
  // Полка: { x1, x2, y } (вьюпорт-координаты, y — верхняя грань). Вниз можно глубоко (падением, до 4×up),
  // вверх — не выше up; по горизонтали ограничен разрыв между «стоячими» зонами (hgap <= dx).
  function ledgeJumpable(A, B, p) {
    const W = p.W;
    const aMinC = A.x1 + W / 2, aMaxC = A.x2 - W / 2, bMinC = B.x1 + W / 2, bMaxC = B.x2 - W / 2;
    if (aMaxC < aMinC || bMaxC < bMinC) return false;                       // слишком узкая, чтобы встать
    const hgap = Math.max(0, Math.max(aMinC, bMinC) - Math.min(aMaxC, bMaxC));   // мин. горизонт. разрыв между «стоячими» зонами
    if (hgap > p.dx) return false;                                          // не дотянуться вбок
    const dy = A.y - B.y;                                                   // >0 — B выше
    return dy <= p.up && dy >= -p.up * 4;                                   // вверх — в пределах прыжка; вниз — свободно (падением)
  }

  const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

  // позиция на дуге баллистического прыжка: линейная интерполяция + синус-горб высотой peak. k = фаза [0..1]
  function jumpArcPos(fromX, fromY, toX, toY, peak, k) {
    return { x: fromX + (toX - fromX) * k, y: (fromY + (toY - fromY) * k) - Math.sin(Math.PI * k) * peak };
  }
  // высота горба: дуга всегда выше обеих точек (для прыжков вверх/вбок)
  function jumpPeakFor(fromY, toY) { return Math.max(46, (fromY - toY) + 50); }
  // спуск на блок заметно НИЖЕ — падение под гравитацией, а не дуга
  function isDropJump(fromY, toY, up) { return (toY - fromY) > up * 0.6; }

  // полка из DOM-прямоугольника (или null): фильтры размера/положения/«широкий контейнер».
  // r = {left, right, top, width, height}; hasInner() зовётся ЛЕНИВО только для широковатых элементов
  // (в pet.js это el.querySelector — дорого на каждый элемент).
  function ledgeFromRect(r, vw, vh, petWpx, hasInner) {
    if (r.width < 44 || r.height < 14) return null;
    if (r.top < 6 || r.top > vh - 10) return null;
    const x1 = Math.max(4, r.left), x2 = Math.min(vw - 4, r.right);
    if (x2 - x1 < Math.max(40, petWpx * 0.8)) return null;          // узкая для хитбокса — не встать
    if (x2 - x1 > vw * 0.40) return null;                           // почти на весь экран — контейнер/фон, не «полка»
    if (x2 - x1 > vw * 0.22 && hasInner && hasInner()) return null; // широковатая ОБЁРТКА с блоками внутри: её box лезет в пустоту между ними
    return { x1, x2, y: Math.round(r.top) };
  }

  // кандидаты для свободного прыжка по блокам (tryClimb): достижимые полки со взвешиванием.
  // p = { W, dx, up, minY: полки выше — за верхом экрана, lastLeftEl: анти-пинг-понг }. cx — центр питомца.
  function climbCandidates(ledges, stand, cx, p) {
    const out = [];
    for (const L of ledges) {
      if (L === stand || L.y < p.minY) continue;
      if (!ledgeJumpable(stand, L, p)) continue;
      const tgtX = clamp(cx, L.x1 + p.W / 2, L.x2 - p.W / 2);
      const horiz = Math.abs(tgtX - cx), drop = Math.max(0, L.y - stand.y);
      if (horiz > p.dx) continue;                                   // реальная горизонталь прыжка от ТЕКУЩЕЙ позиции (не только разрыв полок)
      let w = 1 / (1 + horiz / p.dx);                               // ближе по горизонтали — охотнее
      if (drop > p.up) w *= 1 / (1 + (drop - p.up) / (p.up * 2));   // далёкий спуск возможен, но реже
      if (L.el && p.lastLeftEl && L.el === p.lastLeftEl) w *= 0.22; // не скакать сразу обратно
      if (L.floor) w *= 0.55;                                       // на пол спрыгивает реже
      out.push({ L, tgtX, w });
    }
    return out;
  }

  const api = { ledgeJumpable, jumpArcPos, jumpPeakFor, isDropJump, ledgeFromRect, climbCandidates };
  if (typeof window !== 'undefined') { const Y = (window.Yasia = window.Yasia || {}); Y.physics = api; }   // браузер (content script)
  if (typeof module !== 'undefined' && module.exports) module.exports = api;                               // node (юнит-тесты)
})();
