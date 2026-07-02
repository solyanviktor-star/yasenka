// Система «Реплаер» (перенос движка FRO reviewQueue в Ясеньку, БЕЗ внешних API).
// Философия (guard, fail-closed): расширение ТОЛЬКО пишет черновик в родной composer X —
// кнопку «Отправить» жмёт человек. Никаких автокликов отправки, никаких автолайков.
// Цели собираются ИЗ DOM текущей ленты (главная/список/поиск/профиль) — режим «timeline» из FRO;
// FxTwitter и прочие внешние источники выброшены сознательно. Черновик пишет ИИ-мозг Ясеньки
// через существующий канал background.js (YASIA_AI / YASIA_CODEX_CHAT) — свой транспорт не заводим.
// Обход целей: очередь в storage.local (yasiaReplyQueue), переход location.assign -> на новой
// странице content script переинициализируется и продолжает по storage (как navigate-режим FRO).
(() => {
  'use strict';

  // ---------- чистые функции (без DOM) — юнит-тестируются в node (tests/replier.test.js) ----------
  // нормализация ника: '@User ' -> 'user' (сравнение авторов всегда в нижнем регистре)
  function normHandle(s) { return String(s || '').trim().replace(/^@/, '').toLowerCase(); }

  // разбор href «/user/status/123…» -> {handle, postId, postUrl}; null для не-статусных ссылок (фото, аналитика)
  function parseStatusHref(href) {
    const m = String(href || '').match(/^\/([A-Za-z0-9_]+)\/status\/(\d+)/);
    if (!m) return null;
    return { handle: m[1].toLowerCase(), postId: m[2], postUrl: 'https://x.com/' + m[1] + '/status/' + m[2] };
  }

  // причина отбраковки кандидата (null = годится): фильтр целей из ТЗ — не свои, не промо/репост,
  // текст длиннее minLen, ещё не отвеченные (replied = {postId:ts}), не дубликаты (seen)
  function targetFilterReason(t, opts) {
    const o = opts || {};
    if (!t || !t.postId || !t.handle) return 'meta';
    if (t.promoted) return 'promo';
    if (t.repost) return 'repost';
    if (o.myHandle && t.handle === o.myHandle) return 'self';
    if (String(t.text || '').trim().length <= (o.minLen != null ? o.minLen : 30)) return 'short';
    if (o.replied && o.replied[t.postId]) return 'replied';
    if (o.seen && o.seen.has(t.postId)) return 'dup';
    return null;
  }

  // кандидаты -> цели очереди: фильтр + дедуп (seen мутируется, чтобы работать порциями между прокрутками)
  function collectTargets(cands, opts) {
    const o = opts || {}; const seen = o.seen || new Set(); const out = [];
    for (const c of (cands || [])) {
      if (o.max && out.length >= o.max) break;
      if (targetFilterReason(c, { myHandle: o.myHandle, replied: o.replied, minLen: o.minLen, seen })) continue;
      seen.add(c.postId);
      out.push({ handle: c.handle, postId: c.postId, postUrl: c.postUrl, text: String(c.text || '').slice(0, 600), st: 'wait' });
    }
    return out;
  }

  // разбор поля «ники»: '@A, b  c;b' -> ['a','b','c'] (нижний регистр, только валидные X-ники, дедуп, порядок сохранён)
  function parseHandles(s) {
    const out = []; const seen = new Set();
    for (const part of String(s || '').split(/[\s,;]+/)) {
      const h = normHandle(part);
      if (!h || !/^[a-z0-9_]{1,15}$/.test(h) || seen.has(h)) continue;
      seen.add(h); out.push(h);
    }
    return out;
  }

  // выбор цели «по нику» из постов синдикации: НОВЕЙШИЙ оригинальный пост (не реплай, не репост)
  // внутри окна свежести recencyHours, ещё не отвеченный (replied={id:ts}) и не стоящий в очереди (queued=Set).
  // Берём максимум по createdTs, а не первый в списке: синдикация может отдать закреплённый твит первым.
  // null = у автора нет подходящего. nowTs (сек) инъектируется в тестах.
  function pickFreshOriginal(posts, opts) {
    const o = opts || {};
    const now = o.nowTs != null ? o.nowTs : Math.floor(Date.now() / 1000);
    const minTs = now - Math.max(1, +o.recencyHours || 36) * 3600;
    let best = null;
    for (const p of (posts || [])) {
      if (!p || !p.id || p.isReply || p.isRepost) continue;
      if (!(+p.createdTs >= minTs)) continue;   // и «слишком старый», и битый createdTs (0/NaN) отсекаются здесь
      if (o.replied && o.replied[p.id]) continue;
      if (o.queued && o.queued.has(p.id)) continue;
      if (!best || +p.createdTs > +best.createdTs) best = p;
    }
    return best;
  }

  // обрезка карты отвеченных {postId:ts}: срезаем до keep НИЖЕ cap, чтобы сортировка бегала ~раз в
  // (cap-keep) записей, а не на каждой (тот же приём, что prune в FRO rememberRepliedPost)
  function prunePostMap(map, cap, keep) {
    const keys = Object.keys(map || {});
    if (keys.length <= cap) return map;
    keys.sort((a, b) => map[a] - map[b]);   // старые ts вперёд
    const out = {};
    for (const k of keys.slice(keys.length - keep)) out[k] = map[k];
    return out;
  }

  // человеческая пауза между отправками, мс: min..max сек (max<min нормализуем — защита от кривого ввода)
  function jitterMs(minSec, maxSec, rnd) {
    let lo = Math.max(1, +minSec || 0), hi = Math.max(1, +maxSec || 0);
    if (hi < lo) hi = lo;
    return Math.round((lo + (rnd != null ? rnd : Math.random()) * (hi - lo)) * 1000);
  }

  // ключ дня 'YYYY-MM-DD' — дневной счётчик sentToday сбрасывается при смене дня
  function todayKey(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { normHandle, parseStatusHref, targetFilterReason, collectTargets, parseHandles, pickFreshOriginal, prunePostMap, jitterMs, todayKey };
  }
  if (typeof window === 'undefined') return;   // node-тесты: дальше только браузер

  const Yasia = (window.Yasia = window.Yasia || {});
  if (!Yasia.systems) return;

  // ---------- селекторы X в ОДНОМ месте: первыми ломаются при редизайне X — чинить здесь ----------
  const SEL = {
    tweet: 'article[data-testid="tweet"], article[role="article"][tabindex="0"]',
    anyArticle: 'article[data-testid="tweet"], article[role="article"]',
    tweetText: '[data-testid="tweetText"]',
    timeLink: 'a[href*="/status/"] time',
    statusLink: 'a[href*="/status/"]',
    promo: '[data-testid="placementTracking"]',
    social: '[data-testid="socialContext"]',
    replyBtn: 'button[data-testid="reply"]',
    dialog: 'div[role="dialog"]',
    textbox: 'div[role="dialog"] div[role="textbox"]',
    dlgClose: 'div[role="dialog"] button[data-testid="app-bar-close"], div[role="dialog"] [aria-label="Close"]',
    confirmSheet: '[data-testid="confirmationSheetConfirm"]',
    profileLink: 'a[data-testid="AppTabBar_Profile_Link"], nav a[aria-label="Profile"]',
  };

  // ---------- словарь системы (двуязычный, локально — как G в games.js) ----------
  const R = {
    ru: {
      collect: 'Собрать цели', start: 'Старт ▶', pause: 'Пауза ⏸', resume: 'Дальше ▶', stop: 'Стоп ■', skip: 'Пропустить',
      counter: '{c}/{cap} сегодня',
      stIdle: 'Открой ленту X и нажми «Собрать цели».', stNotX: 'Это не X/Twitter — открой x.com.',
      stCollect: 'Собираю цели со страницы…', stScroll: 'Листаю ленту, добираю цели… ({n})',
      stFound: 'Готово: {n} целей. Жми «Старт».', stNone: 'Подходящих постов не нашла — полистай или открой другую ленту.',
      stNoAI: 'Подключи ИИ-мозг в попапе — без него черновики не пишутся.',
      stCap: 'Дневной лимит достигнут ({n}) — на сегодня хватит 😌', stDone: 'Все цели пройдены ✓ ({n} за сегодня)',
      stGo: 'Иду к посту @{h} ({i}/{n})…', stDraft: 'Пишу черновик для @{h}…',
      stReview: 'Черновик в окне ответа — проверь, поправь и отправь САМ. Или «Пропустить».',
      stSent: 'Отправлено ✓ — следующая через {s}с…', stSkip: 'Пропустила, дальше…',
      stAlready: 'Тут уже есть твой ответ — пропускаю.', stErr: 'Не вышло: {e}', stLoad: 'Пост не загрузился — пропускаю.',
      stComposer: 'Не смогла открыть окно ответа — пропускаю.', stStop: 'Остановилась.', stPause: 'Пауза.',
      needHandle: 'Впиши свой @ник (или зайди в X), чтобы я не отвечала тебе самому.',
      lbHandle: 'Твой @ник', lbCap: 'Лимит/день', lbMin: 'Пауза от, с', lbMax: 'до, с', lbTone: 'Тон',
      toneFriendly: 'Дружелюбный', toneExpert: 'Экспертный', toneWitty: 'Шутливый',
      stWait: 'ждёт', stDrafted: 'черновик', stSentB: '✓ отправлен', stSkipped: 'пропущен',
      petDraft: 'Написала черновик — проверь!', petSent: 'Отправил! Мур~ 🐾',
      hndTitle: 'Цели по @никам', hndList: 'Ники (через запятую)', hndHours: 'Свежесть, часов', hndGo: 'Добавить по никам',
      hndNone: 'Впиши хотя бы один @ник.', hndFetch: 'Смотрю свежее у @{h} ({i}/{n})…', hndDone: 'По никам: добавлено {a}, пропущено {s}.',
      gdAsk: 'Отправлять тексты постов с {host} в ИИ (Hermes/GPT), чтобы я писала черновики ответов? Отправляешь их всё равно ты сам.',
      gdYes: 'Отправлять', gdNo: 'Отмена', gdSafe: '🛡 ИИ выключен стражем — смени режим в настройках.',
      note: 'Кнопку «Ответить» в X жмёшь только ты. Я никогда не отправляю сама.',
    },
    en: {
      collect: 'Collect targets', start: 'Start ▶', pause: 'Pause ⏸', resume: 'Resume ▶', stop: 'Stop ■', skip: 'Skip',
      counter: '{c}/{cap} today',
      stIdle: 'Open any X timeline and press "Collect targets".', stNotX: 'This is not X/Twitter — open x.com.',
      stCollect: 'Collecting targets from the page…', stScroll: 'Scrolling for more targets… ({n})',
      stFound: 'Done: {n} targets. Press Start.', stNone: 'No suitable posts found — scroll or open another timeline.',
      stNoAI: 'Connect the AI brain in the popup — no drafts without it.',
      stCap: 'Daily cap reached ({n}) — enough for today 😌', stDone: 'All targets done ✓ ({n} sent today)',
      stGo: 'Opening @{h}’s post ({i}/{n})…', stDraft: 'Drafting a reply to @{h}…',
      stReview: 'Draft is in the composer — review, edit and send it YOURSELF. Or Skip.',
      stSent: 'Sent ✓ — next in {s}s…', stSkip: 'Skipped, moving on…',
      stAlready: 'You already replied here — skipping.', stErr: 'Failed: {e}', stLoad: 'Post did not load — skipping.',
      stComposer: 'Could not open the composer — skipping.', stStop: 'Stopped.', stPause: 'Paused.',
      needHandle: 'Enter your @handle (or open X logged in) so I never reply to yourself.',
      lbHandle: 'Your @handle', lbCap: 'Daily cap', lbMin: 'Delay from, s', lbMax: 'to, s', lbTone: 'Tone',
      toneFriendly: 'Friendly', toneExpert: 'Expert', toneWitty: 'Witty',
      stWait: 'waiting', stDrafted: 'draft', stSentB: '✓ sent', stSkipped: 'skipped',
      petDraft: 'Drafted a reply — check it!', petSent: 'Sent! Purr~ 🐾',
      hndTitle: 'Targets by @handles', hndList: 'Handles (comma-separated)', hndHours: 'Freshness, hours', hndGo: 'Add by handles',
      hndNone: 'Enter at least one @handle.', hndFetch: 'Checking @{h} ({i}/{n})…', hndDone: 'By handles: added {a}, skipped {s}.',
      gdAsk: 'Send post texts from {host} to the AI (Hermes/GPT) so I can draft replies? You still send them yourself.',
      gdYes: 'Send', gdNo: 'Cancel', gdSafe: '🛡 AI is off by the guard — change the mode in settings.',
      note: 'YOU press X’s real Reply button. I never send for you.',
    },
  };

  // тон реплая -> строка в системный промпт
  const TONES = {
    friendly: { ru: 'Тон: тёплый и дружелюбный.', en: 'Tone: warm and friendly.' },
    expert:   { ru: 'Тон: экспертный, по делу, без воды.', en: 'Tone: expert, to the point, no fluff.' },
    witty:    { ru: 'Тон: лёгкий, с юмором, но без ехидства.', en: 'Tone: light, witty, never snarky.' },
  };

  const QUEUE_KEY = 'yasiaReplyQueue', REPLIED_KEY = 'yasiaRepliedPosts', RECENT_KEY = 'yasiaReplyRecent', CFG_KEY = 'yasiaReplierCfg';
  const CFG_DEF = { myHandle: '', dailyCap: 10, minDelaySec: 25, maxDelaySec: 90, tone: 'friendly', handles: '', recencyHours: 36 };
  const MAX_SCROLLS = 15;   // автоскролл добора целей — плавный и конечный, не «бесконечный робот»

  Yasia.systems.register({
    name: 'replier',
    init(ctx) {
      const root = (ctx && ctx.root) || (ctx && ctx.pet && ctx.pet.root);
      if (!root) return {};                                   // старый pet.js без root -> no-op (не гасим флаг зря)
      const pet = (ctx && ctx.pet) || null;
      const tr = (ctx && ctx.tr) || (() => ({}));
      const storage = (ctx && ctx.storage) || Yasia.storage;
      const L = () => R[(tr() && tr().lang) || 'ru'] || R.ru;
      const fmt = (s, m) => String(s || '').replace(/\{(\w+)\}/g, (_, k) => (m && m[k] != null ? m[k] : ''));
      const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const rand = (lo, hi) => lo + Math.random() * (hi - lo);

      // ---------- состояние ----------
      let cfg = Object.assign({}, CFG_DEF);
      let queue = { active: false, paused: false, targets: [], idx: 0, day: todayKey(), sentToday: 0 };
      let recent = [];        // последние свои реплаи (анти-повтор в промпте)
      let running = false;    // цикл идёт на ЭТОЙ странице (active в storage переживает навигацию)
      let skipFlag = false;   // «Пропустить» у текущей цели
      let ui = null;          // ссылки на элементы панели (панель может и не быть — всё работает без неё)
      let destroyed = false;

      const localGet = (def) => new Promise((res) => { try { storage.localGet(def, res); } catch (_) { res(def); } });
      const saveQueue = () => { try { storage.localSet({ [QUEUE_KEY]: queue }); } catch (_) {} };
      const saveCfg = () => { try { storage.localSet({ [CFG_KEY]: cfg }); } catch (_) {} };

      // отвеченные посты: сериализуем read-modify-write цепочкой, чтобы параллельные записи не теряли друг друга (как в FRO)
      let repliedChain = Promise.resolve();
      function rememberReplied(postId) {
        if (!postId) return;
        repliedChain = repliedChain.then(async () => {
          const s = await localGet({ [REPLIED_KEY]: {} });
          const map = (s && s[REPLIED_KEY]) || {};
          if (map[postId]) return;
          map[postId] = Math.floor(Date.now() / 1000);
          try { storage.localSet({ [REPLIED_KEY]: prunePostMap(map, 3000, 2500) }); } catch (_) {}
        });
      }
      function pushRecent(text) {
        recent.push(String(text || '').slice(0, 300));
        recent = recent.slice(-5);   // ТЗ: последние 5 своих реплаев для анти-повтора
        try { storage.localSet({ [RECENT_KEY]: recent }); } catch (_) {}
      }

      // ---------- транспорт к ИИ: СТРОГО существующий канал background.js (YASIA_AI / codex) ----------
      function sendBg(message) {
        return new Promise((resolve) => {
          try {
            chrome.runtime.sendMessage(message, (r) => {
              const le = chrome.runtime.lastError;
              resolve(le ? { ok: false, error: le.message || 'runtime error' } : (r || { ok: false, error: 'no bg' }));
            });
          } catch (e) { resolve({ ok: false, error: String((e && e.message) || e) }); }
        });
      }
      // конфиг ИИ-мозга читаем свежим из storage (его пишут ai.js/popup) — свои настройки LLM не заводим
      async function aiChat(messages) {
        const s = await localGet({ yasiaAI: null });
        const v = s && s.yasiaAI;
        if (!v || typeof v !== 'object') return { ok: false, noCfg: true };
        const prov = v.provider === 'gpt' ? 'gpt' : 'hermes';
        if (prov === 'gpt' && (((v.gpt && v.gpt.authMode) || 'chatgpt') === 'chatgpt')) {   // подписка ChatGPT -> codex-канал
          const cg = (v.gpt && v.gpt.chatgpt) || {};
          if (!cg.accessToken) return { ok: false, noCfg: true };
          const send = (tok, acct) => sendBg({ type: 'YASIA_CODEX_CHAT', accessToken: tok, accountId: acct, model: (v.gpt && v.gpt.model) || 'gpt-5.5', messages, timeoutMs: 120000 });
          let r = await send(cg.accessToken, cg.accountId);
          if (r && r.status === 401 && cg.refreshToken) {     // токен протух -> освежить и сохранить (ai.js подхватит тот же yasiaAI)
            const rf = await sendBg({ type: 'YASIA_CODEX_REFRESH', refreshToken: cg.refreshToken });
            if (rf && rf.ok) {
              v.gpt.chatgpt = { accessToken: rf.accessToken, refreshToken: rf.refreshToken, accountId: rf.accountId };
              try { storage.localSet({ yasiaAI: v }); } catch (_) {}
              r = await send(rf.accessToken, rf.accountId);
            }
          }
          return r || { ok: false };
        }
        const a = v[prov] || {};
        if (!a.baseUrl || !a.apiKey) return { ok: false, noCfg: true };
        return sendBg({
          type: 'YASIA_AI', baseUrl: a.baseUrl, path: '/v1/chat/completions', apiKey: a.apiKey,
          model: a.model || (prov === 'gpt' ? 'gpt-5.5' : 'hermes-agent'),
          sessionKey: prov === 'hermes' ? (v.sessionKey || '') : '', messages, timeoutMs: 120000,
        });
      }

      // страж: текст постов уходит в LLM -> в safe-режиме отказ, на новый хост — confirm (тот же yasiaAiHosts, что у ai.js)
      async function aiAllowed() {
        const t = L();
        if (Yasia.guard && !Yasia.guard.allows('ai')) { setStatus(t.gdSafe); return false; }
        let host = ''; try { host = location.hostname.replace(/^www\./, ''); } catch (_) {}
        if (!host || !Yasia.guard) return true;
        const s = await localGet({ yasiaAiHosts: {} });
        const hosts = (s && s.yasiaAiHosts) || {};
        if (hosts[host]) return true;
        const ok = await Yasia.guard.confirm({ text: fmt(t.gdAsk, { host }), yes: t.gdYes, no: t.gdNo });
        if (!ok) return false;
        hosts[host] = true; try { storage.localSet({ yasiaAiHosts: hosts }); } catch (_) {}
        return true;
      }

      // промпт: персона из души (core/soul.js) + тон + жёсткая инструкция; user = пост + свои прошлые реплаи
      function draftMessages(postText) {
        const lang = (tr() && tr().lang) || 'ru';
        const soul = (Yasia.soul && Yasia.soul.persona) ? Yasia.soul.persona(lang) : '';
        const tone = (TONES[cfg.tone] || TONES.friendly)[lang === 'en' ? 'en' : 'ru'];
        const instr = lang === 'en'
          ? 'Write ONE short friendly reply to the X/Twitter post below: max 20 words, no hashtags, no emoji spam, in the language OF THE POST. Do not repeat your past replies. Output ONLY the reply text, no quotes.'
          : 'Напиши ОДИН короткий дружелюбный реплай на пост ниже для X/Twitter: до 20 слов, без хэштегов, без спама эмодзи, НА ЯЗЫКЕ САМОГО ПОСТА. Не повторяй свои прошлые реплаи. Выдай ТОЛЬКО текст реплая, без кавычек.';
        const user = (lang === 'en' ? 'Post:\n' : 'Пост:\n') + String(postText || '').slice(0, 1200)
          + (recent.length ? (lang === 'en' ? '\n\nMy recent replies (do NOT repeat their wording):\n- ' : '\n\nМои последние реплаи (НЕ повторяй их формулировки):\n- ') + recent.join('\n- ') : '');
        return [{ role: 'system', content: (soul ? soul + ' ' : '') + tone + ' ' + instr }, { role: 'user', content: user }];
      }
      function cleanDraft(s) {   // модели любят кавычки/нумерацию — X это не нужно
        return String(s || '').trim().replace(/^["'«]+|["'»]+$/g, '').replace(/^\d+[.)]\s*/, '').trim();
      }

      // ---------- DOM-хелперы X (порт из FRO contentScript/reviewQueue) ----------
      function waitFor(fn, interval, timeout) {
        return new Promise((resolve) => {
          const start = Date.now();
          const id = setInterval(() => {
            let v = null; try { v = fn(); } catch (_) {}
            if (v) { clearInterval(id); resolve(v); }
            else if (Date.now() - start > timeout) { clearInterval(id); resolve(null); }
          }, interval);
        });
      }
      function onX() { try { return /(^|\.)x\.com$|(^|\.)twitter\.com$/.test(location.hostname); } catch (_) { return false; } }
      function tweetMeta(card) {   // автор+id из ссылки с <time> (самая стабильная примета карточки)
        let a = card.querySelector(SEL.timeLink);
        a = a ? a.closest('a') : card.querySelector(SEL.statusLink);
        return parseStatusHref(a && a.getAttribute('href'));
      }
      function extractTweetText(card) {   // только текст самого твита, без процитированной карточки (div[role="link"])
        const nodes = card.querySelectorAll(SEL.tweetText);
        return Array.from(nodes)
          .filter((n) => !(n.closest && n.closest('div[role="link"][tabindex="0"]')))
          .map((n) => n.innerText || n.textContent || '').join('\n').trim();
      }
      function isPromoted(card) {
        if (card.querySelector(SEL.promo)) return true;
        for (const s of card.querySelectorAll('span')) { const t = (s.textContent || '').trim(); if (t === 'Promoted' || t === 'Ad' || t === 'Реклама') return true; }
        return false;
      }
      function isRepost(card) {
        const sc = card.querySelector(SEL.social);
        return sc ? /repost|retweet|репост/i.test(sc.textContent || '') : false;
      }
      function scanCards() {   // кандидаты из видимых карточек текущей ленты
        const out = [];
        for (const card of document.querySelectorAll(SEL.tweet)) {
          const meta = tweetMeta(card); if (!meta) continue;
          out.push({ handle: meta.handle, postId: meta.postId, postUrl: meta.postUrl, text: extractTweetText(card), promoted: isPromoted(card), repost: isRepost(card) });
        }
        return out;
      }
      function detectMyHandle() {
        try { const a = document.querySelector(SEL.profileLink); const h = a && a.getAttribute('href'); return h ? normHandle(h.replace(/^\//, '')) : ''; } catch (_) { return ''; }
      }
      function currentStatusId() { const m = location.pathname.match(/\/status\/(\d+)/); return m ? m[1] : null; }
      function focalCard() { return document.querySelector('article[tabindex="-1"]') || document.querySelector('article[data-testid="tweet"]') || null; }
      function onTargetPage(t) { return !!(t && currentStatusId() === t.postId); }
      function composerBox() { return document.querySelector(SEL.textbox); }
      async function openComposer(card) {
        const btn = card.querySelector(SEL.replyBtn); if (!btn) return false;
        btn.click();
        return !!(await waitFor(() => document.querySelector(SEL.dialog), 300, 5000));
      }
      async function closeComposer() {   // закрыть composer (и подтвердить «discard», если X переспросил)
        if (!composerBox()) return;
        const btn = document.querySelector(SEL.dlgClose);
        if (btn) btn.click();
        else document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape', keyCode: 27 }));
        const confirm = await waitFor(() => document.querySelector(SEL.confirmSheet), 150, 1800);
        if (confirm) confirm.click();
        await sleep(350);
      }
      // вставка в Draft.js composer — три стратегии из FRO (paste -> execCommand -> ручной DOM с синтетикой)
      function setComposerText(el, text) {
        el.focus();
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(el); sel.removeAllRanges(); sel.addRange(range);
        try {   // 1) синтетический paste: Draft.js сам построит правильный EditorState (ни «призраков», ни дублей)
          const dt = new DataTransfer(); dt.setData('text/plain', text);
          el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
          return;
        } catch (_) {}
        if (document.execCommand && document.execCommand('insertText', false, text)) {   // 2) insertText, с проверкой на дубль от реконсиляции React
          const cur = (el.innerText || el.textContent || '').trim();
          if (cur.length > text.length && cur === text + text) {
            while (el.firstChild) el.removeChild(el.firstChild);
            el.appendChild(document.createTextNode(text));
          }
          return;
        }
        while (el.firstChild) el.removeChild(el.firstChild);   // 3) последний шанс: DOM + синтетические input-события
        el.appendChild(document.createTextNode(text));
        el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }));
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      }
      // верх блока рекомендаций «Discover more»: твиты ниже него — НЕ ответы на фокальный пост
      function discoverMoreTop() {
        for (const el of document.querySelectorAll('[role="heading"], h2, span')) {
          const t = (el.textContent || '').trim();
          if (t === 'Discover more' || t === 'More Tweets you may like' || t === 'Ещё твиты') return el.getBoundingClientRect().top + window.scrollY;
        }
        return Infinity;
      }
      // «я уже ответил на ЭТОТ пост?» — мои твиты НИЖЕ фокального и ВЫШЕ «Discover more» (порт pageHasMyReply из FRO:
      // выше фокального — предки треда, ниже cutoff — рекомендации; и то и другое считать «моим ответом» нельзя)
      function pageHasMyReply(me) {
        if (!me) return false;
        const focalId = currentStatusId();
        const arts = Array.from(document.querySelectorAll(SEL.anyArticle));
        let fi = arts.findIndex((a) => a.getAttribute('tabindex') === '-1');
        if (fi < 0 && focalId) fi = arts.findIndex((a) => { const m = tweetMeta(a); return m && m.postId === focalId; });
        if (fi < 0) return false;   // фокальный ещё не отрисован -> судить нельзя -> «не отвечал»
        const cutoffY = discoverMoreTop();
        for (let i = fi + 1; i < arts.length; i++) {
          const a = arts[i];
          if (a.getBoundingClientRect().top + window.scrollY >= cutoffY) break;
          const m = tweetMeta(a); if (!m || m.postId === focalId) continue;
          if (m.handle === me) return true;
        }
        return false;
      }
      async function alreadyReplied() {   // с одним «пинком» скролла: X может лениво грузить ответы под сгибом
        const me = normHandle(cfg.myHandle) || detectMyHandle();
        if (!me) return false;
        if (pageHasMyReply(me)) return true;
        window.scrollBy({ top: 700 }); await sleep(1200);
        const found = pageHasMyReply(me);
        window.scrollTo({ top: 0 });
        return found;
      }

      // ---------- питомец в деле (всё опционально — работает и без pet API) ----------
      function petDraftDone() {
        if (!pet) return;
        try {
          pet.say && pet.say(L().petDraft, 3200);
          const box = composerBox();
          const r = box && box.getBoundingClientRect();
          // walkTo ведёт питомца только пока он «забран» (так устроен главный цикл pet.js для игр) —
          // забираем на пару секунд и отпускаем; занят другим (игра/скачивание) — просто не бежим
          if (r && pet.claim && pet.claim('replier')) {
            pet.walkTo(r.left + Math.min(r.width / 2, 160), true);
            setTimeout(() => { try { if (pet.id && pet.id() === 'replier') pet.release(); } catch (_) {} }, 4000);
          }
        } catch (_) {}
      }
      function petSent() {
        if (!pet) return;
        try { pet.emote && pet.emote('like_proud', 1600); pet.happy && pet.happy(1200); pet.say && pet.say(L().petSent, 2200); } catch (_) {}
      }

      // ---------- сбор целей из DOM текущей ленты (+плавный автоскролл добора) ----------
      let collecting = false;
      async function collect() {
        if (collecting || collectingH || running) return;
        const t = L();
        if (!onX()) { setStatus(t.stNotX); return; }
        let me = normHandle(cfg.myHandle) || detectMyHandle();
        if (!me) { setStatus(t.needHandle); return; }   // без своего ника нельзя ни фильтровать себя, ни детектить отправку
        if (!cfg.myHandle) { cfg.myHandle = me; saveCfg(); if (ui && ui.inHandle) ui.inHandle.value = me; }
        collecting = true; syncButtons();
        setStatus(t.stCollect);
        try {
          const s = await localGet({ [REPLIED_KEY]: {} });
          const replied = (s && s[REPLIED_KEY]) || {};
          if (queue.day !== todayKey()) { queue.day = todayKey(); queue.sentToday = 0; }
          const want = Math.max(1, (+cfg.dailyCap || CFG_DEF.dailyCap) - queue.sentToday);
          const seen = new Set(); const targets = [];
          for (let i = 0; ; i++) {
            targets.push(...collectTargets(scanCards(), { myHandle: me, replied, seen, max: want - targets.length }));
            if (targets.length >= want || i >= MAX_SCROLLS || destroyed) break;
            setStatus(fmt(t.stScroll, { n: targets.length }));
            window.scrollBy({ top: 500 + Math.random() * 400, behavior: 'smooth' });   // плавный добор, по-человечески
            await sleep(rand(600, 900));
          }
          queue = { active: false, paused: false, targets, idx: 0, day: todayKey(), sentToday: queue.sentToday };
          saveQueue(); renderList(); updateCounter();
          setStatus(targets.length ? fmt(t.stFound, { n: targets.length }) : t.stNone);
        } finally { collecting = false; syncButtons(); }
      }

      // ---------- второй источник целей: «по @никам» через синдикацию Twitter (fetch в background — CORS) ----------
      // Для каждого ника берём ОДИН новейший оригинальный пост внутри окна свежести и ДОБАВЛЯЕМ к очереди
      // (не заменяем собранное из ленты). Задержка 300–500 мс между никами — не долбить синдикацию очередью.
      let collectingH = false;
      async function collectByHandles() {
        if (collectingH || collecting || running) return;
        const t = L();
        const handles = parseHandles(cfg.handles);
        if (!handles.length) { setStatus(t.hndNone); return; }
        collectingH = true; syncButtons();
        try {
          const s = await localGet({ [REPLIED_KEY]: {} });
          const replied = (s && s[REPLIED_KEY]) || {};
          const me = normHandle(cfg.myHandle) || detectMyHandle();
          const queued = new Set(queue.targets.map((x) => x.postId));   // не дублировать уже стоящее в очереди
          let added = 0, skipped = 0;
          for (let i = 0; i < handles.length; i++) {
            if (destroyed) break;
            const h = handles[i];
            setStatus(fmt(t.hndFetch, { h, i: i + 1, n: handles.length }));
            if (me && h === me) { skipped++; continue; }   // себе не отвечаем и здесь
            const r = await sendBg({ type: 'YASIA_SYND_TIMELINE', handle: h });
            const best = (r && r.ok) ? pickFreshOriginal(r.posts, { recencyHours: cfg.recencyHours, replied, queued }) : null;
            if (best) {
              queued.add(best.id);
              queue.targets.push({ handle: h, postId: best.id, postUrl: best.url || ('https://x.com/' + h + '/status/' + best.id), text: String(best.text || '').slice(0, 600), st: 'wait' });
              added++;
            } else skipped++;   // нет свежего оригинала / уже отвечен / ник не существует / сеть — всё «пропущено»
            if (i < handles.length - 1) await sleep(rand(300, 500));
          }
          saveQueue(); renderList(); updateCounter();
          setStatus(fmt(t.hndDone, { a: added, s: skipped }));
        } finally { collectingH = false; syncButtons(); }
      }

      // ---------- обход целей ----------
      async function startWalk() {
        if (running || collectingH || !queue.targets.length) return;
        const t = L();
        if (queue.day !== todayKey()) { queue.day = todayKey(); queue.sentToday = 0; }
        if (queue.sentToday >= (+cfg.dailyCap || CFG_DEF.dailyCap)) { setStatus(fmt(t.stCap, { n: queue.sentToday })); return; }
        const ai = await localGet({ yasiaAI: null });   // честный отказ ДО старта, а не на первой цели
        if (!(ai && ai.yasiaAI)) { setStatus(t.stNoAI); return; }
        if (!(await aiAllowed())) return;
        queue.active = true; queue.paused = false;
        if (queue.idx >= queue.targets.length) queue.idx = 0;
        saveQueue();
        running = true; syncButtons();
        loop();
      }
      function pauseWalk() { queue.paused = !queue.paused; saveQueue(); syncButtons(); setStatus(queue.paused ? L().stPause : ''); }
      async function stopWalk() {
        running = false; skipFlag = true;   // skipFlag выбьет waitReview, running=false не даст шагнуть дальше
        queue.active = false; queue.paused = false; saveQueue(); syncButtons();
        await closeComposer();
        setStatus(L().stStop);
      }
      function skipCurrent() { skipFlag = true; }

      async function loop() {
        const t = L();
        while (running && queue.active && !destroyed) {
          if (queue.paused) { await sleep(400); continue; }
          if (queue.sentToday >= (+cfg.dailyCap || CFG_DEF.dailyCap)) { finish(fmt(t.stCap, { n: queue.sentToday })); return; }
          const tg = queue.targets[queue.idx];
          if (!tg) { finish(fmt(t.stDone, { n: queue.sentToday })); return; }
          if (tg.st === 'sent' || tg.st === 'skip') { queue.idx++; saveQueue(); continue; }
          if (!onTargetPage(tg)) {   // переход: страница перезагрузится, продолжение — из resume() на новой
            setStatus(fmt(t.stGo, { h: tg.handle, i: queue.idx + 1, n: queue.targets.length }));
            saveQueue();
            location.assign(tg.postUrl);
            return;
          }
          await processTarget(tg);
        }
      }
      function finish(msg) {
        running = false; queue.active = false; saveQueue(); syncButtons(); setStatus(msg);
      }
      function markSkip(tg) { tg.st = 'skip'; queue.idx++; saveQueue(); renderList(); }

      async function processTarget(tg) {
        const t = L();
        const card = await waitFor(focalCard, 350, 9000);
        if (!card) { setStatus(t.stLoad); markSkip(tg); await sleep(rand(800, 1600)); return; }
        await sleep(rand(900, 1800));   // по-человечески: «прочитать» пост перед действием
        if (await alreadyReplied()) {   // уже отвечал (в т.ч. руками на вебе) -> запомнить и не дёргать composer
          rememberReplied(tg.postId);
          setStatus(t.stAlready); markSkip(tg); await sleep(rand(800, 1600)); return;
        }
        setStatus(fmt(t.stDraft, { h: tg.handle }));
        const text = tg.text || extractTweetText(card);
        const res = await aiChat(draftMessages(text));
        if (!res || !res.ok) {
          if (res && res.noCfg) { finish(t.stNoAI); return; }   // мозг отвалился целиком -> стоп, а не молча скипать всё
          setStatus(fmt(t.stErr, { e: (res && res.error) || '?' })); markSkip(tg); await sleep(rand(1000, 2000)); return;
        }
        const draft = cleanDraft(res.content);
        if (!draft) { setStatus(fmt(t.stErr, { e: 'empty' })); markSkip(tg); await sleep(rand(1000, 2000)); return; }
        await closeComposer();   // чужой открытый composer не должен съесть наш черновик
        const opened = await openComposer(card);
        const box = opened && await waitFor(composerBox, 250, 7000);
        if (!box) { setStatus(t.stComposer); markSkip(tg); await sleep(rand(800, 1600)); return; }
        setComposerText(box, draft);
        tg.st = 'draft'; saveQueue(); renderList();
        petDraftDone();
        setStatus(t.stReview); syncButtons();

        const outcome = await waitReview();   // ЧЕЛОВЕК отправляет или пропускает — мы только ждём
        syncButtons();
        if (outcome === 'skip') {
          await closeComposer();
          if (!running) return;   // это был Стоп
          setStatus(t.stSkip); markSkip(tg); await sleep(rand(600, 1500)); return;
        }
        // composer закрылся сам: отправлено или закрыто без отправки? Судим по DOM (мой реплай появился на странице)
        await sleep(900);
        if (await alreadyReplied()) {
          rememberReplied(tg.postId); pushRecent(draft);
          tg.st = 'sent'; queue.sentToday++; queue.idx++; saveQueue(); renderList(); updateCounter();
          petSent();
          await humanDelay();   // пауза между отправками minDelaySec..maxDelaySec
        } else {
          setStatus(t.stSkip); markSkip(tg); await sleep(rand(600, 1500));   // закрыл не отправив -> пост остаётся неотвеченным, но цель пропускаем
        }
      }

      // ожидание решения человека: composer закрылся (отправил/закрыл) или нажат «Пропустить»/«Стоп»
      function waitReview() {
        skipFlag = false;
        return new Promise((resolve) => {
          const iv = setInterval(() => {
            if (skipFlag || !running) { clearInterval(iv); resolve('skip'); return; }
            if (!composerBox()) { clearInterval(iv); resolve('closed'); }
          }, 400);
        });
      }
      async function humanDelay() {
        let secs = Math.round(jitterMs(cfg.minDelaySec, cfg.maxDelaySec) / 1000);
        while (secs > 0 && running) {
          if (queue.paused) { await sleep(400); continue; }
          setStatus(fmt(L().stSent, { s: secs }));
          await sleep(1000); secs--;
        }
      }

      // ---------- панель: Yasia.replier.renderPanel(box) — контейнер даёт вызывающий (диалог питомца) ----------
      function injectStyles() {
        if (document.getElementById('twtr-rep-style')) return;
        const s = document.createElement('style');
        s.id = 'twtr-rep-style';
        s.textContent = [
          '.twtr-rep{font:12px system-ui;color:inherit}',
          '.twtr-rep-count{font-weight:700;margin-bottom:2px}',
          '.twtr-rep-status{min-height:28px;font-size:11px;opacity:.85;margin:4px 0}',
          '.twtr-rep-note{font-size:10px;opacity:.6;margin:4px 0}',
          '.twtr-rep-cfg{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0}',
          '.twtr-rep-f{display:flex;flex-direction:column;gap:2px;font-size:10px;opacity:.9;flex:1;min-width:70px}',
          '.twtr-rep-f.wide{flex:2;min-width:140px}',
          '.twtr-rep-hnd{border-top:1px solid rgba(128,128,128,.3);margin-top:6px;padding-top:6px}',
          '.twtr-rep-hnd-t{font-weight:700;font-size:11px;margin-bottom:2px}',
          '.twtr-rep-f input,.twtr-rep-f select{width:100%;box-sizing:border-box;background:rgba(0,0,0,.25);color:inherit;border:1px solid rgba(128,128,128,.45);border-radius:6px;padding:4px;font:11px system-ui}',
          '.twtr-rep-btns{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0}',
          '.twtr-rep-btns button{flex:1;min-width:64px;border:1px solid rgba(128,128,128,.45);background:rgba(128,128,128,.18);color:inherit;border-radius:8px;padding:6px 8px;font:600 11px system-ui;cursor:pointer}',
          '.twtr-rep-btns button.twtr-rep-primary{background:#1d9bf0;border-color:#1d9bf0;color:#fff}',
          '.twtr-rep-btns button:disabled{opacity:.4;cursor:default}',
          '.twtr-rep-list{max-height:180px;overflow:auto;display:flex;flex-direction:column;gap:4px;margin-top:6px}',
          '.twtr-rep-it{display:flex;gap:6px;align-items:center;border:1px solid rgba(128,128,128,.3);border-radius:8px;padding:4px 6px}',
          '.twtr-rep-it.cur{border-color:#1d9bf0}',
          '.twtr-rep-it-tx{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}',
          '.twtr-rep-it-st{font-size:10px;opacity:.75;white-space:nowrap}',
          '.twtr-rep-it-st.sent{color:#4caf50;opacity:1}',
          '.twtr-rep-skip{border:1px solid rgba(128,128,128,.45);background:transparent;color:inherit;border-radius:6px;font:10px system-ui;cursor:pointer;padding:2px 6px}',
        ].join('\n');
        (document.head || document.documentElement).appendChild(s);
      }
      function renderPanel(box) {
        if (!box) return;
        injectStyles();
        const t = L();
        box.innerHTML =
          '<div class="twtr-rep">' +
            '<div class="twtr-rep-count"></div>' +
            '<div class="twtr-rep-status"></div>' +
            '<div class="twtr-rep-cfg">' +
              '<label class="twtr-rep-f"><span>' + esc(t.lbHandle) + '</span><input data-k="myHandle" type="text" placeholder="@you"></label>' +
              '<label class="twtr-rep-f"><span>' + esc(t.lbCap) + '</span><input data-k="dailyCap" type="number" min="1"></label>' +
              '<label class="twtr-rep-f"><span>' + esc(t.lbMin) + '</span><input data-k="minDelaySec" type="number" min="5"></label>' +
              '<label class="twtr-rep-f"><span>' + esc(t.lbMax) + '</span><input data-k="maxDelaySec" type="number" min="5"></label>' +
              '<label class="twtr-rep-f"><span>' + esc(t.lbTone) + '</span><select data-k="tone">' +
                '<option value="friendly">' + esc(t.toneFriendly) + '</option>' +
                '<option value="expert">' + esc(t.toneExpert) + '</option>' +
                '<option value="witty">' + esc(t.toneWitty) + '</option>' +
              '</select></label>' +
            '</div>' +
            '<div class="twtr-rep-btns">' +
              '<button class="twtr-rep-primary" data-a="collect" type="button">' + esc(t.collect) + '</button>' +
              '<button data-a="start" type="button">' + esc(t.start) + '</button>' +
              '<button data-a="pause" type="button">' + esc(t.pause) + '</button>' +
              '<button data-a="stop" type="button">' + esc(t.stop) + '</button>' +
            '</div>' +
            '<div class="twtr-rep-hnd">' +
              '<div class="twtr-rep-hnd-t">' + esc(t.hndTitle) + '</div>' +
              '<div class="twtr-rep-cfg">' +
                '<label class="twtr-rep-f wide"><span>' + esc(t.hndList) + '</span><input data-k="handles" type="text" placeholder="@nick1, @nick2"></label>' +
                '<label class="twtr-rep-f"><span>' + esc(t.hndHours) + '</span><input data-k="recencyHours" type="number" min="1"></label>' +
              '</div>' +
              '<div class="twtr-rep-btns"><button data-a="handles" type="button">' + esc(t.hndGo) + '</button></div>' +
            '</div>' +
            '<div class="twtr-rep-note">' + esc(t.note) + '</div>' +
            '<div class="twtr-rep-list"></div>' +
          '</div>';
        ui = {
          box,
          count: box.querySelector('.twtr-rep-count'),
          status: box.querySelector('.twtr-rep-status'),
          list: box.querySelector('.twtr-rep-list'),
          btnCollect: box.querySelector('[data-a="collect"]'),
          btnStart: box.querySelector('[data-a="start"]'),
          btnPause: box.querySelector('[data-a="pause"]'),
          btnStop: box.querySelector('[data-a="stop"]'),
          btnHandles: box.querySelector('[data-a="handles"]'),
          inHandle: box.querySelector('[data-k="myHandle"]'),
        };
        // настройки: показать сохранённое, писать на change
        box.querySelectorAll('[data-k]').forEach((i) => {
          const k = i.getAttribute('data-k');
          i.value = cfg[k] != null ? cfg[k] : '';
          ['mousedown', 'keydown', 'click'].forEach((ev) => i.addEventListener(ev, (e) => e.stopPropagation()));   // не отдавать клики странице/питомцу
          i.addEventListener('change', () => {
            if (k === 'myHandle') cfg.myHandle = normHandle(i.value);
            else if (k === 'handles') cfg.handles = String(i.value || '').slice(0, 2000);   // сырой ввод: парсим на запуске, чтобы не «съедать» текст под руками
            else if (k === 'tone') cfg.tone = TONES[i.value] ? i.value : 'friendly';
            else cfg[k] = Math.max(k === 'dailyCap' || k === 'recencyHours' ? 1 : 5, parseInt(i.value, 10) || CFG_DEF[k]);
            if (cfg.maxDelaySec < cfg.minDelaySec) cfg.maxDelaySec = cfg.minDelaySec;
            saveCfg(); updateCounter();
          });
        });
        ui.btnCollect.addEventListener('click', (e) => { e.stopPropagation(); collect(); });
        ui.btnStart.addEventListener('click', (e) => { e.stopPropagation(); startWalk(); });
        ui.btnPause.addEventListener('click', (e) => { e.stopPropagation(); pauseWalk(); });
        ui.btnStop.addEventListener('click', (e) => { e.stopPropagation(); stopWalk(); });
        ui.btnHandles.addEventListener('click', (e) => { e.stopPropagation(); collectByHandles(); });
        ui.list.addEventListener('click', (e) => {   // делегирование «Пропустить» у текущей (не пере-навешивать на каждый рендер)
          const b = e.target.closest && e.target.closest('.twtr-rep-skip'); if (!b) return;
          e.stopPropagation(); skipCurrent();
        });
        updateCounter(); renderList(); syncButtons();
        setStatus(queue.targets.length ? fmt(t.stFound, { n: queue.targets.length }) : t.stIdle);
      }
      function setStatus(msg) { if (ui && ui.status && msg != null) ui.status.textContent = msg; }
      function updateCounter() { if (ui && ui.count) ui.count.textContent = fmt(L().counter, { c: queue.sentToday, cap: cfg.dailyCap }); }
      function stLabel(st) {
        const t = L();
        return st === 'sent' ? t.stSentB : st === 'skip' ? t.stSkipped : st === 'draft' ? t.stDrafted : t.stWait;
      }
      function renderList() {
        if (!ui || !ui.list) return;
        const t = L();
        ui.list.innerHTML = queue.targets.map((tg, i) => {
          const cur = i === queue.idx && (tg.st === 'wait' || tg.st === 'draft');
          return '<div class="twtr-rep-it' + (cur ? ' cur' : '') + '">' +
            '<div class="twtr-rep-it-tx" title="' + esc(tg.text) + '">@' + esc(tg.handle) + ' — ' + esc(String(tg.text || '').slice(0, 70)) + '</div>' +
            '<span class="twtr-rep-it-st' + (tg.st === 'sent' ? ' sent' : '') + '">' + esc(stLabel(tg.st)) + '</span>' +
            (cur && running ? '<button class="twtr-rep-skip" type="button">' + esc(t.skip) + '</button>' : '') +
          '</div>';
        }).join('');
      }
      function syncButtons() {
        if (!ui) return;
        const t = L();
        ui.btnCollect.disabled = collecting || collectingH || running;
        ui.btnHandles.disabled = collecting || collectingH || running;
        ui.btnStart.disabled = running || collectingH || !queue.targets.length;
        ui.btnPause.disabled = !running;
        ui.btnStop.disabled = !running;
        ui.btnPause.textContent = queue.paused ? t.resume : t.pause;
      }

      // ---------- загрузка состояния + авто-продолжение после навигации между целями ----------
      storage.localGet({ [CFG_KEY]: null, [QUEUE_KEY]: null, [RECENT_KEY]: [] }, (s) => {
        if (destroyed) return;
        if (s && s[CFG_KEY] && typeof s[CFG_KEY] === 'object') cfg = Object.assign({}, CFG_DEF, s[CFG_KEY]);
        if (Array.isArray(s && s[RECENT_KEY])) recent = s[RECENT_KEY].slice(-5);
        const q = s && s[QUEUE_KEY];
        if (q && Array.isArray(q.targets)) queue = Object.assign({ active: false, paused: false, targets: [], idx: 0, day: todayKey(), sentToday: 0 }, q);
        updateCounter(); renderList(); syncButtons();
        // продолжаем ТОЛЬКО на странице своей цели (т.е. после нашего же location.assign) —
        // обычный сёрфинг пользователя никогда не хайджекается (принцип FRO boot/resume)
        if (queue.active && queue.day === todayKey() && queue.targets.length && onTargetPage(queue.targets[queue.idx])) {
          running = true; syncButtons();
          sleep(rand(1200, 2200)).then(() => { if (!destroyed && running) loop(); });
        } else if (queue.active) {
          queue.active = false; saveQueue();   // сессия оборвалась не на цели (закрыл вкладку и т.п.) -> честно гасим
        }
      });

      Yasia.replier = { renderPanel };   // точку встраивания панели даёт другой разработчик (диалог питомца)

      return {
        renderPanel,
        destroy() { destroyed = true; running = false; skipFlag = true; if (Yasia.replier && Yasia.replier.renderPanel === renderPanel) delete Yasia.replier; },
      };
    },
    destroy(inst) { if (inst && inst.destroy) inst.destroy(); },
  });
})();
