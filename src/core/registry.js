// Реестр систем (плагинов). Каждая система регистрируется ОДНА в своём файле и НЕ знает про другие —
// общается через шину Yasia.events. Это и есть «добавлять фичи независимо».
// boot() стартует только те системы, чей флаг включён; если система падает на init — её флаг гасится,
// а питомец продолжает работать («отключать сломанные», без каскадного падения).
// Грузится перед системами и pet.js -> window.Yasia.systems.
(() => {
  'use strict';
  const Yasia = (window.Yasia = window.Yasia || {});
  const defs = new Map();   // name -> { name, flag, init, destroy, started, instance }

  Yasia.systems = {
    register(def) {
      if (!def || !def.name) return;
      defs.set(def.name, Object.assign({ flag: def.name, init() {}, destroy: null, started: false, instance: null }, def));
    },
    get(name) { return defs.get(name); },
    list() { return [...defs.keys()]; },
    isStarted(name) { const d = defs.get(name); return !!(d && d.started); },

    boot(ctx) {                                      // стартуем все включённые флагом системы
      this._ctx = ctx;
      for (const name of defs.keys()) this.start(name, ctx);
    },
    start(name, ctx) {
      const def = defs.get(name);
      if (!def || def.started) return false;
      ctx = ctx || this._ctx || {};
      const fl = Yasia.flags;
      if (fl && def.flag && !fl.enabled(def.flag)) return false;   // выключена флагом — не стартуем
      try {
        def.instance = def.init(ctx) || true;
        def.started = true;
        try { Yasia.events && Yasia.events.emit('system:started', { name }); } catch (_) {}
        return true;
      } catch (e) {                                  // СЛОМАНА -> гасим флаг, не роняем остальное
        if (fl && def.flag) fl.disable(def.flag, 'init failed: ' + ((e && e.message) || e));
        try { console.warn('[Yasia] система «' + name + '» упала на init -> отключена:', e); } catch (_) {}
        try { Yasia.events && Yasia.events.emit('system:failed', { name, error: String((e && e.message) || e) }); } catch (_) {}
        return false;
      }
    },
    stop(name) {
      const def = defs.get(name);
      if (!def || !def.started) return;
      try { if (typeof def.destroy === 'function') def.destroy(def.instance); } catch (_) {}
      def.started = false; def.instance = null;
      try { Yasia.events && Yasia.events.emit('system:stopped', { name }); } catch (_) {}
    },

    // реакция на смену флага в рантайме: включили -> старт, выключили -> стоп. core подключает один раз.
    watchFlags() {
      if (this._watching || !Yasia.events) return;
      this._watching = true;
      Yasia.events.on('flags:changed', ({ name, on }) => {
        for (const def of defs.values()) {
          if (def.flag !== name) continue;
          if (on) this.start(def.name); else this.stop(def.name);
        }
      });
    },
  };
})();
