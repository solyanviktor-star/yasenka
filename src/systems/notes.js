// Система «Заметки» — первая вынесенная из монолита pet.js (эталон плагина).
// Самодостаточна: хранит заметки в Yasia.storage (yasiaNotes), рендерит в #twtr-dlg-list,
// добавляет из #twtr-dlg-text. С pet.js общается ТОЛЬКО через шину: слушает 'notes:render' и 'notes:add'.
// Стартует реестр (registry.js) при флаге notes; падение тут не роняет питомца, флаг гасится.
(() => {
  'use strict';
  const Yasia = (window.Yasia = window.Yasia || {});
  if (!Yasia.systems) return;

  // экранируем И кавычки: linkify кладёт URL в href="..." через конкатенацию; без &quot; текст с кавычкой (напр. сохранённое из меню выделение) рвёт атрибут -> инъекция обработчика (XSS)
  function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function linkify(s) { return escHtml(s).replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'); }

  Yasia.systems.register({
    name: 'notes',
    init(ctx) {
      const root = ctx.root;
      const storage = ctx.storage || Yasia.storage;
      const tr = ctx.tr || (() => ({}));
      const list = root.querySelector('#twtr-dlg-list');
      const text = root.querySelector('#twtr-dlg-text');
      let notes = [];

      const save = () => storage.localSet({ yasiaNotes: notes });
      function render() {
        if (!list) return;
        const t = tr() || {};
        if (!notes.length) { list.innerHTML = `<div class="twtr-dlg-empty">${t.empty || ''}</div>`; return; }
        list.innerHTML = notes.map((n) =>
          `<div class="twtr-dlg-note"><span>${linkify(n.text)}</span><button class="twtr-dlg-note-del" data-del="${n.id}" type="button" title="Удалить">✕</button></div>`).join('');
      }
      // explicit задан (напр. из меню выделения 'notes:add' {text}) -> сохраняем его; иначе берём из поля ввода
      function add(explicit) {
        const v = (explicit != null ? String(explicit) : (text ? text.value : '')).trim(); if (!v) return;
        notes.unshift({ id: String(Date.now()) + Math.floor(Math.random() * 1000), text: v });
        save(); render(); if (explicit == null && text) text.value = '';
      }
      // удаление — один делегированный обработчик на список (а не пере-навешивание на каждый рендер)
      const onDel = (e) => {
        const b = e.target.closest && e.target.closest('[data-del]'); if (!b) return;
        e.stopPropagation();
        const id = b.getAttribute('data-del');
        notes = notes.filter((n) => n.id !== id); save(); render();
      };
      if (list) list.addEventListener('click', onDel);

      const off1 = Yasia.events.on('notes:render', render);
      const off2 = Yasia.events.on('notes:add', (p) => add(p && typeof p === 'object' ? p.text : undefined));
      storage.localGet({ yasiaNotes: [] }, (s) => { notes = Array.isArray(s.yasiaNotes) ? s.yasiaNotes : []; render(); });

      return {
        render, add,
        destroy() { off1(); off2(); if (list) list.removeEventListener('click', onDel); },
      };
    },
    destroy(inst) { if (inst && inst.destroy) inst.destroy(); },
  });
})();
