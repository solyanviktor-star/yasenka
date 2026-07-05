// Фоновый worker: при установке/обновлении расширения внедряет свежего питомца
// во ВСЕ уже открытые вкладки (новые загрузки страниц подхватываются content_scripts
// автоматически). Так «один питомец на все вкладки» работает без ручной перезагрузки.

// списки берём ИЗ МАНИФЕСТА (content_scripts[0] — универсальный набор) -> единственный источник правды, не разъезжается с manifest.json
const MF_CS = (chrome.runtime.getManifest().content_scripts || [])[0] || {};
const CSS = MF_CS.css || ['src/pet.css'];
const JS = MF_CS.js || ['src/core/config.js', 'src/pet.js'];   // фолбэк на минимум, если манифест внезапно без content_scripts

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

// ---------- скачивание медиа со страницы (по запросу из pet.js) ----------
function sanitizeName(n) {
  let s = String(n || 'video').replace(/[\\/:*?"<>| -]+/g, '_').replace(/^\.+/, '').slice(0, 150) || 'video';
  if (!/\.(mp4|webm|mov|m4v|jpe?g|png|webp|gif)$/i.test(s)) s += '.mp4';   // известное медиарасширение оставляем, иначе видеодефолт (Chrome по html-телу делает .txt)
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

// ---------- лента автора по @нику через официальную синдикацию Twitter (embed-инфраструктура) ----------
// Без API-ключа и без сессии пользователя: HTML отдаёт <script id="__NEXT_DATA__"> с JSON, внутри
// props.pageProps.timeline.entries (до ~100 твитов автора). Fetch отсюда (SW), не из content script — CORS.
// ВАЖНО (проверено вживую): порядок entries НЕ гарантирован — первым может стоять закреплённый твит,
// а кэш синдикации бывает несвежим; несуществующий ник = 200 с пустым entries. Сортируем по дате сами.
async function syndTimeline(msg) {
  try {
    const handle = String((msg && msg.handle) || '').trim().replace(/^@/, '');
    if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) return { ok: false, error: 'bad handle' };
    const ctrl = new AbortController();
    const to = setTimeout(() => { try { ctrl.abort(); } catch (_) {} }, msg.timeoutMs || 15000);
    let resp;
    try { resp = await fetch('https://syndication.twitter.com/srv/timeline-profile/screen-name/' + handle, { credentials: 'omit', signal: ctrl.signal }); }
    finally { clearTimeout(to); }
    if (!resp.ok) return { ok: false, status: resp.status, error: 'HTTP ' + resp.status };
    const html = await resp.text();
    const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (!m) return { ok: false, error: 'no __NEXT_DATA__' };
    let data; try { data = JSON.parse(m[1]); } catch (_) { return { ok: false, error: 'bad json' }; }
    const entries = (((((data || {}).props || {}).pageProps || {}).timeline || {}).entries) || [];
    const posts = [];
    for (const e of entries) {
      const tw = e && e.content && e.content.tweet;                      // entries[].type всегда 'tweet'
      if (!tw || !tw.id_str) continue;
      posts.push({
        id: tw.id_str,
        text: String(tw.full_text || tw.text || ''),
        createdTs: Math.floor(Date.parse(tw.created_at || '') / 1000) || 0,   // 'Tue Jun 30 19:09:52 +0000 2026' -> сек
        isReply: !!(tw.in_reply_to_status_id_str || tw.in_reply_to_screen_name),
        isRepost: !!tw.retweeted_status || /^RT @/.test(tw.full_text || ''),  // флаг tw.retweeted при этом false — не верить ему
        url: 'https://x.com' + (tw.permalink || ('/' + handle + '/status/' + tw.id_str)),
      });
    }
    posts.sort((a, b) => b.createdTs - a.createdTs);   // новейшие вперёд (закреплённый твит больше не «самый свежий»)
    return { ok: true, posts: posts.slice(0, 30) };
  } catch (e) {
    const em = String((e && e.message) || e);
    return { ok: false, error: /abort/i.test(em) ? 'request timeout' : em };
  }
}

// ---------- ИИ-мозг v0.8: прокси к OpenAI-совместимому серверу (Hermes / OpenAI) ----------
// Запрос идёт ОТСЮДА (из service worker), а не из content script: фетч в origin расширения с host_permissions
// освобождён от CORS и mixed-content (https-страница X -> http://localhost Hermes — ок). Ключи приходят из настроек расширения.
async function aiChat(msg) {
  try {
    const base = String(msg.baseUrl || '').replace(/\/+$/, '');
    if (!base) return { ok: false, error: 'no server address' };
    const url = base + (msg.path || '/v1/chat/completions');
    const headers = { 'Content-Type': 'application/json' };
    if (msg.apiKey) headers['Authorization'] = 'Bearer ' + msg.apiKey;
    if (msg.sessionKey) headers['X-Hermes-Session-Key'] = msg.sessionKey;   // «память» Hermes между запросами (OpenAI игнорит лишний заголовок)
    let messages = msg.messages || [];
    if (msg.imageUrl) {   // мультимодал: скрин страницы -> в последнее user-сообщение (OpenAI chat-формат)
      messages = messages.slice();
      for (let i = messages.length - 1; i >= 0; i--) { if (messages[i].role === 'user') { messages[i] = { role: 'user', content: [{ type: 'text', text: String(messages[i].content || '') }, { type: 'image_url', image_url: { url: msg.imageUrl } }] }; break; } }
    }
    const body = JSON.stringify({ model: msg.model || 'hermes-agent', messages, stream: false });
    const ctrl = new AbortController();
    const to = setTimeout(() => { try { ctrl.abort(); } catch (_) {} }, msg.timeoutMs || 120000);
    let resp;
    try { resp = await fetch(url, { method: 'POST', headers, body, signal: ctrl.signal }); }
    finally { clearTimeout(to); }
    if (!resp.ok) {
      let detail = ''; try { detail = (await resp.text()).slice(0, 300); } catch (_) {}
      return { ok: false, status: resp.status, error: 'HTTP ' + resp.status + (detail ? ': ' + detail : '') };
    }
    const data = await resp.json();
    const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (typeof content !== 'string') return { ok: false, error: 'empty response' };
    return { ok: true, content };
  } catch (e) {
    const m = String((e && e.message) || e);
    return { ok: false, error: /abort/i.test(m) ? 'request timeout' : m };
  }
}
// проверка связи: GET /v1/models с ключом (есть и у Hermes, и у OpenAI)
async function aiPing(msg) {
  try {
    const base = String(msg.baseUrl || '').replace(/\/+$/, '');
    if (!base) return { ok: false, error: 'no address' };
    const headers = {}; if (msg.apiKey) headers['Authorization'] = 'Bearer ' + msg.apiKey;
    const ctrl = new AbortController();
    const to = setTimeout(() => { try { ctrl.abort(); } catch (_) {} }, 15000);
    let resp;
    try { resp = await fetch(base + '/v1/models', { headers, signal: ctrl.signal }); }
    finally { clearTimeout(to); }
    if (!resp.ok) return { ok: false, status: resp.status, error: 'HTTP ' + resp.status };
    let models = []; try { const d = await resp.json(); models = ((d && d.data) || []).map((m) => m && m.id).filter(Boolean); } catch (_) {}
    return { ok: true, models };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

// ---------- ChatGPT-подписка напрямую: device-code OAuth + Codex-бэкенд (v2.9.0) ----------
// Логин = device-code (как Hermes `hermes auth`): без localhost-сервера. Запросы к модели идут на закрытый
// codex-бэкенд (OpenAI Responses API), ПРИКИДЫВАЯСЬ Codex CLI. fetch не даёт ставить User-Agent/originator ->
// переписываем их через declarativeNetRequest (лучший шанс пройти Cloudflare; TLS-отпечаток не подделать -> возможен 403).
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const CODEX_ISSUER = 'https://auth.openai.com';
const CODEX_TOKEN_URL = CODEX_ISSUER + '/oauth/token';
const CODEX_BASE = 'https://chatgpt.com/backend-api/codex';
const CODEX_DNR_RULE_ID = 9200;

async function ensureCodexHeaderRule() {
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [CODEX_DNR_RULE_ID],
      addRules: [{
        id: CODEX_DNR_RULE_ID, priority: 1,
        condition: { urlFilter: 'https://chatgpt.com/backend-api/codex', resourceTypes: ['xmlhttprequest'] },
        action: { type: 'modifyHeaders', requestHeaders: [
          { header: 'user-agent', operation: 'set', value: 'codex_cli_rs/0.0.0 (Hermes Agent)' },
          { header: 'originator', operation: 'set', value: 'codex_cli_rs' },
        ] },
      }],
    });
  } catch (_) {}
}
ensureCodexHeaderRule();

function codexAccountId(token) {   // ChatGPT-Account-ID из claim JWT (как codex-rs auth.rs)
  try {
    const p = String(token || '').split('.'); if (p.length < 2) return '';
    let b = p[1].replace(/-/g, '+').replace(/_/g, '/'); while (b.length % 4) b += '=';
    const claims = JSON.parse(atob(b));
    return (claims['https://api.openai.com/auth'] || {}).chatgpt_account_id || '';
  } catch (_) { return ''; }
}
async function codexStart() {   // шаг 1: запрос кода устройства
  try {
    const r = await fetch(CODEX_ISSUER + '/api/accounts/deviceauth/usercode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: CODEX_CLIENT_ID }) });
    if (!r.ok) return { ok: false, error: 'HTTP ' + r.status };
    const d = await r.json();
    if (!d.user_code || !d.device_auth_id) return { ok: false, error: 'incomplete device response' };
    return { ok: true, userCode: d.user_code, deviceAuthId: d.device_auth_id, interval: Math.max(3, parseInt(d.interval || '5', 10)), verifyUrl: CODEX_ISSUER + '/codex/device' };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}
async function codexExchange(code, verifier) {   // шаг 4: код -> токены
  const r = await fetch(CODEX_TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: CODEX_ISSUER + '/deviceauth/callback', client_id: CODEX_CLIENT_ID, code_verifier: verifier }).toString() });
  if (!r.ok) return { ok: false, error: 'token exchange HTTP ' + r.status };
  const d = await r.json();
  if (!d.access_token) return { ok: false, error: 'no access_token' };
  return { ok: true, pending: false, accessToken: d.access_token, refreshToken: d.refresh_token || '', accountId: codexAccountId(d.access_token) };
}
async function codexPoll(msg) {   // шаг 3: опрос; на 200 сразу обмениваем код на токены
  try {
    const r = await fetch(CODEX_ISSUER + '/api/accounts/deviceauth/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device_auth_id: msg.deviceAuthId, user_code: msg.userCode }) });
    if (r.status === 403 || r.status === 404) return { ok: true, pending: true };   // ещё не подтвердил вход
    if (!r.ok) return { ok: false, error: 'HTTP ' + r.status };
    const d = await r.json();
    if (!d.authorization_code || !d.code_verifier) return { ok: false, error: 'incomplete auth response' };
    return await codexExchange(d.authorization_code, d.code_verifier);
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}
async function codexRefresh(msg) {
  try {
    const r = await fetch(CODEX_TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: msg.refreshToken, client_id: CODEX_CLIENT_ID }).toString() });
    if (!r.ok) return { ok: false, status: r.status, error: 'refresh HTTP ' + r.status };
    const d = await r.json();
    if (!d.access_token) return { ok: false, error: 'no access_token' };
    return { ok: true, accessToken: d.access_token, refreshToken: d.refresh_token || msg.refreshToken, accountId: codexAccountId(d.access_token) };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}
function extractCodexText(data) {
  if (!data) return '';
  if (typeof data.output_text === 'string' && data.output_text) return data.output_text;
  let out = '';
  for (const it of (data.output || [])) {
    if (it && it.type === 'message' && Array.isArray(it.content)) for (const c of it.content) { if (c && (c.type === 'output_text' || c.type === 'text') && typeof c.text === 'string') out += c.text; }
  }
  return out;
}
function parseCodexSSE(raw) {
  let out = '';
  for (const line of String(raw).split(/\r?\n/)) {
    const s = line.trim(); if (!s.startsWith('data:')) continue;
    const payload = s.slice(5).trim(); if (!payload || payload === '[DONE]') continue;
    try { const ev = JSON.parse(payload);
      if (ev.type === 'response.output_text.delta' && typeof ev.delta === 'string') out += ev.delta;
      else if (ev.type === 'response.completed' && ev.response) { const f = extractCodexText(ev.response); if (f) out = f; }
    } catch (_) {}
  }
  return out;
}
async function codexChat(msg) {   // запрос к модели через codex-бэкенд (OpenAI Responses API)
  await ensureCodexHeaderRule();
  try {
    const token = msg.accessToken; if (!token) return { ok: false, error: 'not signed in' };
    let instructions = ''; const input = [];
    for (const m of (msg.messages || [])) {
      if (m.role === 'system') { instructions = (instructions ? instructions + '\n\n' : '') + String(m.content || ''); continue; }
      input.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') });
    }
    if (!instructions) instructions = 'You are a helpful assistant.';
    if (msg.imageUrl) {   // мультимодал: прикрепляем скрин страницы к последнему сообщению пользователя
      let done = false;
      for (let i = input.length - 1; i >= 0; i--) { if (input[i].role === 'user') { input[i] = { role: 'user', content: [{ type: 'input_text', text: String(input[i].content || '') }, { type: 'input_image', image_url: msg.imageUrl }] }; done = true; break; } }
      if (!done) input.push({ role: 'user', content: [{ type: 'input_image', image_url: msg.imageUrl }] });
    }
    const headers = { 'Content-Type': 'application/json', 'Accept': 'text/event-stream', 'Authorization': 'Bearer ' + token };
    const acct = msg.accountId || codexAccountId(token); if (acct) headers['ChatGPT-Account-ID'] = acct;
    const body = JSON.stringify({ model: msg.model || 'gpt-5.5', instructions, input, store: false, stream: true });   // codex-бэкенд ТРЕБУЕТ stream:true -> ответ SSE, собираем parseCodexSSE
    const ctrl = new AbortController();
    const to = setTimeout(() => { try { ctrl.abort(); } catch (_) {} }, msg.timeoutMs || 120000);
    let resp; try { resp = await fetch(CODEX_BASE + '/responses', { method: 'POST', headers, body, signal: ctrl.signal }); } finally { clearTimeout(to); }
    if (resp.status === 401) return { ok: false, status: 401, error: 'unauthorized' };
    if (!resp.ok) {
      let detail = ''; try { detail = (await resp.text()).slice(0, 300); } catch (_) {}
      const cf = resp.headers.get('cf-mitigated');
      return { ok: false, status: resp.status, error: 'HTTP ' + resp.status + (cf ? ' (cloudflare ' + cf + ')' : '') + (detail ? ': ' + detail : '') };
    }
    const ct = resp.headers.get('content-type') || '';
    const raw = await resp.text();   // читаем тело один раз
    let text = '';
    if (/event-stream/i.test(ct) || /^\s*(event:|data:)/m.test(raw)) text = parseCodexSSE(raw);   // SSE по типу ИЛИ по содержимому
    else { try { text = extractCodexText(JSON.parse(raw)); } catch (_) { text = parseCodexSSE(raw); } }
    if (!text) return { ok: false, error: 'empty response' + (raw ? ': ' + raw.slice(0, 200) : '') };
    return { ok: true, content: text };
  } catch (e) { const m = String((e && e.message) || e); return { ok: false, error: /abort/i.test(m) ? 'request timeout' : m }; }
}

// Фоновый device-code вход. Опрос ведём через chrome.alarms -> переживает И засыпание service worker'а (MV3 глушит setTimeout-цикл ~30с),
// И закрытие любого окна (panel/popup). Состояние и токены — в storage.local; токен сохраняется сам в 'yasiaAI'.
const CODEX_LOGIN_KEY = '_codexLogin';
function codexLoginGet() { return new Promise((res) => { try { chrome.storage.local.get({ [CODEX_LOGIN_KEY]: null }, (s) => res((s && s[CODEX_LOGIN_KEY]) || null)); } catch (_) { res(null); } }); }
function codexLoginSet(st) { return new Promise((res) => { try { chrome.storage.local.set({ [CODEX_LOGIN_KEY]: st }, () => res()); } catch (_) { res(); } }); }
async function codexWriteTokens(r) {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get({ yasiaAI: null }, (s) => {
        const cfg = (s && s.yasiaAI && typeof s.yasiaAI === 'object') ? s.yasiaAI : {};
        cfg.gpt = Object.assign({}, cfg.gpt || {});
        cfg.gpt.chatgpt = { accessToken: r.accessToken, refreshToken: r.refreshToken, accountId: r.accountId };
        cfg.gpt.authMode = 'chatgpt'; cfg.provider = 'gpt';
        try { chrome.storage.local.set({ yasiaAI: cfg }, () => resolve(true)); } catch (_) { resolve(false); }
      });
    } catch (_) { resolve(false); }
  });
}
async function codexLoginBegin() {
  const s = await codexStart();
  if (!s || !s.ok) return s || { ok: false, error: 'start failed' };
  await codexLoginSet({ status: 'pending', deviceAuthId: s.deviceAuthId, userCode: s.userCode, verifyUrl: s.verifyUrl, startedAt: Date.now(), error: '' });
  try { chrome.alarms.create('codexPoll', { delayInMinutes: 0.1, periodInMinutes: 0.5 }); } catch (_) {}   // будим воркер каждые ~30с (мин. для unpacked) — переживает засыпание
  return { ok: true, userCode: s.userCode, verifyUrl: s.verifyUrl };
}
async function codexLoginTick() {
  const st = await codexLoginGet();
  if (!st || st.status !== 'pending') { try { chrome.alarms.clear('codexPoll'); } catch (_) {} return; }
  if (Date.now() - (st.startedAt || 0) > 15 * 60 * 1000) { await codexLoginSet({ status: 'timeout', error: 'timeout' }); try { chrome.alarms.clear('codexPoll'); } catch (_) {} return; }
  const r = await codexPoll({ deviceAuthId: st.deviceAuthId, userCode: st.userCode });
  if (!r || r.pending) return;   // ещё не подтвердил — ждём следующего alarm
  if (r.ok) { await codexWriteTokens(r); await codexLoginSet({ status: 'ok' }); }
  else await codexLoginSet({ status: 'error', error: r.error || 'error' });
  try { chrome.alarms.clear('codexPoll'); } catch (_) {}
}
try { chrome.alarms.onAlarm.addListener((a) => {
  if (!a || !a.name) return;
  if (a.name === 'codexPoll') return void codexLoginTick();
  if (a.name.indexOf('rem_') === 0) return void remFire(a.name);   // сработала напоминалка
}); } catch (_) {}
async function codexLoginStatus() { return { ok: true, state: await codexLoginGet() }; }

// снимок видимой вкладки (для «отправить скрин в GPT») — нужен host_permissions на текущий сайт (есть: https://*/*, http://*/*)
async function captureScreen() {
  try {
    const dataUrl = await new Promise((res, rej) => {
      try { chrome.tabs.captureVisibleTab({ format: 'jpeg', quality: 70 }, (u) => { const e = chrome.runtime.lastError; if (e) rej(new Error(e.message)); else res(u); }); }
      catch (e) { rej(e); }
    });
    if (!dataUrl) return { ok: false, error: 'no image' };
    return { ok: true, dataUrl };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

// ---------- NotebookLM: мост к внутреннему batchexecute-API Google ----------
// Официального API нет; протокол реверснут (по notebooklm-py). Авторизация = куки залогиненного
// Google-аккаунта пользователя в ЭТОМ браузере (host_permissions https://*/* уже покрывает домен).
// Может сломаться при изменении RPC у Google — обработчики возвращают {ok:false}, фича гаснет мягко.
const NLM_BASE = 'https://notebooklm.google.com';
const NLM_RPC = { list: 'wXbhsf', addSource: 'izAoDd', createNotebook: 'CCqFvf' };
let nlmTok = null;   // { at (CSRF SNlM0e), sid (FdrFJe), t } — кэш токенов страницы (протухают -> перечитываем)
async function nlmTokens(force) {
  if (!force && nlmTok && Date.now() - nlmTok.t < 10 * 60000) return nlmTok;
  const r = await fetch(NLM_BASE + '/', { credentials: 'include' });
  if (!r.ok) throw new Error('NotebookLM HTTP ' + r.status);
  const html = await r.text();
  const wiz = (k) => { const m = html.match(new RegExp('"' + k + '"\\s*:\\s*"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"')); return m ? m[1].replace(/\\(.)/g, '$1') : null; };
  const at = wiz('SNlM0e'), sid = wiz('FdrFJe');
  if (!at) throw new Error('not signed in');   // без CSRF-токена пользователь не залогинен в Google
  nlmTok = { at, sid: sid || '', t: Date.now() };
  return nlmTok;
}
async function nlmRpc(rpcId, params, sourcePath) {
  const tok = await nlmTokens(false);
  const url = NLM_BASE + '/_/LabsTailwindUi/data/batchexecute?' + new URLSearchParams({
    rpcids: rpcId, 'source-path': sourcePath || '/', 'f.sid': tok.sid, hl: 'en', rt: 'c',
  });
  const body = 'f.req=' + encodeURIComponent(JSON.stringify([[[rpcId, JSON.stringify(params), null, 'generic']]])) + '&at=' + encodeURIComponent(tok.at) + '&';
  const r = await fetch(url, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body,
  });
  if (r.status === 401 || r.status === 403) { nlmTok = null; throw new Error('auth ' + r.status); }
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const text = (await r.text()).replace(/^\)\]\}'/, '');
  // rt=c: чередование «число_байт \n json-чанк»; ищем последний непустой фрейм wrb.fr нашего rpcId
  let result;
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s.startsWith('[')) continue;
    let chunk; try { chunk = JSON.parse(s); } catch (_) { continue; }
    for (const fr of chunk) {
      if (Array.isArray(fr) && fr[0] === 'wrb.fr' && fr[1] === rpcId && fr[2] != null) {
        try { result = JSON.parse(fr[2]); } catch (_) {}
      }
    }
  }
  return result;
}
async function nlmList() {
  try {
    const res = await nlmRpc(NLM_RPC.list, [null, 1, null, [2]], '/');
    const rows = (res && res[0]) || [];
    const notebooks = rows.map((r) => ({ id: r && r[2], title: (r && typeof r[0] === 'string' ? r[0] : '').replace('thought\n', '').trim() })).filter((n) => n.id);
    return { ok: true, notebooks };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}
const NLM_TEMPLATE = [2, null, null, [1, null, null, null, null, null, null, null, null, null, [1]]];   // обязательный wrapper (Gemini-3.5 бэкенды отвергают запросы без него)
async function nlmAddUrl(msg) {
  try {
    const url = String(msg.url || ''), nb = String(msg.notebookId || '');
    if (!url || !nb) return { ok: false, error: 'url/notebookId required' };
    const yt = /(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(new URL(url).hostname);
    const spec = yt
      ? [null, null, null, null, null, null, null, [url], null, null, 1]   // YouTube — отдельный слот источника
      : [null, null, [url], null, null, null, null, null, null, null, 1];
    const res = await nlmRpc(NLM_RPC.addSource, [[spec], nb, NLM_TEMPLATE], '/notebook/' + nb);
    return { ok: true, raw: !!res };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}
async function nlmCreate(msg) {
  try {
    const title = String(msg.title || 'Yasenka');
    const res = await nlmRpc(NLM_RPC.createNotebook, [title, null, NLM_TEMPLATE], '/');
    const id = res && (res[2] || (res[0] && res[0][2]));
    return { ok: true, id: id || '' };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

// ---------- ДОЛГАЯ ПАМЯТЬ + ДИНАМИЧЕСКИЕ УМЕНИЯ Hermes: аутентифицированный GET (skills/capabilities) ----------
async function hermesGet(msg) {
  try {
    const base = String(msg.baseUrl || '').replace(/\/+$/, '');
    if (!base) return { ok: false, error: 'no address' };
    const headers = {}; if (msg.apiKey) headers['Authorization'] = 'Bearer ' + msg.apiKey;
    const ctrl = new AbortController();
    const to = setTimeout(() => { try { ctrl.abort(); } catch (_) {} }, msg.timeoutMs || 12000);
    let resp; try { resp = await fetch(base + (msg.path || '/v1/skills'), { headers, signal: ctrl.signal }); } finally { clearTimeout(to); }
    if (!resp.ok) return { ok: false, status: resp.status, error: 'HTTP ' + resp.status };
    let data = null; try { data = await resp.json(); } catch (_) { return { ok: false, error: 'bad json' }; }
    return { ok: true, data };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

// ---------- СТРИМИНГ-СТАТУСЫ: потоковый чат через Port, разбор стандартных дельт + кастомных hermes.tool.progress ----------
function parseChatSSEFull(raw) {   // фолбэк, если поток не отдали телом: собрать ответ из накопленного SSE-текста
  let full = '';
  for (const line of String(raw).split(/\r?\n/)) {
    const s = line.trim(); if (!s.startsWith('data:')) continue;
    const p = s.slice(5).trim(); if (!p || p === '[DONE]') continue;
    try { const ev = JSON.parse(p); const d = ev.choices && ev.choices[0] && ev.choices[0].delta && ev.choices[0].delta.content; if (typeof d === 'string') full += d; } catch (_) {}
  }
  return full;
}
async function aiChatStream(msg, port) {
  let aborted = false;
  const ctrl = new AbortController();
  port.onDisconnect.addListener(() => { aborted = true; try { ctrl.abort(); } catch (_) {} });
  const safePost = (m) => { if (!aborted) try { port.postMessage(m); } catch (_) {} };
  try {
    const base = String(msg.baseUrl || '').replace(/\/+$/, '');
    if (!base) { safePost({ t: 'error', error: 'no server address' }); return; }
    const url = base + (msg.path || '/v1/chat/completions');
    const headers = { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' };
    if (msg.apiKey) headers['Authorization'] = 'Bearer ' + msg.apiKey;
    if (msg.sessionKey) headers['X-Hermes-Session-Key'] = msg.sessionKey;   // та же долгая память, что и в обычном чате
    let messages = msg.messages || [];
    if (msg.imageUrl) { messages = messages.slice(); for (let i = messages.length - 1; i >= 0; i--) { if (messages[i].role === 'user') { messages[i] = { role: 'user', content: [{ type: 'text', text: String(messages[i].content || '') }, { type: 'image_url', image_url: { url: msg.imageUrl } }] }; break; } } }
    const body = JSON.stringify({ model: msg.model || 'hermes-agent', messages, stream: true });
    const to = setTimeout(() => { try { ctrl.abort(); } catch (_) {} }, msg.timeoutMs || 180000);
    let resp;
    try { resp = await fetch(url, { method: 'POST', headers, body, signal: ctrl.signal }); }
    catch (e) { clearTimeout(to); safePost({ t: 'error', error: String((e && e.message) || e) }); return; }
    if (!resp.ok) { clearTimeout(to); let d = ''; try { d = (await resp.text()).slice(0, 300); } catch (_) {} safePost({ t: 'error', status: resp.status, error: 'HTTP ' + resp.status + (d ? ': ' + d : '') }); return; }
    if (!resp.body || !resp.body.getReader) { clearTimeout(to); const raw = await resp.text(); let full = ''; try { const data = JSON.parse(raw); full = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || ''; } catch (_) { full = parseChatSSEFull(raw); } safePost({ t: 'done', content: full }); return; }
    const reader = resp.body.getReader(); const dec = new TextDecoder();
    let buf = '', full = '', curEvent = '';
    while (true) {
      let r; try { r = await reader.read(); } catch (_) { break; }
      if (r.done) break;
      buf += dec.decode(r.value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        let line = buf.slice(0, nl); buf = buf.slice(nl + 1); line = line.replace(/\r$/, '');
        if (!line) { curEvent = ''; continue; }
        if (line.indexOf('event:') === 0) { curEvent = line.slice(6).trim(); continue; }
        if (line.indexOf('data:') !== 0) continue;
        const payload = line.slice(5).trim(); if (!payload || payload === '[DONE]') continue;
        let ev; try { ev = JSON.parse(payload); } catch (_) { continue; }
        if (/tool/i.test(curEvent) || (ev && (ev.tool || ev.tool_name || (ev.type && /tool|progress/i.test(ev.type))))) {   // hermes.tool.progress — кастомное событие выполнения инструмента
          const label = ev.label || ev.message || ev.status || ev.tool_name || ev.tool || ev.type || curEvent;
          if (label) safePost({ t: 'progress', label: String(label).slice(0, 80), tool: String(ev.tool || ev.tool_name || '').slice(0, 40) });
          continue;
        }
        const delta = ev.choices && ev.choices[0] && ev.choices[0].delta && ev.choices[0].delta.content;   // стандартный чанк OpenAI
        if (typeof delta === 'string' && delta) { full += delta; safePost({ t: 'delta', text: delta }); }
        else { const mc = ev.choices && ev.choices[0] && ev.choices[0].message && ev.choices[0].message.content; if (typeof mc === 'string' && mc) full = mc; }
      }
    }
    clearTimeout(to);
    safePost({ t: 'done', content: full });
  } catch (e) { safePost({ t: 'error', error: String((e && e.message) || e) }); }
}

// ---------- НАПОМИНАЛКИ (локальные, chrome.alarms): Яся напоминает прямо в браузере ----------
const REM_KEY = 'yasiaReminders';
function remGet() { return new Promise((res) => { try { chrome.storage.local.get({ [REM_KEY]: [] }, (s) => res((s && s[REM_KEY]) || [])); } catch (_) { res([]); } }); }
function remSet(list) { return new Promise((res) => { try { chrome.storage.local.set({ [REM_KEY]: list }, () => res()); } catch (_) { res(); } }); }
async function remAdd(msg) {
  try {
    const fireAt = +msg.fireAt || 0;
    const text = String(msg.text || '').slice(0, 300).trim();
    if (!text || !fireAt || fireAt < Date.now() + 1500) return { ok: false, error: 'bad reminder' };
    const id = 'rem_' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    const list = await remGet(); list.push({ id, text, fireAt, created: Date.now() }); await remSet(list);
    try { chrome.alarms.create(id, { when: fireAt }); } catch (_) {}
    return { ok: true, id, fireAt };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}
async function remList() { return { ok: true, reminders: (await remGet()).sort((a, b) => a.fireAt - b.fireAt) }; }
async function remDel(msg) {
  try { await remSet((await remGet()).filter((r) => r.id !== msg.id)); try { chrome.alarms.clear(msg.id); } catch (_) {} return { ok: true }; }
  catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}
function queryTabs(q) { return new Promise((res) => { try { chrome.tabs.query(q, (t) => res(t || [])); } catch (_) { res([]); } }); }
function sendToTab(tabId, payload) {   // доставка подтверждается ответом контент-скрипта ({ok:true}); нет получателя/нет ответа -> false
  return new Promise((res) => { try { chrome.tabs.sendMessage(tabId, payload, (resp) => { void chrome.runtime.lastError; res(!!(resp && resp.ok)); }); } catch (_) { res(false); } });
}
async function remDeliver(r) {         // активная вкладка приоритетно, иначе любая http-вкладка; true = кто-то реально показал
  const payload = { type: 'YASIA_REMIND_FIRE', text: r.text };
  for (const t of await queryTabs({ active: true, lastFocusedWindow: true })) { if (t.id && /^https?:/i.test(t.url || '') && await sendToTab(t.id, payload)) return true; }
  for (const t of await queryTabs({})) { if (t.id && /^https?:/i.test(t.url || '') && await sendToTab(t.id, payload)) return true; }
  return false;
}
async function remFire(id) {           // удаляем ТОЛЬКО после подтверждённой доставки; иначе помечаем missed (отдадим при следующем YASIA_REMIND_PULL)
  const list = await remGet(); const r = list.find((x) => x.id === id); if (!r) return;
  if (await remDeliver(r)) await remSet((await remGet()).filter((x) => x.id !== id));
  else await remSet((await remGet()).map((x) => x.id === id ? Object.assign({}, x, { missed: true }) : x));
}
async function remPull() {             // контент-скрипт загрузился и спрашивает пропущенное: отдаём missed/просроченные и удаляем (доставка = этот ответ)
  const list = await remGet(); const now = Date.now();
  const due = list.filter((x) => x.missed || x.fireAt <= now);
  if (due.length) await remSet(list.filter((x) => !(x.missed || x.fireAt <= now)));
  return { ok: true, due: due.map((x) => ({ text: x.text, fireAt: x.fireAt })) };
}
async function remRearm() {   // расширение перезагрузили -> alarms сброшены: будущие пере-ставим, просроченные пометим missed (вкладок может ещё не быть)
  const list = await remGet(); const now = Date.now(); let dirty = false;
  for (const r of list) {
    if (r.fireAt > now + 500) { try { chrome.alarms.create(r.id, { when: r.fireAt }); } catch (_) {} }
    else if (!r.missed) { r.missed = true; dirty = true; }
  }
  if (dirty) await remSet(list);
}
remRearm();

chrome.runtime.onConnect.addListener((port) => {
  if (!port || port.name !== 'yasia-ai-stream') return;
  if (port.sender && port.sender.id && port.sender.id !== chrome.runtime.id) return;   // только свои content-script'ы
  port.onMessage.addListener((m) => { if (m && m.type === 'start') aiChatStream(m, port); });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;
  if (!sender || sender.id !== chrome.runtime.id) return;   // только свои content-script'ы (не доверять чужим расширениям/контекстам)
  if (msg.type === 'YASIA_HERMES_GET') { hermesGet(msg).then(sendResponse); return true; }
  if (msg.type === 'YASIA_REMIND_ADD') { remAdd(msg).then(sendResponse); return true; }
  if (msg.type === 'YASIA_REMIND_LIST') { remList().then(sendResponse); return true; }
  if (msg.type === 'YASIA_REMIND_DEL') { remDel(msg).then(sendResponse); return true; }
  if (msg.type === 'YASIA_REMIND_PULL') { remPull().then(sendResponse); return true; }
  if (msg.type === 'YASIA_DOWNLOAD') { downloadVideo(msg).then(sendResponse); return true; }
  if (msg.type === 'YASIA_FETCH') { fetchText(msg).then(sendResponse); return true; }
  if (msg.type === 'YASIA_SYND_TIMELINE') { syndTimeline(msg).then(sendResponse); return true; }
  if (msg.type === 'YASIA_AI') { aiChat(msg).then(sendResponse); return true; }
  if (msg.type === 'YASIA_AI_PING') { aiPing(msg).then(sendResponse); return true; }
  if (msg.type === 'YASIA_CODEX_START') { codexStart().then(sendResponse); return true; }
  if (msg.type === 'YASIA_CODEX_POLL') { codexPoll(msg).then(sendResponse); return true; }
  if (msg.type === 'YASIA_CODEX_REFRESH') { codexRefresh(msg).then(sendResponse); return true; }
  if (msg.type === 'YASIA_CODEX_CHAT') { codexChat(msg).then(sendResponse); return true; }
  if (msg.type === 'YASIA_CODEX_LOGIN') { codexLoginBegin().then(sendResponse); return true; }
  if (msg.type === 'YASIA_CODEX_LOGIN_STATUS') { codexLoginStatus().then(sendResponse); return true; }
  if (msg.type === 'YASIA_CAPTURE') { captureScreen().then(sendResponse); return true; }
  if (msg.type === 'YASIA_NLM_LIST') { nlmList().then(sendResponse); return true; }
  if (msg.type === 'YASIA_NLM_ADD') { nlmAddUrl(msg).then(sendResponse); return true; }
  if (msg.type === 'YASIA_NLM_CREATE') { nlmCreate(msg).then(sendResponse); return true; }
});
