// Движок скачивания YouTube В МИРЕ СТРАНИЦЫ (world: MAIN, только youtube.com).
// ОТДЕЛЬНЫЙ файл + opt-in тумблер => легко исключить из сборки для Chrome Web Store
// (стор запрещает загрузку с YouTube). Общается с pet.js через postMessage.
//
// Расшифровка подписи/n-параметра портирована из distube/ytdl-core lib/sig.js (актуальные
// регулярки, включая TCE-варианты). vm.Script заменён на: РЕПЛЕЙ операций подписи без eval
// (работает при строгом CSP) + фолбэк new Function. n-параметр — через new Function (best-effort;
// если CSP заблокирует eval, видео всё равно скачается, но медленнее — YouTube троттлит без n).
// Цель — прогрессивный (muxed) формат со звуком (обычно itag 18, 360p). Площадка ломает методы
// часто — извлекатель придётся периодически подтягивать из distube.
(() => {
  // ====== ПЕРЕХВАТ авторизованных запросов плеера (videoplayback) ======
  // Плеер сам грузит медиа по подписанным googlevideo-ссылкам, в которых УЖЕ есть валидный PO-token/
  // подпись/обработанный n. Ловим их по itag и потом докачиваем полный файл теми же ссылками —
  // это обходит 403/PO-token и троттлинг (не надо расшифровывать и не надо BotGuard).
  const gvByItag = new Map();   // itag -> { url(база без range), mime, clen, vid, ts }
  function curVid() { try { return new URLSearchParams(location.search).get('v') || ''; } catch (_) { return ''; } }
  function noteGv(rawUrl) {
    try {
      if (typeof rawUrl !== 'string' || rawUrl.indexOf('googlevideo.com/') === -1 || rawUrl.indexOf('videoplayback') === -1) return;
      const u = new URL(rawUrl, location.href);
      const itag = u.searchParams.get('itag'); if (!itag) return;
      const clen = +(u.searchParams.get('clen') || 0);
      const mime = u.searchParams.get('mime') || '';
      // снимаем переменные части запроса -> остаётся базовая (подписанная) ссылка, к ней добавим свой Range.
      u.searchParams.delete('range'); u.searchParams.delete('rn'); u.searchParams.delete('rbuf'); u.searchParams.delete('ump'); u.searchParams.delete('srfvp');
      gvByItag.set(String(itag), { url: u.toString(), mime, clen, vid: curVid(), ts: Date.now() });
    } catch (_) {}
  }
  (function patchNet() {
    try { const of = window.fetch; if (of) window.fetch = function (input) { try { noteGv(typeof input === 'string' ? input : (input && input.url)); } catch (_) {} return of.apply(this, arguments); }; } catch (_) {}
    try { const oo = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function (m, url) { try { noteGv(url); } catch (_) {} return oo.apply(this, arguments); }; } catch (_) {}
  })();

  // ====== ЗАХВАТ медиа из плеера (MediaSource.appendBuffer) — обход SABR/403 ======
  // SABR-видео нельзя до-качать ссылкой (POST-протокол, GET Range => 403). Но плеер скармливает
  // УЖЕ расшифрованные fMP4-сегменты в SourceBuffer — ловим их (403 невозможен, ничего не пере-запрашиваем).
  // Порядок/дедуп фрагментов — по tfdt.baseMediaDecodeTime => перемотки/повторы не ломают склейку.
  // Дорожки кодим по (vid, kind, размер init-сегмента) — переинициализация при seek докапливает ту же дорожку,
  // смена качества (другой init) идёт отдельной дорожкой (потом берём самую полную).
  const mseTracks = [];   // { kind, mime, vid, sig, init:Uint8Array, frags:Map<key,Uint8Array>, bytes, capped }
  function u8copy(data) {
    try {
      if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
      if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    } catch (_) {}
    return null;
  }
  function boxType(u8, off) { return String.fromCharCode(u8[off + 4], u8[off + 5], u8[off + 6], u8[off + 7]); }
  function rdU32(u8, off) { return (u8[off] * 0x1000000) + (u8[off + 1] << 16) + (u8[off + 2] << 8) + u8[off + 3]; }
  function topOffsetOf(u8, type) {                            // смещение top-level бокса заданного типа (или -1)
    let off = 0;
    while (off + 8 <= u8.length) {
      let size = rdU32(u8, off);
      if (boxType(u8, off) === type) return off;
      if (size === 1) size = rdU32(u8, off + 8) * 0x100000000 + rdU32(u8, off + 12);   // 64-битный размер (largesize)
      if (size < 8) break;
      off += size;
    }
    return -1;
  }
  function fragTfdt(u8) {                                     // baseMediaDecodeTime из первого tfdt (ключ порядка/дедупа), или null
    const n = Math.min(u8.length, 1 << 16);                  // tfdt живёт в начале (moof перед mdat) — глубоко не лезем
    for (let q = 0; q + 16 <= n; q++) {
      if (u8[q] === 0x74 && u8[q + 1] === 0x66 && u8[q + 2] === 0x64 && u8[q + 3] === 0x74) {   // 'tfdt'
        const ver = u8[q + 4];
        if (ver === 1) return rdU32(u8, q + 8) * 0x100000000 + rdU32(u8, q + 12);
        return rdU32(u8, q + 8);
      }
    }
    return null;
  }
  function isInit(u8) {                                       // init-сегмент: первый бокс ftyp/moov, либо есть moov и нет moof
    const t = boxType(u8, 0);
    if (t === 'ftyp' || t === 'moov') return true;
    if (t === 'moof' || t === 'styp' || t === 'sidx' || t === 'mdat') return false;
    return topOffsetOf(u8, 'moov') >= 0 && topOffsetOf(u8, 'moof') < 0;
  }
  function mseClearOther(vid) {                               // SPA-переход watch->watch: чистим дорожки прошлых видео (память + путаница)
    if (!vid) return;
    for (let i = mseTracks.length - 1; i >= 0; i--) if (mseTracks[i].vid && mseTracks[i].vid !== vid) mseTracks.splice(i, 1);
  }
  function mseNewTrack(sb, u8) {
    const mime = sb.__yasiaMime || '';
    const kind = /video\//i.test(mime) ? 'video' : (/audio\//i.test(mime) ? 'audio' : 'other');
    const vid = curVid(); mseClearOther(vid);
    const sig = kind + ':' + u8.length;                      // тот же формат/качество => тот же init => та же дорожка
    let t = mseTracks.find((x) => x.vid === vid && x.sig === sig);
    if (!t) { t = { kind, mime, vid, sig, init: u8, frags: new Map(), bytes: u8.length, capped: false }; mseTracks.push(t); }
    sb.__yasiaCur = t;
  }
  function mseAddFrag(sb, u8) {
    const t = sb.__yasiaCur; if (!t || t.capped) return;
    const key = fragTfdt(u8); const k = (key == null) ? ('n' + t.frags.size) : key;
    if (t.frags.has(k)) return;                              // дедуп: тот же сегмент после перемотки не добавляем дважды
    t.frags.set(k, u8); t.bytes += u8.length;
    if (t.bytes > HD_MAX_BYTES) t.capped = true;             // защита от OOM вкладки: дальше не копим (сохраним, что есть)
  }
  function mseHandle(sb, data) {
    const u8 = u8copy(data); if (!u8 || u8.length < 8) return;
    if (!isInit(u8)) { mseAddFrag(sb, u8); return; }
    const moofOff = topOffsetOf(u8, 'moof');                 // init может прийти совмещённо с первым фрагментом (ftyp+moov+moof+mdat)
    if (moofOff > 0) { mseNewTrack(sb, u8.subarray(0, moofOff)); mseAddFrag(sb, u8.subarray(moofOff)); }
    else mseNewTrack(sb, u8);
  }
  (function patchMSE() {
    try {
      const add = MediaSource.prototype.addSourceBuffer;
      MediaSource.prototype.addSourceBuffer = function (mime) {
        const sb = add.apply(this, arguments);
        try { sb.__yasiaMime = String(mime || ''); } catch (_) {}
        return sb;
      };
    } catch (_) {}
    try {
      const ap = SourceBuffer.prototype.appendBuffer;
      SourceBuffer.prototype.appendBuffer = function (data) {
        try { mseHandle(this, data); } catch (_) {}          // READ-ONLY: копируем себе и пропускаем дальше БЕЗ изменений
        return ap.apply(this, arguments);
      };
    } catch (_) {}
    // диагностика на случай отладки: что захвачено по дорожкам
    try { window.__yasiaMseDump = () => mseTracks.map((t) => ({ kind: t.kind, mime: t.mime, vid: t.vid, frags: t.frags.size, kb: Math.round(t.bytes / 1024), init: !!t.init, capped: t.capped })); } catch (_) {}
  })();

  // ====== ФОРС H.264/AAC: врём плееру, что не умеем AV1/VP9/Opus ======
  // YouTube выбирает кодек по MediaSource.isTypeSupported / canPlayType. Говорим «нет» на av01/vp9/opus →
  // плеер берёт avc1+mp4a (H.264/AAC) → наш захват из MediaSource собирается ремуксом. Побочка: воспроизведение
  // тоже идёт в H.264 (потолок 1080p; 1440p/4K = только VP9/AV1, их не будет). Для загрузчика — норм компромисс.
  (function forceH264() {
    const deny = /(av01|av1[.\s]|\bav1\b|vp0?9|vp0?8|opus|vorbis)/i;
    try {
      const orig = MediaSource.isTypeSupported.bind(MediaSource);
      MediaSource.isTypeSupported = function (type) {
        try { if (deny.test(String(type || ''))) return false; } catch (_) {}
        return orig(type);
      };
    } catch (_) {}
    try {
      const cpt = HTMLMediaElement.prototype.canPlayType;
      HTMLMediaElement.prototype.canPlayType = function (type) {
        try { if (deny.test(String(type || ''))) return ''; } catch (_) {}
        return cpt.apply(this, arguments);
      };
    } catch (_) {}
  })();

  // ---- регулярки (verbatim из distube/ytdl-core lib/sig.js) ----
  const VARIABLE_PART = "[a-zA-Z_\\$][a-zA-Z_0-9\\$]*";
  const VARIABLE_PART_DEFINE = "\\\"?" + VARIABLE_PART + "\\\"?";
  const BEFORE_ACCESS = "(?:\\[\\\"|\\.)";
  const AFTER_ACCESS = "(?:\\\"\\]|)";
  const VARIABLE_PART_ACCESS = BEFORE_ACCESS + VARIABLE_PART + AFTER_ACCESS;
  const REVERSE_PART = ":function\\(\\w\\)\\{(?:return )?\\w\\.reverse\\(\\)\\}";
  const SLICE_PART = ":function\\(\\w,\\w\\)\\{return \\w\\.slice\\(\\w\\)\\}";
  const SPLICE_PART = ":function\\(\\w,\\w\\)\\{\\w\\.splice\\(0,\\w\\)\\}";
  const SWAP_PART = ":function\\(\\w,\\w\\)\\{" +
    "var \\w=\\w\\[0\\];\\w\\[0\\]=\\w\\[\\w%\\w\\.length\\];\\w\\[\\w(?:%\\w.length|)\\]=\\w(?:;return \\w)?\\}";

  const DECIPHER_REGEXP =
    "function(?: " + VARIABLE_PART + ")?\\(([a-zA-Z])\\)\\{" +
    "\\1=\\1\\.split\\(\"\"\\);\\s*" +
    "((?:(?:\\1=)?" + VARIABLE_PART + VARIABLE_PART_ACCESS + "\\(\\1,\\d+\\);)+)" +
    "return \\1\\.join\\(\"\"\\)" +
    "\\}";

  const HELPER_REGEXP =
    "var (" + VARIABLE_PART + ")=\\{((?:(?:" +
    VARIABLE_PART_DEFINE + REVERSE_PART + "|" +
    VARIABLE_PART_DEFINE + SLICE_PART + "|" +
    VARIABLE_PART_DEFINE + SPLICE_PART + "|" +
    VARIABLE_PART_DEFINE + SWAP_PART +
    "),?\\n?)+)\\};";

  const FUNCTION_TCE_REGEXP =
    "function(?:\\s+[a-zA-Z_\\$][a-zA-Z0-9_\\$]*)?\\(\\w\\)\\{" +
    "\\w=\\w\\.split\\((?:\"\"|[a-zA-Z0-9_$]*\\[\\d+])\\);" +
    "\\s*((?:(?:\\w=)?[a-zA-Z_\\$][a-zA-Z0-9_\\$]*(?:\\[\\\"|\\.)[a-zA-Z_\\$][a-zA-Z0-9_\\$]*(?:\\\"\\]|)\\(\\w,\\d+\\);)+)" +
    "return \\w\\.join\\((?:\"\"|[a-zA-Z0-9_$]*\\[\\d+])\\)}";

  const N_TRANSFORM_REGEXP =
    "function\\(\\s*(\\w+)\\s*\\)\\s*\\{" +
    "var\\s*(\\w+)=(?:\\1\\.split\\(.*?\\)|String\\.prototype\\.split\\.call\\(\\1,.*?\\))," +
    "\\s*(\\w+)=(\\[.*?]);\\s*\\3\\[\\d+]" +
    "(.*?try)(\\{.*?})catch\\(\\s*(\\w+)\\s*\\)\\s*\\{" +
    '\\s*return"[\\w-]+([A-z0-9-]+)"\\s*\\+\\s*\\1\\s*}' +
    '\\s*return\\s*(\\2\\.join\\(""\\)|Array\\.prototype\\.join\\.call\\(\\2,.*?\\))};';

  const N_TRANSFORM_TCE_REGEXP =
    "function\\(\\s*(\\w+)\\s*\\)\\s*\\{" +
    "\\s*var\\s*(\\w+)=\\1\\.split\\(\\1\\.slice\\(0,0\\)\\),\\s*(\\w+)=\\[.*?];" +
    ".*?catch\\(\\s*(\\w+)\\s*\\)\\s*\\{" +
    "\\s*return(?:\"[^\"]+\"|\\s*[a-zA-Z_0-9$]*\\[\\d+])\\s*\\+\\s*\\1\\s*}" +
    "\\s*return\\s*\\2\\.join\\((?:\"\"|[a-zA-Z_0-9$]*\\[\\d+])\\)};";

  const TCE_GLOBAL_VARS_REGEXP =
    "(?:^|[;,])\\s*(var\\s+([\\w$]+)\\s*=\\s*" +
    "(?:" +
    "([\"'])(?:\\\\.|[^\\\\])*?\\3" +
    "\\s*\\.\\s*split\\((" +
    "([\"'])(?:\\\\.|[^\\\\])*?\\5" +
    "\\))" +
    "|" +
    "\\[\\s*(?:([\"'])(?:\\\\.|[^\\\\])*?\\6\\s*,?\\s*)+\\]" +
    "))(?=\\s*[,;])";

  const NEW_TCE_GLOBAL_VARS_REGEXP =
    "('use\\s*strict';)?" +
    "(?<code>var\\s*" +
    "(?<varname>[a-zA-Z0-9_$]+)\\s*=\\s*" +
    "(?<value>" +
    "(?:\"[^\"\\\\]*(?:\\\\.[^\"\\\\]*)*\"|'[^'\\\\]*(?:\\\\.[^'\\\\]*)*')" +
    "\\.split\\(" +
    "(?:\"[^\"\\\\]*(?:\\\\.[^\"\\\\]*)*\"|'[^'\\\\]*(?:\\\\.[^'\\\\]*)*')" +
    "\\)" +
    "|" +
    "\\[" +
    "(?:(?:\"[^\"\\\\]*(?:\\\\.[^\"\\\\]*)*\"|'[^'\\\\]*(?:\\\\.[^'\\\\]*)*')" +
    "\\s*,?\\s*)*" +
    "\\]" +
    "|" +
    "\"[^\"]*\"\\.split\\(\"[^\"]*\"\\)" +
    ")" +
    ")";

  const TCE_SIGN_FUNCTION_REGEXP = "function\\(\\s*([a-zA-Z0-9$])\\s*\\)\\s*\\{" +
    "\\s*\\1\\s*=\\s*\\1\\[(\\w+)\\[\\d+\\]\\]\\(\\2\\[\\d+\\]\\);" +
    "([a-zA-Z0-9$]+)\\[\\2\\[\\d+\\]\\]\\(\\s*\\1\\s*,\\s*\\d+\\s*\\);" +
    "\\s*\\3\\[\\2\\[\\d+\\]\\]\\(\\s*\\1\\s*,\\s*\\d+\\s*\\);" +
    ".*?return\\s*\\1\\[\\2\\[\\d+\\]\\]\\(\\2\\[\\d+\\]\\)\\};";

  const TCE_SIGN_FUNCTION_ACTION_REGEXP = "var\\s+([$A-Za-z0-9_]+)\\s*=\\s*\\{\\s*[$A-Za-z0-9_]+\\s*:\\s*function\\s*\\([^)]*\\)\\s*\\{[^{}]*(?:\\{[^{}]*}[^{}]*)*}\\s*,\\s*[$A-Za-z0-9_]+\\s*:\\s*function\\s*\\([^)]*\\)\\s*\\{[^{}]*(?:\\{[^{}]*}[^{}]*)*}\\s*,\\s*[$A-Za-z0-9_]+\\s*:\\s*function\\s*\\([^)]*\\)\\s*\\{[^{}]*(?:\\{[^{}]*}[^{}]*)*}\\s*};";

  const TCE_N_FUNCTION_REGEXP = "function\\s*\\((\\w+)\\)\\s*\\{var\\s*\\w+\\s*=\\s*\\1\\[\\w+\\[\\d+\\]\\]\\(\\w+\\[\\d+\\]\\)\\s*,\\s*\\w+\\s*=\\s*\\[.*?\\]\\;.*?catch\\s*\\(\\s*(\\w+)\\s*\\)\\s*\\{return\\s*\\w+\\[\\d+\\]\\s*\\+\\s*\\1\\}\\s*return\\s*\\w+\\[\\w+\\[\\d+\\]\\]\\(\\w+\\[\\d+\\]\\)\\}\\s*\\;";

  const PATTERN_PREFIX = "(?:^|,)\\\"?(" + VARIABLE_PART + ")\\\"?";
  const REVERSE_PATTERN = new RegExp(PATTERN_PREFIX + REVERSE_PART, "m");
  const SLICE_PATTERN = new RegExp(PATTERN_PREFIX + SLICE_PART, "m");
  const SPLICE_PATTERN = new RegExp(PATTERN_PREFIX + SPLICE_PART, "m");
  const SWAP_PATTERN = new RegExp(PATTERN_PREFIX + SWAP_PART, "m");

  const DECIPHER_ARGUMENT = "sig";
  const N_ARGUMENT = "ncode";
  const DECIPHER_FUNC_NAME = "DisTubeDecipherFunc";
  const N_TRANSFORM_FUNC_NAME = "DisTubeNTransformFunc";

  const firstGroup = (pat, text) => { const m = text.match(pat); return m ? m[1] : null; };
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function extractTceFunc(body) {
    try {
      const m = body.match(new RegExp(NEW_TCE_GLOBAL_VARS_REGEXP, 'm'));
      if (!m || !m.groups) return {};
      return { name: m.groups.varname, code: m.groups.code };
    } catch (_) { return {}; }
  }

  // ---- ПОДПИСЬ: реплей операций (без eval -> работает при строгом CSP) ----
  function buildSigReplay(body) {
    try {
      const helperMatch = body.match(new RegExp(HELPER_REGEXP, "s"));
      if (!helperMatch) return null;
      const actionBody = helperMatch[2], helperName = helperMatch[1];
      const reverseKey = firstGroup(REVERSE_PATTERN, actionBody);
      const sliceKey = firstGroup(SLICE_PATTERN, actionBody);
      const spliceKey = firstGroup(SPLICE_PATTERN, actionBody);
      const swapKey = firstGroup(SWAP_PATTERN, actionBody);
      let fm = body.match(new RegExp(DECIPHER_REGEXP, "s"));
      let calls = fm ? fm[2] : null;
      if (!calls) { const t = body.match(new RegExp(FUNCTION_TCE_REGEXP, "s")); if (t) calls = t[1]; }
      if (!calls) return null;
      const opRe = new RegExp(escRe(helperName) + "(?:\\.([a-zA-Z0-9$_]+)|\\[\"([a-zA-Z0-9$_]+)\"\\])\\(\\w,(\\d+)\\)", "g");
      const steps = []; let m;
      while ((m = opRe.exec(calls))) steps.push({ key: m[1] || m[2], n: +m[3] });
      if (!steps.length) return null;
      return (sig) => {
        let a = String(sig).split('');
        for (const st of steps) {
          if (st.key === reverseKey) a.reverse();
          else if (st.key === sliceKey) a = a.slice(st.n);
          else if (st.key === spliceKey) a.splice(0, st.n);
          else if (st.key === swapKey) { const tmp = a[0]; a[0] = a[st.n % a.length]; a[st.n % a.length] = tmp; }
        }
        return a.join('');
      };
    } catch (_) { return null; }
  }

  // ---- ПОДПИСЬ: полный порт distube extractDecipherFunc (фолбэк через new Function) ----
  function extractDecipherDef(body, name, code) {
    try {
      const sigFn = body.match(new RegExp(TCE_SIGN_FUNCTION_REGEXP, 's'));
      const sigAct = body.match(new RegExp(TCE_SIGN_FUNCTION_ACTION_REGEXP, 's'));
      if (sigFn && sigAct && code) return "var " + DECIPHER_FUNC_NAME + "=" + sigFn[0] + sigAct[0] + code + ";\n";
      const helperMatch = body.match(new RegExp(HELPER_REGEXP, "s"));
      if (!helperMatch) return null;
      const helperObject = helperMatch[0];
      let fm = body.match(new RegExp(DECIPHER_REGEXP, "s")), isTce = false, decipherFunc;
      if (fm) decipherFunc = fm[0];
      else { const t = body.match(new RegExp(FUNCTION_TCE_REGEXP, "s")); if (!t) return null; decipherFunc = t[0]; isTce = true; }
      let tceVars = "";
      if (isTce) { const tv = body.match(new RegExp(TCE_GLOBAL_VARS_REGEXP, "m")); if (tv) tceVars = tv[1] + ";\n"; }
      return tceVars + helperObject + "\nvar " + DECIPHER_FUNC_NAME + "=" + decipherFunc + ";\n";
    } catch (_) { return null; }
  }

  // ---- n-параметр: порт distube extractNTransformFunc (через new Function) ----
  function extractNTransformDef(body, name, code) {
    try {
      const nTce = body.match(new RegExp(TCE_N_FUNCTION_REGEXP, 's'));
      if (nTce && name && code) {
        let nFunction = nTce[0];
        const esc = name.replace("$", "\\$");
        const scPat = new RegExp(";\\s*if\\s*\\(\\s*typeof\\s+[a-zA-Z0-9_$]+\\s*===?\\s*(?:\"undefined\"|'undefined'|" + esc + "\\[\\d+\\])\\s*\\)\\s*return\\s+\\w+;");
        const sc = nFunction.match(scPat);
        if (sc) nFunction = nFunction.split(sc[0]).join(";");
        return "var " + N_TRANSFORM_FUNC_NAME + "=" + nFunction + code + ";\n";
      }
      let nMatch = body.match(new RegExp(N_TRANSFORM_REGEXP, "s")), isTce = false, nFunction;
      if (nMatch) nFunction = nMatch[0];
      else { const t = body.match(new RegExp(N_TRANSFORM_TCE_REGEXP, "s")); if (!t) return null; nFunction = t[0]; isTce = true; }
      const pm = nFunction.match(/function\s*\(\s*(\w+)\s*\)/);
      if (!pm) return null;
      const cleaned = nFunction.replace(new RegExp("if\\s*\\(typeof\\s*[^\\s()]+\\s*===?.*?\\)return " + pm[1] + "\\s*;?", "g"), "");
      let tceVars = "";
      if (isTce) { const tv = body.match(new RegExp(TCE_GLOBAL_VARS_REGEXP, "m")); if (tv) tceVars = tv[1] + ";\n"; }
      return tceVars + "var " + N_TRANSFORM_FUNC_NAME + "=" + cleaned + ";\n";
    } catch (_) { return null; }
  }

  function buildFn(def, fname, arg) {
    if (!def) return null;
    try { return new Function(arg, def + "\nreturn " + fname + "(" + arg + ");"); } catch (_) { return null; }   // CSP может запретить eval -> null
  }

  // ---- сбор функций из base.js (с кэшем по URL плеера) ----
  let cachedUrl = null, cachedFns = null;
  function abs(u) { return /^https?:/.test(u) ? u : ('https://www.youtube.com' + u); }
  function getBaseJsUrl() {
    try { if (window.ytcfg && ytcfg.get) { const u = ytcfg.get('PLAYER_JS_URL'); if (u) return abs(u); } } catch (_) {}
    try { const u = window.ytplayer && ytplayer.web_player_context_config && ytplayer.web_player_context_config.jsUrl; if (u) return abs(u); } catch (_) {}
    const s = document.querySelector('script[src*="/player_ias"], script[src$="base.js"]');
    if (s && s.src) return s.src;
    const m = document.documentElement.innerHTML.match(/"jsUrl":"([^"]+base\.js)"/);
    if (m) return abs(m[1].replace(/\\\//g, '/'));
    return null;
  }
  async function getFunctions() {
    const url = getBaseJsUrl();
    if (!url) return null;
    if (cachedUrl === url && cachedFns) return cachedFns;
    const body = await fetch(url).then((r) => r.text());
    const { name, code } = extractTceFunc(body) || {};
    let decipher = buildSigReplay(body);                          // 1) реплей без eval
    if (!decipher) decipher = buildFn(extractDecipherDef(body, name, code), DECIPHER_FUNC_NAME, DECIPHER_ARGUMENT);   // 2) фолбэк new Function
    const nTransform = buildFn(extractNTransformDef(body, name, code), N_TRANSFORM_FUNC_NAME, N_ARGUMENT);
    cachedUrl = url; cachedFns = { decipher, nTransform };
    return cachedFns;
  }

  function setDownloadURL(format, decipher, nTransform) {
    const decip = (cipherStr) => {
      const args = Object.fromEntries(new URLSearchParams(cipherStr));
      if (!args.s || !decipher) return args.url;
      try {
        const comp = new URL(decodeURIComponent(args.url));
        comp.searchParams.set(args.sp || 'sig', decipher(decodeURIComponent(args.s)));
        return comp.toString();
      } catch (_) { return args.url; }
    };
    const ntr = (u) => {
      try {
        const comp = new URL(u);
        const n = comp.searchParams.get('n');
        if (!n || !nTransform) return u;
        const tn = nTransform(n);
        if (tn && tn !== n) comp.searchParams.set('n', tn);
        return comp.toString();
      } catch (_) { return u; }
    };
    const cipher = !format.url;
    const raw = format.url || format.signatureCipher || format.cipher;
    if (!raw) return;
    try { format.url = ntr(cipher ? decip(raw) : raw); } catch (_) {}
  }

  function sanitize(s) { return String(s || 'video').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'video'; }
  function getPlayerResponse() {
    if (window.ytInitialPlayerResponse && window.ytInitialPlayerResponse.streamingData) return window.ytInitialPlayerResponse;
    try { const r = window.ytplayer && ytplayer.config && ytplayer.config.args && ytplayer.config.args.raw_player_response; if (r && r.streamingData) return r; } catch (_) {}
    for (const s of document.querySelectorAll('script')) {
      const t = s.textContent;
      if (t && t.indexOf('ytInitialPlayerResponse') !== -1) {
        const m = t.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;\s*(?:var |const |let |<\/script|$)/s);
        if (m) { try { return JSON.parse(m[1]); } catch (_) {} }
      }
    }
    return null;
  }

  // ====== HD: раздельные дорожки adaptiveFormats -> ремукс через mp4box.js -> сохранение в браузере ======
  const HD_CHUNK = 10 * 1024 * 1024;          // 10 MiB — порог троттлинга googlevideo (как делает yt-dlp)
  const HD_MAX_BYTES = 700 * 1024 * 1024;     // защита от OOM вкладки на очень длинных HD -> фолбэк на 360p
  let _mp4boxLoading = null;
  function ytPost(m) { try { window.postMessage(m, '*'); } catch (_) {} }

  // ленивая загрузка mp4box.all.min.js: URL ресурса добывает pet.js (в MAIN-мире нет chrome.runtime)
  function ensureMp4Box() {
    if (window.MP4Box) return Promise.resolve();
    if (_mp4boxLoading) return _mp4boxLoading;
    _mp4boxLoading = new Promise((res, rej) => {
      const rid = 'mp4box_' + Math.floor(performance.now()) + '_' + (window.__yasiaMp4n = (window.__yasiaMp4n || 0) + 1);
      let done = false;
      const onUrl = (e) => {
        if (e.source !== window || !e.data || !e.data.__yasiaMp4boxUrl || e.data.reqId !== rid) return;
        window.removeEventListener('message', onUrl); done = true;
        try {
          const s = document.createElement('script');
          // Trusted Types (CSP YouTube) запрещает s.src=строка -> используем политику, иначе бросит и промис отклонится (не зависнет)
          let url = e.data.__yasiaMp4boxUrl;
          try { if (window.trustedTypes && trustedTypes.createPolicy) { const p = trustedTypes.createPolicy('yasia-mp4box', { createScriptURL: (u) => u }); url = p.createScriptURL(url); } } catch (_) {}
          s.src = url;
          s.onload = () => (window.MP4Box ? res() : rej(new Error('mp4box не инициализировался')));
          s.onerror = () => rej(new Error('mp4box не загрузился'));
          (document.head || document.documentElement).appendChild(s);
        } catch (err) { rej(new Error('mp4box заблокирован CSP: ' + String((err && err.message) || err))); }
      };
      window.addEventListener('message', onUrl);
      ytPost({ __yasiaMp4boxReq: true, reqId: rid });
      setTimeout(() => { if (!done) { window.removeEventListener('message', onUrl); rej(new Error('mp4box timeout')); } }, 15000);
    });
    _mp4boxLoading.catch(() => { _mp4boxLoading = null; });   // на ошибке сбросить кэш -> следующая попытка повторит (а не вечный фолбэк на 360p)
    return _mp4boxLoading;
  }

  // выбор лучших раздельных дорожек: H.264 video-only (<=1080p) + AAC m4a audio-only. mimeType — авторитет, не itag.
  function selectHdFormats(pr) {
    const A = pr.streamingData.adaptiveFormats || [];
    const isV = (f) => /video\/mp4/.test(f.mimeType || '') && /avc1/.test(f.mimeType || '') && (f.height || 0) && !f.audioQuality;
    const isM = (f) => /audio\/mp4/.test(f.mimeType || '') && /mp4a/.test(f.mimeType || '') && f.audioQuality && !f.qualityLabel;
    const video = A.filter(isV).filter((f) => (f.height || 0) <= 1080)
      .sort((a, b) => (b.height - a.height) || ((b.fps || 0) - (a.fps || 0)) || ((b.bitrate || 0) - (a.bitrate || 0)))[0];
    const audio = A.filter(isM)
      .sort((a, b) => ((b.bitrate || b.averageBitrate || 0) - (a.bitrate || a.averageBitrate || 0)))[0];
    return { video, audio };
  }

  function fmtByItag(pr, itag) {
    const all = (pr.streamingData.adaptiveFormats || []).concat(pr.streamingData.formats || []);
    return all.find((f) => String(f.itag) === String(itag)) || null;
  }
  // лучшие ПЕРЕХВАЧЕННЫЕ дорожки текущего видео (URL уже авторизован плеером): H.264 video-only + AAC audio-only.
  // Качество = то, что плеер реально загрузил (хочешь 1080p — выставь его в плеере перед скачиванием).
  function selectHdCaptured(pr) {
    const v = curVid(); const vC = [], aC = [];
    for (const [itag, e] of gvByItag) {
      if (v && e.vid && e.vid !== v) continue;                 // не тащим itag от ПРЕДЫДУЩЕГО видео (SPA-переход)
      const f = fmtByItag(pr, itag); if (!f) continue;
      const mt = f.mimeType || '';
      if (/video\/mp4/.test(mt) && /avc1/.test(mt) && (f.height || 0) && (f.height <= 1080) && !f.audioQuality) vC.push({ f, url: e.url });
      else if (/audio\/mp4/.test(mt) && /mp4a/.test(mt) && f.audioQuality && !f.qualityLabel) aC.push({ f, url: e.url });
    }
    vC.sort((a, b) => (b.f.height - a.f.height) || ((b.f.fps || 0) - (a.f.fps || 0)) || ((b.f.bitrate || 0) - (a.f.bitrate || 0)));
    aC.sort((a, b) => ((b.f.bitrate || b.f.averageBitrate || 0) - (a.f.bitrate || a.f.averageBitrate || 0)));
    return { video: vC[0] || null, audio: aC[0] || null };
  }

  // скачивание потока чанками по Range 10 MiB (иначе googlevideo троттлит запрос >10МБ)
  async function fetchStream(url, total, onProg) {
    if (!total) {
      try { const p = await fetch(url, { headers: { Range: 'bytes=0-1' }, credentials: 'include' }); const cr = p.headers.get('Content-Range'); total = cr ? Number(cr.split('/')[1]) : 0; try { p.body && p.body.cancel(); } catch (_) {} } catch (_) {}
    }
    if (!total) {                                            // размер неизвестен -> один проход (с лимитом на OOM)
      const r = await fetch(url, { credentials: 'include' });
      if (!r.ok && r.status !== 206) throw new Error(r.status === 403 ? 'expired' : 'http ' + r.status);
      const buf = await r.arrayBuffer();
      if (buf.byteLength > HD_MAX_BYTES) throw new Error('too-big');
      return buf;
    }
    if (total > HD_MAX_BYTES) throw new Error('too-big');     // слишком большое -> фолбэк на 360p
    const out = new Uint8Array(total);
    let pos = 0;
    while (pos < total) {
      const end = Math.min(pos + HD_CHUNK - 1, total - 1);
      const r = await fetch(url, { headers: { Range: `bytes=${pos}-${end}` }, credentials: 'include' });
      if (!r.ok && r.status !== 206) throw new Error(r.status === 403 ? 'expired' : 'http ' + r.status);
      if (r.status === 200) {                                // сервер проигнорировал Range -> отдал весь файл целиком
        const whole = new Uint8Array(await r.arrayBuffer());
        if (whole.byteLength > HD_MAX_BYTES) throw new Error('too-big');
        if (onProg) onProg(whole.byteLength, whole.byteLength);
        return whole.buffer;
      }
      const reader = r.body.getReader();
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        const room = total - pos; if (room <= 0) break;
        const chunk = value.length > room ? value.subarray(0, room) : value; // не вылезти за границы фикс-буфера
        out.set(chunk, pos); pos += chunk.length;
        if (onProg) onProg(pos, total);
        if (pos >= total) break;
      }
    }
    return out.buffer;                                        // один буфер, без concat-копий
  }

  // демукс одного источника (video-only или audio-only) -> { trak, trackBox, samples[] }
  function _demuxFirst(arrayBuffer) {
    return new Promise((res, rej) => {
      const mp4 = MP4Box.createFile();
      let info = null; const samples = [];
      mp4.onError = (err) => rej(new Error('mp4box demux: ' + err));
      mp4.onReady = (i) => { info = i; const t = info.tracks[0]; if (!t) { rej(new Error('нет дорожки')); return; } mp4.setExtractionOptions(t.id, null, { nbSamples: t.nb_samples }); mp4.start(); };
      mp4.onSamples = (id, user, chunk) => {
        for (const s of chunk) samples.push({ data: s.data, dts: s.dts, cts: s.cts, duration: s.duration, is_sync: s.is_sync });
        const t = info.tracks[0];
        if (samples.length >= t.nb_samples) { const trackBox = mp4.getTrackById(t.id); res({ trak: t, trackBox, samples }); }
      };
      arrayBuffer.fileStart = 0;                              // ОБЯЗАТЕЛЬНО для appendBuffer
      mp4.appendBuffer(arrayBuffer); mp4.flush();
    });
  }

  // ремукс video-only + audio-only -> один mp4 (stream-copy, БЕЗ перекодирования)
  async function muxToMp4(videoBuf, audioBuf) {
    const V = await _demuxFirst(videoBuf);
    const A = await _demuxFirst(audioBuf);
    const out = MP4Box.createFile();
    const vEntry = V.trackBox.mdia.minf.stbl.stsd.entries[0];
    const aEntry = A.trackBox.mdia.minf.stbl.stsd.entries[0];
    const vDesc = vEntry.avcC || (vEntry.boxes && vEntry.boxes[0]);  // ВНУТРЕННИЙ avcC, не весь avc1-entry (иначе addTrack вложит его ещё раз -> битый трек)
    const aDesc = aEntry.esds || (aEntry.boxes && aEntry.boxes[0]);  // ВНУТРЕННИЙ esds, не весь mp4a-entry (esds руками строить нельзя)
    const vId = out.addTrack({ type: 'avc1', timescale: V.trak.timescale, width: V.trak.video.width, height: V.trak.video.height, language: 'und', description: vDesc });
    const aId = out.addTrack({ type: 'mp4a', hdlr: 'soun', timescale: A.trak.timescale, channel_count: A.trak.audio.channel_count, samplerate: A.trak.audio.sample_rate, samplesize: 16, language: 'und', description: aDesc });
    for (const s of V.samples) out.addSample(vId, s.data, { duration: s.duration, dts: s.dts, cts: s.cts, is_sync: s.is_sync });
    for (const s of A.samples) out.addSample(aId, s.data, { duration: s.duration, dts: s.dts, cts: s.cts, is_sync: true });
    out.flush();                                              // финализируем таблицы ДО getBuffer
    return out.getBuffer();
  }

  // ====== сборка mp4 из ЗАХВАЧЕННЫХ из плеера сегментов (MediaSource) ======
  // склейка одной дорожки: init (moov) + фрагменты, упорядоченные по tfdt (числовой ключ), хвостом — нераспознанные
  function buildTrackFile(t) {
    if (!t || !t.init || !t.frags.size) return null;
    const keys = [...t.frags.keys()];
    const nums = keys.filter((k) => typeof k === 'number').sort((a, b) => a - b);
    const rest = keys.filter((k) => typeof k !== 'number');
    const ordered = nums.concat(rest);
    let total = t.init.length;
    for (const k of ordered) total += t.frags.get(k).length;
    const out = new Uint8Array(total);
    out.set(t.init, 0); let pos = t.init.length;
    for (const k of ordered) { const f = t.frags.get(k); out.set(f, pos); pos += f.length; }
    return out.buffer;
  }
  // демукс ФРАГМЕНТИРОВАННОГО mp4 (moov-init + moof/mdat): nb_samples в moov нет -> собираем всё, что отдал mp4box после flush
  function _demuxFrag(arrayBuffer) {
    return new Promise((res, rej) => {
      const mp4 = MP4Box.createFile();
      let info = null; const samples = [];
      mp4.onError = (err) => rej(new Error('mp4box demux: ' + err));
      mp4.onReady = (i) => { info = i; const t = i.tracks[0]; if (!t) { rej(new Error('нет дорожки')); return; } mp4.setExtractionOptions(t.id, null, { nbSamples: 500000 }); mp4.start(); };
      mp4.onSamples = (id, user, chunk) => { for (const s of chunk) samples.push({ data: s.data, dts: s.dts, cts: s.cts, duration: s.duration, is_sync: s.is_sync }); };
      arrayBuffer.fileStart = 0;
      mp4.appendBuffer(arrayBuffer); mp4.flush();             // для in-memory буфера mp4box парсит синхронно -> onSamples уже отстрелял
      setTimeout(() => { if (!info) return rej(new Error('mp4box не распознал захват')); const t = info.tracks[0]; res({ trak: t, trackBox: mp4.getTrackById(t.id), samples }); }, 0);
    });
  }
  async function muxCaptured(videoBuf, audioBuf) {           // тот же ремукс, что muxToMp4, но демукс — фрагментный
    const V = await _demuxFrag(videoBuf);
    const A = await _demuxFrag(audioBuf);
    if (!V.samples.length || !A.samples.length) throw new Error('пустой захват');
    const out = MP4Box.createFile();
    const vEntry = V.trackBox.mdia.minf.stbl.stsd.entries[0];
    const aEntry = A.trackBox.mdia.minf.stbl.stsd.entries[0];
    const vDesc = vEntry.avcC || (vEntry.boxes && vEntry.boxes[0]);
    const aDesc = aEntry.esds || (aEntry.boxes && aEntry.boxes[0]);
    const vId = out.addTrack({ type: 'avc1', timescale: V.trak.timescale, width: V.trak.video.width, height: V.trak.video.height, language: 'und', description: vDesc });
    const aId = out.addTrack({ type: 'mp4a', hdlr: 'soun', timescale: A.trak.timescale, channel_count: A.trak.audio.channel_count, samplerate: A.trak.audio.sample_rate, samplesize: 16, language: 'und', description: aDesc });
    for (const s of V.samples) out.addSample(vId, s.data, { duration: s.duration, dts: s.dts, cts: s.cts, is_sync: s.is_sync });
    for (const s of A.samples) out.addSample(aId, s.data, { duration: s.duration, dts: s.dts, cts: s.cts, is_sync: true });
    out.flush();
    return out.getBuffer();
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  function bufEndAt(video, t) {                               // конец забуференного диапазона, накрывающего время t (или null)
    const b = video.buffered;
    for (let i = 0; i < b.length; i++) if (t >= b.start(i) - 0.3 && t <= b.end(i) + 0.3) return b.end(i);
    return null;
  }
  // прокручиваем видео по всей длине, прыгая к краю буфера -> плеер догружает ВСЕ сегменты, мы их ловим в appendBuffer
  async function driveBuffering(video, dur, reqId) {
    const save = { t: video.currentTime, muted: video.muted, paused: video.paused, rate: video.playbackRate };
    video.muted = true;                                      // чтобы не орало во время промотки
    try {
      let target = 0, guard = 0;
      while (guard++ < 6000) {
        const end = bufEndAt(video, target);
        const have = end == null ? target : end;
        ytPost({ __yasiaYtProgress: true, reqId, phase: 'buffer', loaded: Math.floor(Math.min(have, dur)), total: Math.floor(dur) });
        if (have >= dur - 0.8) break;
        const seekTo = Math.min(have + 0.05, dur - 0.05);
        try { video.currentTime = seekTo; } catch (_) {}
        let waited = 0, grew = false;
        while (waited < 3500) {                              // ждём, пока буфер у точки перемотки появится/расширится
          await wait(160); waited += 160;
          const e = bufEndAt(video, seekTo);
          if (e != null && e > seekTo + 0.2) { target = e; grew = true; break; }
        }
        if (!grew) {                                         // застряли (реклама/конец/защита) — шагнём вручную, не зависаем
          target = seekTo + 1.2;
          if (target >= dur - 0.8) break;
        }
      }
    } finally {
      try { video.currentTime = save.t; } catch (_) {}
      video.muted = save.muted; try { video.playbackRate = save.rate; } catch (_) {}
      if (save.paused) { try { video.pause(); } catch (_) {} } else { try { video.play(); } catch (_) {} }
    }
  }
  function bestTrack(kind) {                                  // самая полная захваченная дорожка нужного типа (только H.264/AAC — их умеет ремукс)
    const v = curVid();
    const codec = kind === 'video' ? /avc1/i : /mp4a/i;
    return mseTracks
      .filter((t) => t.kind === kind && t.init && t.frags.size && (!t.vid || t.vid === v) && codec.test(t.mime))
      .sort((a, b) => b.bytes - a.bytes)[0] || null;
  }
  async function downloadFromCapture(pr, title, reqId) {
    const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
    if (!video) return { error: 'нет видеоэлемента на странице' };
    const dur = (pr.videoDetails && +pr.videoDetails.lengthSeconds) || video.duration || 0;
    if (!isFinite(dur) || dur <= 0) return { error: 'прямой эфир / неизвестная длительность — захват не поддержан' };
    await driveBuffering(video, dur, reqId);                 // 1) гоним буфер до конца -> ловим все сегменты
    const vT = bestTrack('video'), aT = bestTrack('audio');  // 2) лучшие захваченные mp4 video + audio
    if (!vT) {
      const any = mseTracks.filter((t) => t.init && t.frags.size).map((t) => t.mime.split(';')[0]).join(', ');
      if (any) return { error: 'плеер отдаёт не-H.264 (' + any + ') — захват пока умеет только H.264/AAC. Открой ⚙ и поставь другое качество, потом повтори' };   // другой ремонт (сменить качество), не буферизация
      return { error: 'не удалось захватить поток из плеера (дай ролику проиграться пару секунд и повтори)', needBuffer: true };   // плеер не успел отдать сегменты -> питомец попросит дать видео поиграть
    }
    if (!aT) return { error: 'захватил видео, но не звук — дай ролику проиграться со звуком пару секунд и повтори', needBuffer: true };
    await ensureMp4Box();
    const vBuf = buildTrackFile(vT), aBuf = buildTrackFile(aT);
    ytPost({ __yasiaYtProgress: true, reqId, phase: 'mux', loaded: 0, total: 1 });
    const outBuf = await muxCaptured(vBuf, aBuf);
    const part = vT.capped || aT.capped;
    saveBlob(outBuf, title + (part ? '_часть' : '_capture') + '.mp4');
    return { ok: true, hd: true, quality: part ? 'захват (часть — было слишком длинно)' : 'захват из плеера', src: 'mse' };
  }

  function saveBlob(arrayBuffer, filename) {                  // в MAIN-мире есть createObjectURL и <a download>
    const blob = new Blob([arrayBuffer], { type: 'video/mp4' });
    const u = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = u; a.download = filename;
    (document.body || document.documentElement).appendChild(a); a.click(); a.remove();
    setTimeout(() => { try { URL.revokeObjectURL(u); } catch (_) {} }, 60000);
  }

  async function downloadHD(pr, fns, title, reqId) {
    let video = null, audio = null, vUrl = null, aUrl = null, src = 'capture';
    // 1) ПЕРЕХВАЧЕННЫЕ ссылки плеера — авторизованы (PO-token/подпись/n уже валидны) -> без 403 и троттлинга
    const cap = selectHdCaptured(pr);
    if (cap.video && cap.audio) { video = cap.video.f; audio = cap.audio.f; vUrl = cap.video.url; aUrl = cap.audio.url; }
    // 2) фолбэк: расшифрованные adaptiveFormats (могут упереться в 403/pot/SABR)
    if (!vUrl || !aUrl) {
      const sel = selectHdFormats(pr);
      if (!sel.video || !sel.audio) return { error: 'no-hd' };
      setDownloadURL(sel.video, fns && fns.decipher, fns && fns.nTransform);
      setDownloadURL(sel.audio, fns && fns.decipher, fns && fns.nTransform);
      if (!sel.video.url || !sel.audio.url) return { error: 'no-hd' };  // SABR/pot — прямой ссылки нет
      video = sel.video; audio = sel.audio; vUrl = sel.video.url; aUrl = sel.audio.url; src = 'decipher';
    }
    await ensureMp4Box();
    const [vBuf, aBuf] = await Promise.all([
      fetchStream(vUrl, Number(video.contentLength) || 0, (l, t) => ytPost({ __yasiaYtProgress: true, reqId, phase: 'video', loaded: l, total: t })),
      fetchStream(aUrl, Number(audio.contentLength) || 0, (l, t) => ytPost({ __yasiaYtProgress: true, reqId, phase: 'audio', loaded: l, total: t })),
    ]);
    ytPost({ __yasiaYtProgress: true, reqId, phase: 'mux', loaded: 0, total: 1 });
    const outBuf = await muxToMp4(vBuf, aBuf);
    const q = video.qualityLabel || (video.height + 'p');
    saveBlob(outBuf, title + '_' + q + '.mp4');
    return { ok: true, hd: true, quality: q, throttled: src === 'decipher' && !(fns && fns.nTransform), src };
  }

  // быстрая проверка: ссылка реально отдаёт байты (а не 403/SABR), прежде чем доверить её фоновой докачке
  async function urlPlayable(url) {
    try {
      const r = await fetch(url, { headers: { Range: 'bytes=0-1' }, credentials: 'include' });
      try { r.body && r.body.cancel(); } catch (_) {}
      return r.ok || r.status === 206;
    } catch (_) { return false; }
  }
  async function resolve(reqId) {
    const pr = getPlayerResponse();
    if (!pr || !pr.streamingData) return { error: 'нет данных плеера — обнови страницу видео' };
    const ps = pr.playabilityStatus;
    if (ps && ps.status && ps.status !== 'OK') return { error: 'видео недоступно: ' + (ps.reason || ps.status) };
    const title = sanitize(pr.videoDetails && pr.videoDetails.title);
    ytPost({ __yasiaYtProgress: true, reqId, phase: 'prepare', loaded: 0, total: 0 });   // ранний пульс: pet.js продлевает ожидание, пока молча грузятся base.js + mp4box
    let fns = null, expired = false;
    try { fns = await getFunctions(); } catch (_) {}
    // HD: пробуем склеить лучшие avc1+mp4a (до 1080p) ПРЯМО в браузере; не вышло -> muxed 360p
    try {
      const hd = await downloadHD(pr, fns, title, reqId);
      if (hd && hd.ok) return hd;                             // файл уже сохранён (Blob -> <a download>)
    } catch (err) {
      if (String((err && err.message) || err) === 'expired') expired = true;
      // too-big / mp4box / expired / прочее -> всё равно пробуем muxed ниже (вдруг перехвачен прогрессивный)
    }
    const v = curVid();
    const muxed = (pr.streamingData.formats || []).map((f) => Object.assign({}, f));   // muxed (видео+звук одним файлом, обычно 360p)
    muxed.forEach((f) => {
      const capt = gvByItag.get(String(f.itag));               // перехваченный прогрессивный itag -> авторизованная ссылка плеера
      if (capt && capt.url && (!capt.vid || capt.vid === v)) { f.url = capt.url; f._cap = true; }
      else { try { setDownloadURL(f, fns && fns.decipher, fns && fns.nTransform); } catch (_) {} }
    });
    const usable = muxed.filter((f) => f.url && /mp4/.test(f.mimeType || '')).sort((a, b) => (b.height || 0) - (a.height || 0));
    if (usable.length && await urlPlayable(usable[0].url)) {     // ПРОБА: если ссылка 403 (SABR) — НЕ возвращаем, проваливаемся в захват из плеера ниже
      const q = usable[0].qualityLabel || (usable[0].height ? usable[0].height + 'p' : '');
      return { url: usable[0].url, filename: title + (q ? '_' + q : '') + '.mp4', throttled: !usable[0]._cap && !(fns && fns.nTransform) };
    }
    // ПОСЛЕДНИЙ РЕЗЕРВ (SABR/pot/expired — прямой ссылки нет): захват уже расшифрованных сегментов из плеера.
    // Тут 403 невозможен в принципе (ничего не пере-запрашиваем). Минус — прокручиваем видео, чтобы догрузить всё.
    try {
      ytPost({ __yasiaYtProgress: true, reqId, phase: 'buffer', loaded: 0, total: 1 });
      const cap = await downloadFromCapture(pr, title, reqId);
      if (cap && cap.ok) return cap;
      if (cap && cap.error) return cap;   // сохраняем needBuffer (раньше пересобирали только {error} и флаг терялся)
    } catch (e) {
      return { error: 'захват из плеера не удался: ' + String((e && e.message) || e) };
    }
    if (expired) return { error: 'ссылка устарела — обнови страницу видео и попробуй снова' };
    if (!fns || !fns.decipher) return { error: 'не разобрать плеер YouTube (обновился — извлекатель надо подтянуть из distube)' };
    return { error: 'нет прямого потока (новый протокол SABR). Поставь качество в плеере и дай видео доиграться пару секунд, потом «Скачать».', needBuffer: true };
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || !e.data.__yasiaYtRequest) return;
    const reqId = e.data.reqId;
    Promise.resolve().then(() => resolve(reqId))
      .then((res) => { try { window.postMessage({ __yasiaYtResult: res, reqId }, '*'); } catch (_) {} })
      .catch((err) => { try { window.postMessage({ __yasiaYtResult: { error: String((err && err.message) || err) }, reqId }, '*'); } catch (_) {} });
  });
})();
