// Feature-флаги — что включено/выключено. Цель этапа v0.5: добавлять фичи независимо и ОТКЛЮЧАТЬ сломанные.
// Грузится перед pet.js -> window.Yasia.flags. Значения сохраняются в chrome.storage.sync (yasiaFlags),
// так что выбор переживает перезагрузку и синхронизируется между вкладками/устройствами.
// Системы спрашивают Yasia.flags.enabled('<имя>'); реестр (registry.js) сам гасит флаг упавшей системы.
(() => {
  'use strict';
  const Yasia = (window.Yasia = window.Yasia || {});
  const DEFAULTS = Object.freeze({
    tamagotchi: true,      // голод/энергия/настроение/XP
    mediaDownload: true,   // скачивание видео со страницы
    notes: true,           // заметки и ссылки
    aiAssistant: true,     // ИИ-мозг v0.8 (Hermes Agent): меню по выделению, «спроси», панель ИИ. Активен, но «думает» лишь когда задан адрес+ключ Hermes
    memory: true,          // память v1.1: модель пользователя (факты/преференции) + журнал посещённых сайтов; провайдеро-независима (Hermes/GPT)

    games: true,           // мини-игры (v0.7): догонялки/ловля еды/зомби-лучник/прятки
    zombies: false,        // мини-игра «зомби» (план)
    bowGame: false,        // мини-игра «лук» (план)
  });
  let cur = Object.assign({}, DEFAULTS);

  Yasia.flags = {
    DEFAULTS,
    all() { return Object.assign({}, cur); },
    enabled(name) { return !!cur[name]; },
    set(name, on) {
      if (!(name in DEFAULTS)) return false;        // неизвестный флаг игнорируем
      if (cur[name] === !!on) return true;
      cur[name] = !!on;
      try { Yasia.storage && Yasia.storage.syncSet({ yasiaFlags: Object.assign({}, cur) }); } catch (_) {}
      try { Yasia.events && Yasia.events.emit('flags:changed', { name, on: !!on, all: Object.assign({}, cur) }); } catch (_) {}
      return true;
    },
    disable(name, reason) {                          // «отключить сломанную» (вызывает реестр при падении системы)
      const ok = this.set(name, false);
      if (ok) try { Yasia.events && Yasia.events.emit('flags:disabled', { name, reason: reason || '' }); } catch (_) {}
      return ok;
    },
    // подтянуть сохранённый выбор (async). core вызывает в boot ДО старта систем.
    load(cb) {
      try {
        Yasia.storage.syncGet({ yasiaFlags: null }, (s) => {
          if (s && s.yasiaFlags && typeof s.yasiaFlags === 'object') cur = Object.assign({}, DEFAULTS, s.yasiaFlags);
          if (cb) cb(Object.assign({}, cur));
        });
      } catch (_) { if (cb) cb(Object.assign({}, cur)); }
    },
  };
})();
