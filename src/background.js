// Фоновый worker: при установке/обновлении расширения внедряет свежего питомца
// во ВСЕ уже открытые вкладки (новые загрузки страниц подхватываются content_scripts
// автоматически). Так «один питомец на все вкладки» работает без ручной перезагрузки.

const CSS = ['src/pet.css'];
const JS = ['src/core/config.js', 'src/core/storage.js', 'src/core/events.js', 'src/pet.js'];

function removeOld() {
  const r = document.getElementById('twtr-pet-root');
  if (r) r.remove();   // убрать старого «зомби», иначе guard не даст создать нового
}

function injectAll() {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (!tab.id || !/^https?:/i.test(tab.url || '')) continue;   // только обычные сайты
      const tabId = tab.id;
      chrome.scripting.executeScript({ target: { tabId }, func: removeOld })
        .then(() => chrome.scripting.insertCSS({ target: { tabId }, files: CSS }).catch(() => {}))
        .then(() => chrome.scripting.executeScript({ target: { tabId }, files: JS }))
        .catch(() => {});
    }
  });
}

chrome.runtime.onInstalled.addListener(injectAll);

// ---------- скачивание видео со страницы (по запросу из pet.js) ----------
function sanitizeName(n) {
  let s = String(n || 'video').replace(/[\\/:*?"<>| -]+/g, '_').replace(/^\.+/, '').slice(0, 150) || 'video';
  if (!/\.(mp4|webm|mov|m4v)$/i.test(s)) s += '.mp4';   // всегда видеорасширение (иначе Chrome по html-телу делает .txt)
  return s;
}

let dnrRuleId = 9100;
async function setRefererRule(referer, host) {
  dnrRuleId = dnrRuleId >= 9180 ? 9100 : dnrRuleId + 1;
  const id = dnrRuleId;
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [id],
      addRules: [{
        id, priority: 1,
        action: { type: 'modifyHeaders', requestHeaders: [
          { header: 'referer', operation: 'set', value: referer },
          { header: 'origin', operation: 'set', value: referer.replace(/\/$/, '') },
        ] },
        condition: { urlFilter: '||' + host + '/', resourceTypes: ['xmlhttprequest', 'media', 'other'] },
      }],
    });
  } catch (_) {}
  return id;
}

// читаем только первые maxBytes тела (даже если сервер проигнорировал Range и шлёт весь файл) — без загрузки гигабайтов в память
async function readFirstBytes(resp, maxBytes) {
  if (!resp.body || !resp.body.getReader) { const ab = await resp.arrayBuffer(); return new Uint8Array(ab.slice(0, maxBytes)); }
  const reader = resp.body.getReader();
  const chunks = []; let got = 0;
  try { while (got < maxBytes) { const r = await reader.read(); if (r.done) break; chunks.push(r.value); got += r.value.length; } } catch (_) {}
  try { reader.cancel(); } catch (_) {}
  const out = new Uint8Array(Math.min(got, maxBytes)); let o = 0;
  for (const c of chunks) { if (o >= out.length) break; const n = Math.min(c.length, out.length - o); out.set(c.subarray(0, n), o); o += n; }
  return out;
}

// лёгкая проверка «это видео, а не html/текст» (заголовок + первые байты через Range, БЕЗ загрузки всего файла).
// Возвращает суммарный размер файла (0 = неизвестен). Бросает, если это не видео.
async function probeVideo(url, withCreds) {
  const resp = await fetch(url, { credentials: withCreds ? 'include' : 'omit', headers: { Range: 'bytes=0-65535' } });
  if (!resp.ok && resp.status !== 206) throw new Error('сервер ответил ' + resp.status + ' — ссылка устарела/недоступна; открой страницу самого видео');
  const ct = (resp.headers.get('content-type') || '').toLowerCase();
  if (ct.indexOf('text/html') !== -1 || ct.indexOf('json') !== -1 || ct.indexOf('text/plain') !== -1 || ct.indexOf('xml') !== -1) {
    try { resp.body && resp.body.cancel(); } catch (_) {}
    throw new Error('пришла страница, а не видео — ссылка не отдала видеофайл (для YouTube возможен троттлинг, попробуй ещё раз или другой ролик)');
  }
  let total = 0;                                              // суммарный размер: из Content-Range (206) или Content-Length (200)
  const cr = resp.headers.get('content-range'); if (cr) { const mm = cr.match(/\/(\d+)\s*$/); if (mm) total = +mm[1]; }
  if (!total && resp.status === 200) total = +(resp.headers.get('content-length') || 0);
  if (ct.indexOf('video/') === 0) { try { resp.body && resp.body.cancel(); } catch (_) {} return total; }  // явно видео — тело не читаем
  // content-type пустой/общий (octet-stream/бинарный) -> проверяем сигнатуру: MP4 'ftyp' или WebM/EBML
  const h = await readFirstBytes(resp, 64);
  const isMp4 = h.length >= 12 && h[4] === 0x66 && h[5] === 0x74 && h[6] === 0x79 && h[7] === 0x70;          // ....ftyp
  const isWebm = h.length >= 4 && h[0] === 0x1A && h[1] === 0x45 && h[2] === 0xDF && h[3] === 0xA3;          // EBML
  if (!isMp4 && !isWebm) throw new Error('пришёл не видеофайл');
  return total;
}

// в MV3 service worker нет URL.createObjectURL -> для НЕБОЛЬШИХ файлов делаем самодостаточный data:URL через base64
async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = ''; const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return 'data:' + (blob.type || 'video/mp4') + ';base64,' + btoa(binary);
}
const MAX_INLINE = 30 * 1024 * 1024;   // <=30МБ — надёжный self-contained data:URL; крупнее — прямая загрузка (без OOM)

// держим DNR-правило (подмена Referer) живым до конца загрузки — Referer нужен и самому download-запросу
function keepRuleUntilDone(downloadId, ruleId) {
  const drop = () => { try { chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] }); } catch (_) {} };
  const onChanged = (delta) => {
    if (delta.id !== downloadId || !delta.state) return;
    if (delta.state.current === 'complete' || delta.state.current === 'interrupted') {
      chrome.downloads.onChanged.removeListener(onChanged); drop();
    }
  };
  chrome.downloads.onChanged.addListener(onChanged);
}

async function downloadVideo(msg) {
  let ruleId = null;
  try {
    if (msg.referer) {                                   // TikTok/IG — CDN требует Referer/cookie -> подмена через DNR
      let host = '';
      try { host = new URL(msg.url).hostname; } catch (_) {}
      if (host) ruleId = await setRefererRule(msg.referer, host);
    }
    if (msg.referer || msg.validate) {
      const total = await probeVideo(msg.url, !!msg.referer);   // проверяем «это видео» + узнаём размер (иначе сохранился бы .txt/.htm)
      if (total && total <= MAX_INLINE) {
        // НАДЁЖНЫЙ путь для коротких роликов: тянем целиком в SW (Referer применён DNR на fetch) и отдаём самодостаточный data:URL,
        // чтобы загрузка не зависела от того, действует ли DNR на сам download-запрос
        const resp = await fetch(msg.url, { credentials: msg.referer ? 'include' : 'omit' });
        if (!resp.ok) throw new Error('сервер ответил ' + resp.status + ' — ссылка устарела/недоступна');
        const blob = await resp.blob();
        if (!blob || blob.size < 4096) throw new Error('пустой ответ — видео не отдалось');
        const dataUrl = await blobToDataUrl(blob);
        const id = await chrome.downloads.download({ url: dataUrl, filename: sanitizeName(msg.filename), saveAs: false });
        if (ruleId) { try { await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] }); } catch (_) {} }
        return { ok: true, id, size: blob.size };
      }
      // крупный/неизвестного размера ролик — НЕ материализуем (иначе OOM), качаем напрямую (DNR держим до конца загрузки)
    }
    const id = await chrome.downloads.download({ url: msg.url, filename: sanitizeName(msg.filename), saveAs: false });
    if (ruleId) { keepRuleUntilDone(id, ruleId); ruleId = null; }   // правило снимет keepRuleUntilDone по завершении (не finally)
    return { ok: true, id };
  } catch (e) {
    if (ruleId) { try { await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] }); } catch (_) {} }
    return { ok: false, error: String((e && e.message) || e) };
  }
}

// запрос текста по URL. Может ходить с куками пользователя (credentials) и доп.заголовками —
// нужно для Instagram media-API (X-IG-App-ID + сессия) и TikTok SSR по точной ссылке.
async function fetchText(msg) {
  const url = typeof msg === 'string' ? msg : (msg && msg.url);
  const opts = { credentials: (msg && msg.credentials === 'include') ? 'include' : 'omit' };
  if (msg && msg.headers && typeof msg.headers === 'object') opts.headers = msg.headers;
  try {
    const r = await fetch(url, opts);
    if (!r.ok) return { ok: false, error: 'HTTP ' + r.status, status: r.status };
    return { ok: true, text: await r.text() };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;
  if (msg.type === 'YASIA_DOWNLOAD') { downloadVideo(msg).then(sendResponse); return true; }
  if (msg.type === 'YASIA_FETCH') { fetchText(msg).then(sendResponse); return true; }
});
