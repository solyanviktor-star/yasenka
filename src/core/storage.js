// Единый шлюз к chrome.storage — все чтения/записи состояния Яси идут через window.Yasia.storage.
// Тонкие обёртки 1:1 над sync/local + общий guard на «жив ли контекст расширения».
// Грузится перед pet.js. Колбэки сохранены (как в chrome.storage), чтобы поведение не менялось.
(() => {
  'use strict';
  const Yasia = (window.Yasia = window.Yasia || {});
  const sync = (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) || null;
  const local = (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) || null;
  Yasia.storage = {
    alive() { try { return !!(chrome.runtime && chrome.runtime.id); } catch (_) { return false; } },
    syncGet(defaults, cb) { try { sync.get(defaults, cb); } catch (_) { if (cb) cb(defaults || {}); } },
    syncSet(obj) { try { sync.set(obj); } catch (_) {} },
    localGet(defaults, cb) { try { local.get(defaults, cb); } catch (_) { if (cb) cb(defaults || {}); } },
    localSet(obj) { try { local.set(obj); } catch (_) {} },
    onChanged(cb) { try { chrome.storage.onChanged.addListener(cb); } catch (_) {} },
  };
})();
