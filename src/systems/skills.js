// Навыки Яси (v1.2) — самообучение «как у Hermes», но провайдеро-независимое (работает и на GPT).
// Навык = ПЛЕЙБУК-инструкция: { name, when (когда применять), playbook (шаги), ver, uses }.
// Жизненный цикл (ведёт ai.js): создание — пользователь («выучи навык: …») или САМА после задачи
// (рефлексия в learnFrom: «была ли переиспользуемая процедура?»); применение — релевантный навык
// подмешивается в промпт задачи; докрутка — «улучши навык X: …» переписывает плейбук (ver++).
// Исполняемые навыки (код/файлы/поиск) — это серверные навыки Hermes, здесь их нет принципиально.
// Хранилище — chrome.storage.local (локально). Падение тут гасит флаг 'skills' — питомец живёт.
(() => {
  'use strict';
  const Yasia = (window.Yasia = window.Yasia || {});
  if (!Yasia.systems) return;

  const KEY = 'yasiaSkills', MAX = 30;

  Yasia.systems.register({
    name: 'skills',
    flag: 'skills',
    init(ctx) {
      const storage = (ctx && ctx.storage) || Yasia.storage;
      let list = [];
      const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
      const tokens = (s) => norm(s).split(/[^a-zа-яё0-9]+/i).filter((w) => w.length > 2);
      const uid = () => 's' + Date.now().toString(36) + Math.floor(Math.random() * 1e5).toString(36);
      const save = () => { try { storage.localSet({ [KEY]: list }); } catch (_) {} };
      try { storage.localGet({ [KEY]: [] }, (s) => { if (Array.isArray(s && s[KEY])) list = s[KEY]; }); } catch (_) {}

      function add(sk) {
        const name = String((sk && sk.name) || '').slice(0, 60).trim();
        const when = String((sk && sk.when) || '').slice(0, 160).trim();
        const playbook = String((sk && sk.playbook) || '').slice(0, 1200).trim();
        if (name.length < 3 || playbook.length < 10) return null;
        const nn = norm(name);
        const ex = list.find((x) => norm(x.name) === nn);
        if (ex) { if (when) ex.when = when; ex.playbook = playbook; ex.ver = (ex.ver || 1) + 1; ex.updatedAt = Date.now(); save(); return ex; }   // одноимённый -> обновление (докрутка)
        const it = { id: uid(), name, when, playbook, ver: 1, uses: 0, updatedAt: Date.now() };
        list.push(it); if (list.length > MAX) list = list.slice(-MAX);
        save(); return it;
      }
      function find(q, limit) {   // релевантные навыки по токенам (имя + «когда применять»)
        const qt = tokens(q); if (!qt.length) return [];
        return list.map((s) => { const hay = norm(s.name + ' ' + s.when); let sc = 0; for (const w of qt) if (hay.indexOf(w) !== -1) sc++; return { s, sc }; })
          .filter((x) => x.sc > 0).sort((a, b) => b.sc - a.sc || b.s.updatedAt - a.s.updatedAt).slice(0, limit || 1).map((x) => x.s);
      }
      const byName = (name) => { const nn = norm(name); return list.find((x) => norm(x.name) === nn) || find(name, 1)[0] || null; };

      Yasia.skills = {
        list: () => list.slice(), add, find, byName,
        used: (id) => { const s = list.find((x) => x.id === id); if (s) { s.uses = (s.uses || 0) + 1; save(); } },
        remove: (id) => { list = list.filter((x) => x.id !== id); save(); },
      };
      return { destroy() { if (Yasia.skills) try { delete Yasia.skills; } catch (_) { Yasia.skills = null; } } };
    },
    destroy(inst) { if (inst && inst.destroy) inst.destroy(); },
  });
})();
