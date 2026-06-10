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

  const api = { ledgeJumpable };
  if (typeof window !== 'undefined') { const Y = (window.Yasia = window.Yasia || {}); Y.physics = api; }   // браузер (content script)
  if (typeof module !== 'undefined' && module.exports) module.exports = api;                               // node (юнит-тесты)
})();
