// Крошечная шина событий (pub/sub) — чтобы системы (tamagotchi/animation/movement/…)
// общались, не ссылаясь друг на друга напрямую. Грузится перед pet.js -> window.Yasia.events.
// on() возвращает функцию-отписку. emit с нулём слушателей — безопасный no-op.
// По мере выноса систем из pet.js подписчики будут переезжать в свои модули.
(() => {
  'use strict';
  const Yasia = (window.Yasia = window.Yasia || {});
  const map = new Map();
  Yasia.events = {
    on(type, fn) {
      if (!map.has(type)) map.set(type, new Set());
      map.get(type).add(fn);
      return () => Yasia.events.off(type, fn);
    },
    off(type, fn) { const s = map.get(type); if (s) s.delete(fn); },
    emit(type, payload) {
      const s = map.get(type);
      if (s) for (const fn of [...s]) { try { fn(payload); } catch (_) {} }
    },
  };
})();
