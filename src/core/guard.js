// СТРАЖ (v0.9 «Безопасность и контроль») — центральные правила: расширение НЕ делает опасных действий само.
// Железные правила (зашиты здесь, обходить нельзя):
//   • социальные действия (лайк/фоллоу/коммент) и удаления — ТОЛЬКО через confirm() пользователя;
//     сейчас таких авто-действий в коде нет вообще — любой будущий код обязан идти через guard.confirm();
//   • массовые скачивания — подтверждение при превышении темпа (и всегда в безопасном режиме);
//   • текст страницы в ИИ — только с предупреждением (ai.js спрашивает разрешение на каждый новый сайт).
// РЕЖИМЫ гейтят только АВТОНОМНОЕ поведение; явные клики пользователя работают всегда (кроме ИИ в safe).
// Матрица — чистые данные (тестируется в node, tests/guard.test.js). Режим хранится в storage.sync (yasiaMode).
(() => {
  'use strict';

  const MODES = ['game', 'calm', 'work', 'ai', 'safe'];
  // действие -> можно ли ему происходить САМОМУ в данном режиме
  // mischief = пакости; chatter = болтовня сама по себе; watch = сама бежит смотреть видео;
  // journal = журнал посещённых сайтов (память); ai = любые запросы к LLM (текст покидает браузер)
  const MATRIX = {
    game: { mischief: 1, chatter: 1, watch: 1, journal: 1, ai: 1 },   // игровой: всё включено
    calm: { mischief: 0, chatter: 0, watch: 1, journal: 1, ai: 1 },   // спокойный: без пакостей и болтовни
    work: { mischief: 0, chatter: 0, watch: 0, journal: 1, ai: 1 },   // рабочий: не отвлекает вообще (и к видео не бегает)
    ai:   { mischief: 0, chatter: 1, watch: 1, journal: 1, ai: 1 },   // ИИ: помощник на первом плане, без пакостей
    safe: { mischief: 0, chatter: 0, watch: 0, journal: 0, ai: 0 },   // безопасный: НИЧЕГО не уходит из браузера, журнал на паузе
  };
  const allowsIn = (mode, action) => !!((MATRIX[mode] || MATRIX.game)[action]);

  // ---------- браузерная часть (в node-тестах не выполняется) ----------
  if (typeof window !== 'undefined') {
    const Yasia = (window.Yasia = window.Yasia || {});
    let mode = 'game';
    const subs = new Set();
    const notify = () => { for (const f of [...subs]) { try { f(mode); } catch (_) {} } };
    try { Yasia.storage && Yasia.storage.syncGet({ yasiaMode: 'game' }, (s) => { if (s && MATRIX[s.yasiaMode]) { mode = s.yasiaMode; notify(); } }); } catch (_) {}
    try { Yasia.storage && Yasia.storage.onChanged((ch, area) => { if (area === 'sync' && ch && ch.yasiaMode && MATRIX[ch.yasiaMode.newValue]) { mode = ch.yasiaMode.newValue; notify(); } }); } catch (_) {}

    // подтверждение пользователя: карточка с двумя кнопками. ЕДИНСТВЕННЫЙ путь для опасных действий.
    // opts = { text, yes, no } (локализованные строки даёт вызывающий). Promise<true|false>; повторный вызов — отклоняет предыдущий.
    let curCard = null;
    function confirm(opts) {
      return new Promise((resolve) => {
        try {
          if (curCard) { try { curCard.remove(); } catch (_) {} curCard = null; }
          const host = document.getElementById('twtr-pet-root') || document.documentElement;
          const card = document.createElement('div');
          card.className = 'twtr-guard-card';
          card.innerHTML = '<div class="twtr-guard-tx"></div><div class="twtr-guard-btns"><button class="twtr-guard-no" type="button"></button><button class="twtr-guard-yes" type="button"></button></div>';
          card.querySelector('.twtr-guard-tx').textContent = String((opts && opts.text) || '');
          card.querySelector('.twtr-guard-yes').textContent = String((opts && opts.yes) || 'OK');
          card.querySelector('.twtr-guard-no').textContent = String((opts && opts.no) || '✕');
          ['mousedown', 'click'].forEach((ev) => card.addEventListener(ev, (e) => e.stopPropagation()));
          const done = (v) => { try { card.remove(); } catch (_) {} if (curCard === card) curCard = null; resolve(v); };
          card.querySelector('.twtr-guard-yes').addEventListener('click', () => done(true));
          card.querySelector('.twtr-guard-no').addEventListener('click', () => done(false));
          host.appendChild(card); curCard = card;
          setTimeout(() => { if (curCard === card) done(false); }, 45000);   // без ответа -> отказ (fail-closed)
        } catch (_) { resolve(false); }   // UI не построился -> ОТКАЗ, не «молчаливое да»
      });
    }

    // темп скачиваний: больше 3 за 2 минуты -> подтверждение; в безопасном режиме — подтверждение всегда
    const dlTimes = [];
    function needDownloadConfirm() {
      const now = Date.now();
      while (dlTimes.length && now - dlTimes[0] > 120000) dlTimes.shift();
      return mode === 'safe' || dlTimes.length >= 3;
    }

    Yasia.guard = {
      MODES: MODES.slice(),
      mode: () => mode,
      setMode: (m) => { if (!MATRIX[m]) return false; mode = m; try { Yasia.storage.syncSet({ yasiaMode: m }); } catch (_) {} notify(); return true; },
      onMode: (f) => { subs.add(f); return () => subs.delete(f); },
      allows: (action) => allowsIn(mode, action),
      confirm,
      needDownloadConfirm,
      noteDownload: () => dlTimes.push(Date.now()),
    };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { MODES, allowsIn };   // node (юнит-тесты матрицы)
})();
