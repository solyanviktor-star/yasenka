// Загрузчик манифестов героев. Делает анимации ДАННЫМИ: каждый герой описан в
// src/heroes/<id>/manifest.json (id/name/width/height + animations{name:{fps,loop,pingpong,frames[]}}).
// Грузится перед pet.js -> window.Yasia.heroes. pet.js берёт раскладку кадров/тайминги ИЗ манифеста,
// поэтому добавить эмоцию/скин/персонажа = правка json + спрайты, без правки логики.
// Манифест должен быть в web_accessible_resources (manifest.json), иначе fetch не пройдёт -> pet.js откатится
// на старую папочную конвенцию (поведение не ломается).
(() => {
  'use strict';
  const Yasia = (window.Yasia = window.Yasia || {});
  const cache = {};   // id -> манифест (или null, если не загрузился)

  Yasia.heroes = {
    get(id) { return cache[id] || null; },
    load(id, cb) {
      if (Object.prototype.hasOwnProperty.call(cache, id)) { if (cb) cb(cache[id]); return; }
      let url = '';
      try { url = chrome.runtime.getURL('src/heroes/' + id + '/manifest.json'); } catch (_) {}
      if (!url || typeof fetch !== 'function') { cache[id] = null; if (cb) cb(null); return; }
      fetch(url)
        .then((r) => (r && r.ok ? r.json() : null))
        .then((m) => { cache[id] = (m && m.animations) ? m : null; if (cb) cb(cache[id]); })
        .catch(() => { cache[id] = null; if (cb) cb(null); });
    },
  };
})();
