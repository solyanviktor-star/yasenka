// Система «ИИ-мозг» (v0.8 — Hermes/GPT Brain). Превращает Ясю в интерфейс к Hermes Agent (Nous Research).
// Hermes крутится локально и поднимает OpenAI-совместимый API-сервер (POST /v1/chat/completions, Bearer-ключ).
// Расширение НЕ хранит ключей LLM — только адрес ТВОЕГО локального Hermes + его ключ; провайдерские ключи живут в Hermes.
// Запрос ВСЕГДА идёт через background.js (YASIA_AI) — так обходим CORS/mixed-content (фетч в origin расширения от CORS освобождён).
// Поверхности: (1) меню по выделению текста на странице, (2) поле «спроси» в окне, (3) панель «ИИ» (статус + настройка + быстрые действия).
// Самодостаточна: общается с pet.js через ctx.pet (say/emote/happy) и шину (notes:add). Падение тут гасит флаг aiAssistant — питомец живёт.
(() => {
  'use strict';
  const Yasia = (window.Yasia = window.Yasia || {});
  if (!Yasia.systems) return;

  const CFG = (Yasia.config && Yasia.config.AI) || {};
  const LOGOS = CFG.logos || { hermes: '', gpt: '' };   // квадратные SVG-значки провайдеров (из config.js)
  const HCFG = CFG.hermes || {}, GCFG = CFG.gpt || {};
  const DEF_PATH = CFG.path || '/v1/chat/completions';
  const N = CFG.variants || 3;                                  // сколько вариантов просить для ответа/комментария
  // дефолты по двум провайдерам (оба OpenAI-совместимые: POST /v1/chat/completions)
  const PROV_DEFAULTS = {
    hermes: { baseUrl: HCFG.baseUrl || 'http://127.0.0.1:8642', apiKey: '', model: HCFG.model || 'hermes-agent' },
    gpt: { baseUrl: GCFG.baseUrl || 'https://api.openai.com', apiKey: '', model: GCFG.model || 'gpt-5.5', authMode: 'chatgpt', chatgpt: { accessToken: '', refreshToken: '', accountId: '' } },   // authMode: 'chatgpt' (подписка, device-code) | 'key' (обычный API-ключ)
    other: { baseUrl: '', apiKey: '', model: '', presetId: '' },   // «Другой»: любой OpenAI-совместимый провайдер (baseUrl+ключ+модель)
  };
  const PROVIDERS = CFG.providers || [];   // пресеты для вкладки «Другой» (config.js: OpenRouter/Groq/DeepSeek/…)
  const STORE_KEY = 'yasiaAI';
  const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
  const pick = (a) => (Array.isArray(a) && a.length) ? a[Math.floor(Math.random() * a.length)] : '';

  // ---------- тексты системы (свой словарь; язык берём из общего tr().lang) ----------
  const AL = {
    ru: {
      act: { explain: 'Объяснить', translate: 'Перевести', compress: 'Сжать', reply: 'Ответ', advice: 'Совет', save: 'Сохранить' },
      title: { explain: '💡 Объясняю', translate: '🌐 Перевод', summarizePost: '✂️ Выжимка', summarizeThread: '🧵 Выжимка треда', reply: '💬 Варианты ответа', comment: '💬 Варианты комментария', advice: '🧭 Совет', find: '🔎 Поиск', ask: '🐱 Яся думает', explainPage: '📄 О странице' },
      think: {
        explain: ['Щас разложу по полочкам…', 'Так, что тут у нас…'],
        translate: ['Перевожу, мур…', 'Ща переведу…'],
        summarizePost: ['Сжимаю до сути…', 'Выжимаю главное…'],
        summarizeThread: ['Читаю весь тред, погоди…', 'Собираю суть треда…'],
        reply: ['Ща придумаю что-нибудь острое, но не кринжовое…', 'Сейчас выдам пару дерзких вариантов…'],
        comment: ['Думаю над комментом…', 'Ща будет умно и живо…'],
        advice: ['Дам совет, мур…', 'Сейчас подскажу…'],
        find: ['Иду искать…', 'Ща нарою инфу…'],
        default: ['Думаю…', 'Секунду, мур…'],
      },
      saidCopy: ['Скопировала — вставляй! 😼', 'Готово, держи 📋', 'Лови, вставляй где надо~'],
      saidSave: ['Сохранила в заметки 📝', 'Запомнила! 🐾'],
      copy: 'Копировать', copied: '✓ Скопировано', openTool: 'Открыть ↓',
      remindOk: 'Поняла, напомню! ⏰', remindBad: 'А когда напомнить? Скажи время — «через 10 минут», «завтра в 9».', remindFail: 'Хм, не вышло поставить напоминание.',
      remTitle: '⏰ Напоминания', remEmpty: 'Пока нет напоминаний.', remDel: 'Удалить', remFiredPrefix: '⏰ Напоминаю:',
      memFactsTitle: '🧠 Что я о тебе помню', memPlacesTitle: '🗺 Где мы были', memEmptyFacts: 'Пока ничего не запомнила.', memEmptyPlaces: 'Сайтов пока нет.', memForgetFacts: 'Забыть всё', memForgetPlaces: 'Очистить журнал',
      sklTitle: '🛠 Мои навыки', sklEmpty: 'Навыков пока нет — скажи «выучи навык: …» или я сама предложу после задач.', sklLearned: 'Выучила навык', sklImproved: 'Докрутила навык', sklNoSkill: 'Не нашла такой навык — глянь список в панели ИИ.', sklHermesOnly: 'Этот навык исполняет мозг Hermes, а сейчас подключён GPT. Переключись на Hermes в настройках ИИ-мозга — и сделаю.',
      gdAiSafe: '🛡 Безопасный режим: ИИ выключен — текст страницы не покидает браузер. Смени режим в настройках (⚙), чтобы спросить.',
      gdAiAskHost: 'Отправить текст этой страницы ({host}) в ИИ (Hermes/GPT), чтобы я могла ответить? Запомню разрешение для этого сайта.',
      gdAiYes: 'Отправлять', gdAiNo: 'Отмена',
      connected: '🟢 Подключено', notConnected: '⚪ ИИ не настроен',
      settingsBtn: '⚙ Подключить ИИ', qExplainPage: '📄 Объяснить страницу', qSummThread: '🧵 Сжать тред',
      provOther: 'Другой', lbPreset: 'Провайдер', pickModel: '— выбрать модель —', customModel: '✎ Своя модель…',
      cfgHintOther: 'Любой OpenAI-совместимый провайдер (OpenRouter, Groq, DeepSeek, Together, свой эндпоинт…). Выбери из списка или впиши адрес и ключ вручную. Ключ хранится локально и не синкается.',
      quickTitle: 'Быстрые действия:',
      cfgUrl: 'Адрес API', cfgKey: 'API-ключ', cfgModel: 'Модель',
      cfgTest: 'Проверить связь', cfgSave: 'Сохранить', cfgTesting: 'Проверяю…', cfgOk: '🟢 Связь есть', cfgFail: 'Не вышло', cfgSaved: '✓ Сохранено', cfgModelsLoaded: '🟢 Загружено моделей: {n}',
      cfgHint: 'В Hermes включи канал «API server», задай API_SERVER_KEY, сюда впиши адрес (по умолчанию http://127.0.0.1:8642) и этот ключ.',
      cfgHintGpt: 'Прямое подключение к OpenAI: вставь свой API-ключ (sk-…). Ключ хранится локально на устройстве и не синкается. Можно указать свой адрес OpenAI-совместимого шлюза.',
      provHermes: '🛰 Hermes', provGpt: '🤖 GPT', getKey: '🔑 Где взять ключ ↗',
      setup: 'Сначала подключи мозг — Hermes или GPT.', setupBtn: 'Настроить',
      errNoServer: 'Сервер ИИ не отвечает — проверь адрес и что Hermes/шлюз запущен.',
      errAuth: 'Неверный ключ (401/403).', errPath: 'Эндпоинт не найден (404) — проверь адрес.', errTimeout: 'Слишком долго думает — попробуй ещё раз.',
      amSub: 'Подписка ChatGPT', amKey: 'API-ключ',
      signinBtn: 'Войти через ChatGPT', signedReauth: 'Войти заново', signedIn: '🟢 Вход выполнен',
      signinStart: 'Запрашиваю код…', signinCode: 'Открой страницу и введи код:', signinFail: 'Не вышло войти', signinTimeout: 'Время вышло — попробуй ещё раз',
      cfgHintSub: 'Вход твоим аккаунтом ChatGPT (использует подписку). Откроется страница OpenAI — введи показанный код. ⚠️ Это неофициальный путь (как Codex CLI): возможен отказ Cloudflare и риск для аккаунта. Если не работает — надёжнее через Hermes.',
    },
    en: {
      act: { explain: 'Explain', translate: 'Translate', compress: 'Compress', reply: 'Reply', advice: 'Advice', save: 'Save' },
      title: { explain: '💡 Explaining', translate: '🌐 Translation', summarizePost: '✂️ Summary', summarizeThread: '🧵 Thread summary', reply: '💬 Reply options', comment: '💬 Comment options', advice: '🧭 Advice', find: '🔎 Search', ask: '🐱 Yasya thinking', explainPage: '📄 About page' },
      think: {
        explain: ['Let me break it down…', "Okay, what's going on here…"],
        translate: ['Translating, mrr…', 'One sec, translating…'],
        summarizePost: ['Boiling it down…', 'Getting the gist…'],
        summarizeThread: ['Reading the whole thread…', 'Collecting the thread…'],
        reply: ['Cooking up something sharp but not cringe…', 'Here come a couple of bold takes…'],
        comment: ['Thinking up a comment…', "Gonna be smart and lively…"],
        advice: ['Some advice coming up…', 'Let me think…'],
        find: ['Off to search…', 'Digging up info…'],
        default: ['Thinking…', 'One sec, mrr…'],
      },
      saidCopy: ['Copied — paste away! 😼', 'Done, here you go 📋', 'Got it, paste anywhere~'],
      saidSave: ['Saved to notes 📝', 'Got it memorized! 🐾'],
      copy: 'Copy', copied: '✓ Copied', openTool: 'Open ↓',
      remindOk: 'Got it, I will remind you! ⏰', remindBad: 'When should I remind you? Give a time — “in 10 minutes”, “tomorrow at 9”.', remindFail: 'Hmm, could not set the reminder.',
      remTitle: '⏰ Reminders', remEmpty: 'No reminders yet.', remDel: 'Delete', remFiredPrefix: '⏰ Reminder:',
      memFactsTitle: '🧠 What I remember about you', memPlacesTitle: '🗺 Where we have been', memEmptyFacts: 'Nothing remembered yet.', memEmptyPlaces: 'No sites yet.', memForgetFacts: 'Forget all', memForgetPlaces: 'Clear journal',
      sklTitle: '🛠 My skills', sklEmpty: 'No skills yet — say “learn a skill: …” or I will suggest one after tasks.', sklLearned: 'Learned a skill', sklImproved: 'Improved the skill', sklNoSkill: 'No such skill — check the list in the AI panel.', sklHermesOnly: 'That skill runs on the Hermes brain, but GPT is connected now. Switch to Hermes in the AI-brain settings and I will do it.',
      gdAiSafe: '🛡 Safe mode: AI is off — page text never leaves the browser. Change the mode in settings (⚙) to ask.',
      gdAiAskHost: 'Send the text of this page ({host}) to the AI (Hermes/GPT) so I can answer? I will remember the permission for this site.',
      gdAiYes: 'Send', gdAiNo: 'Cancel',
      connected: '🟢 Connected', notConnected: '⚪ AI not set up',
      settingsBtn: '⚙ Connect AI', qExplainPage: '📄 Explain page', qSummThread: '🧵 Summarize thread',
      provOther: 'Other', lbPreset: 'Provider', pickModel: '— pick a model —', customModel: '✎ Custom model…',
      cfgHintOther: 'Any OpenAI-compatible provider (OpenRouter, Groq, DeepSeek, Together, your own endpoint…). Pick one from the list or type the address and key manually. The key is stored locally and never synced.',
      quickTitle: 'Quick actions:',
      cfgUrl: 'API address', cfgKey: 'API key', cfgModel: 'Model',
      cfgTest: 'Test connection', cfgSave: 'Save', cfgTesting: 'Testing…', cfgOk: '🟢 Connection OK', cfgFail: 'Failed', cfgSaved: '✓ Saved', cfgModelsLoaded: '🟢 Loaded {n} models',
      cfgHint: 'In Hermes enable the «API server» channel, set API_SERVER_KEY, then enter the address (default http://127.0.0.1:8642) and that key here.',
      cfgHintGpt: 'Direct OpenAI connection: paste your API key (sk-…). The key is stored locally on this device and never synced. You may point the address to any OpenAI-compatible gateway.',
      provHermes: '🛰 Hermes', provGpt: '🤖 GPT', getKey: '🔑 Get a key ↗',
      setup: 'Connect a brain first — Hermes or GPT.', setupBtn: 'Set up',
      errNoServer: 'AI server is not responding — check the address and that Hermes/gateway is running.',
      errAuth: 'Wrong key (401/403).', errPath: 'Endpoint not found (404) — check the address.', errTimeout: 'Taking too long — try again.',
      amSub: 'ChatGPT subscription', amKey: 'API key',
      signinBtn: 'Sign in with ChatGPT', signedReauth: 'Sign in again', signedIn: '🟢 Signed in',
      signinStart: 'Requesting code…', signinCode: 'Open the page and enter the code:', signinFail: 'Sign-in failed', signinTimeout: 'Timed out — try again',
      cfgHintSub: 'Sign in with your ChatGPT account (uses your subscription). An OpenAI page opens — enter the shown code. ⚠️ This is an unofficial path (like the Codex CLI): Cloudflare may refuse it and there is account risk. If it fails, Hermes is more reliable.',
    },
  };

  // ---------- инструменты самой Яси (caps), к которым умеет вести МАРШРУТИЗАТОР намерений ----------
  // id здесь = data-skill в окне Яси (pet.js toggleSkill); flag = feature-флаг доступности (flags.js)
  const TOOLS = {
    dl:    { flag: 'mediaDownload', ru: 'скачать видео/гиф/медиа с этой страницы (X, YouTube, TikTok и т.п.)', en: 'download a video/gif/media from this page (X, YouTube, TikTok, etc.)' },
    notes: { flag: 'notes',         ru: 'сохранить заметку, цитату или ссылку', en: 'save a note, quote or link' },
    games: { flag: 'games',         ru: 'запустить мини-игру (догонялки, ловля еды, прятки)', en: 'start a mini-game (chase, catch food, hide & seek)' },
    care:  { flag: 'tamagotchi',    ru: 'забота о Ясе: покормить, погладить, поиграть (тамагочи)', en: 'care for Yasya: feed, pet, play (tamagotchi)' },
  };

  // ---------- инструкции под каждое действие (что именно просим у Hermes) ----------
  const TASKS = {
    explain: { ru: 'Объясни простыми словами, о чём этот текст и что важно понять. Кратко.', en: 'Explain in simple words what this text is about and what matters. Be brief.' },
    explainPage: { ru: 'Кратко объясни, о чём эта страница, по тексту ниже.', en: 'Briefly explain what this page is about, based on the text below.' },
    summarizePost: { ru: 'Сделай краткую выжимку этого поста: 1–3 предложения.', en: 'Summarize this post in 1–3 sentences.' },
    summarizeThread: { ru: 'Сделай выжимку треда: главные тезисы списком (3–6 пунктов).', en: 'Summarize this thread: key points as a short list (3–6 bullets).' },
    translate: { ru: 'Переведи текст на русский. Если он уже на русском — переведи на английский. Выдай ТОЛЬКО перевод, без пояснений.', en: 'Translate the text to English. If it is already in English — translate it to Russian. Output ONLY the translation, no notes.' },
    reply: { ru: 'Придумай ' + N + ' варианта ОТВЕТА на этот пост для X/Twitter: остро и по делу, но без кринжа, коротко (до ~200 символов), в тон обсуждению. Раздели варианты строкой «---», без нумерации и кавычек.', en: 'Draft ' + N + ' REPLY options to this X/Twitter post: sharp and on-point but not cringe, short (~200 chars), matching the tone. Separate options with a line «---», no numbering or quotes.', variants: true },
    comment: { ru: 'Придумай ' + N + ' варианта КОММЕНТАРИЯ к этому тексту: умно и живо, коротко. Раздели строкой «---», без нумерации.', en: 'Draft ' + N + ' COMMENT options for this text: smart and lively, short. Separate with «---», no numbering.', variants: true },
    advice: { ru: 'Дай практический совет по этой ситуации или тексту. Коротко и по делу.', en: 'Give practical advice about this situation or text. Short and to the point.' },
    find: { ru: 'Найди и дай ответ на запрос ниже. Если нужно — используй инструменты. Кратко и по делу.', en: 'Find and answer the query below. Use tools if needed. Be concise.' },
    ask: { ru: 'Ответь на запрос пользователя. Если нужно — используй инструменты Hermes.', en: "Answer the user's request. Use Hermes tools if needed." },
  };

  // персона каждого запроса = ДУША (core/soul.js, неизменяемое ядро личности) + операционные правила агента (что она умеет в браузере)
  function sysPersona(lang) {
    const soul = (Yasia.soul && Yasia.soul.persona) ? Yasia.soul.persona(lang)
      : (lang === 'en' ? "You are Yasya — a witty, friendly cat-girl pet-assistant." : 'Ты — Яся, остроумная дружелюбная кошка-девочка, питомец-помощник.');   // фолбэк, если soul.js не загрузился
    const ops = lang === 'en'
      ? " You live INSIDE the user's web browser on top of whatever page they're viewing (X/Twitter, GitHub, YouTube, any site). "
        + "You are a BROWSER AGENT: you can see the current page whenever its context (URL, title, visible text, and sometimes a list of on-page controls) is included in the message — rely on that to answer about the page, find things on it, and tell the user exactly where to click. "
        + "You act THROUGH the browser, not the OS: you cannot run programs or touch files, and you never click or perform actions yourself — you guide and the user clicks. "
        + "If a request needs page context that wasn't provided, briefly say what you'd need. Stay in character but be genuinely useful: concise and direct."
      : ' Ты живёшь ПРЯМО В БРАУЗЕРЕ пользователя поверх той страницы, что он смотрит (X/Twitter, GitHub, YouTube, любой сайт). '
        + 'Ты — БРАУЗЕРНЫЙ АГЕНТ: ты видишь текущую страницу всегда, когда её контекст (адрес, заголовок, видимый текст, иногда список элементов) приложен к сообщению — опирайся на него, чтобы отвечать про страницу, искать на ней и точно подсказывать, куда нажать. '
        + 'Ты действуешь ЧЕРЕЗ браузер, а не через ОС: не запускаешь программы и не трогаешь файлы, и сама ничего не нажимаешь — ты подсказываешь, а кликает пользователь. '
        + 'Если для запроса нужен контекст страницы, а его не приложили — коротко скажи, что нужно. Оставайся в образе, но будь по-настоящему полезной: кратко и по делу.';
    return soul + ops;
  }

  Yasia.systems.register({
    name: 'ai',
    flag: 'aiAssistant',                                       // ВАЖНО: имя системы 'ai', но управляющий флаг — 'aiAssistant' (иначе реестр ищет флаг 'ai' -> не стартует)
    init(ctx) {
      const root = (ctx && ctx.root) || (ctx && ctx.pet && ctx.pet.root);
      if (!root) return {};                                    // старый pet.js без root — no-op (не падаем, не гасим флаг зря)
      const pet = (ctx && ctx.pet) || null;
      const tr = (ctx && ctx.tr) || (() => ({}));
      const events = (ctx && ctx.events) || Yasia.events;
      const storage = (ctx && ctx.storage) || Yasia.storage;
      const flags = Yasia.flags || { enabled: function () { return true; } };   // доступность инструментов для маршрутизатора
      const L = () => AL[(tr() && tr().lang) || 'ru'] || AL.ru;
      const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');   // и кавычки: esc используется в HTML-атрибутах (data-id="...") — без &quot; строка с кавычкой рвёт атрибут (XSS-паттерн, как в notes.js)

      // ---------- конфиг подключения (в storage.local — ключи остаются на устройстве, не синкаются в облако) ----------
      // структура: { provider:'hermes'|'gpt', sessionKey, hermes:{baseUrl,apiKey,model}, gpt:{baseUrl,apiKey,model} }
      let cfg = {
        provider: CFG.provider || 'hermes', sessionKey: CFG.sessionKey || 'yasia:x',
        hermes: Object.assign({}, PROV_DEFAULTS.hermes), gpt: Object.assign({}, PROV_DEFAULTS.gpt), other: Object.assign({}, PROV_DEFAULTS.other),
      };
      const KNOWN_PROV = { hermes: 1, gpt: 1, other: 1 };
      try {
        storage.localGet({ [STORE_KEY]: null }, (s) => {
          const v = s && s[STORE_KEY];
          if (v && typeof v === 'object') {
            if (KNOWN_PROV[v.provider]) cfg.provider = v.provider;
            if (v.sessionKey) cfg.sessionKey = v.sessionKey;
            if (v.hermes && typeof v.hermes === 'object') cfg.hermes = Object.assign(cfg.hermes, v.hermes);
            if (v.gpt && typeof v.gpt === 'object') cfg.gpt = Object.assign(cfg.gpt, v.gpt);
            if (v.other && typeof v.other === 'object') cfg.other = Object.assign(cfg.other, v.other);
          }
          updateCapIcon();   // поставить логотип сохранённого провайдера после async-загрузки
          loadHermesAbilities();   // подтянуть умения/возможности мозга (если это Hermes)
        });
      } catch (_) {}
      const saveCfg = () => { try { storage.localSet({ [STORE_KEY]: cfg }); } catch (_) {} };
      const active = () => cfg[cfg.provider] || cfg.hermes;       // конфиг текущего провайдера
      const gptChatGpt = () => cfg.provider === 'gpt' && (cfg.gpt.authMode || 'chatgpt') === 'chatgpt';   // GPT в режиме «вход подпиской» (device-code), а не API-ключом
      const isConfigured = () => {
        if (gptChatGpt()) return !!(cfg.gpt.chatgpt && cfg.gpt.chatgpt.accessToken);   // подписка: настроено, если есть токен
        const a = active(); return !!(a && a.baseUrl && a.apiKey);
      };

      // ---------- ДИНАМИЧЕСКИЕ УМЕНИЯ + ВОЗМОЖНОСТИ Hermes (фичадетект; у GPT эндпоинты 404 -> тихо пропускаем) ----------
      let hermesCaps = { checked: false, streaming: false };   // streaming=true -> можно стримить статусы; иначе обычный чат
      let hermesSkills = [];                                    // [{name, desc}] — что умеет сам агент-мозг (веб-поиск, код, …)
      let loadAbilitiesT = 0;
      async function loadHermesAbilities() {
        hermesCaps = { checked: true, streaming: false }; hermesSkills = [];
        if (cfg.provider !== 'hermes') return;                  // только Hermes: у OpenAI/codex этих ручек нет
        const a = active(); if (!a || !a.baseUrl || !a.apiKey) return;
        const myT = (loadAbilitiesT = loadAbilitiesT + 1);      // защита от гонки при быстрой смене конфига
        const cap = await sendBg({ type: 'YASIA_HERMES_GET', baseUrl: a.baseUrl, apiKey: a.apiKey, path: '/v1/capabilities' });
        if (myT !== loadAbilitiesT) return;
        if (cap && cap.ok) hermesCaps.streaming = true;         // ручка ответила -> это Hermes, поток поддержан (на ошибке стрима всё равно откатимся к обычному чату)
        const sk = await sendBg({ type: 'YASIA_HERMES_GET', baseUrl: a.baseUrl, apiKey: a.apiKey, path: '/v1/skills' });
        if (myT !== loadAbilitiesT) return;
        if (sk && sk.ok) hermesCaps.streaming = true;           // любая Hermes-ручка ответила -> это Hermes, пробуем стрим (на ошибке откатимся)
        if (sk && sk.ok && sk.data) {
          const arr = Array.isArray(sk.data) ? sk.data : (sk.data.skills || sk.data.data || []);
          hermesSkills = (arr || []).map((s) => (typeof s === 'string' ? { name: s, desc: '' } : { name: s.name || s.id || '', desc: s.description || s.desc || '' })).filter((s) => s.name).slice(0, 40);
          if (hermesSkills.length) { knownHermesSkills = hermesSkills.map((s) => s.name); try { storage.localSet({ yasiaHermesSkills: knownHermesSkills }); } catch (_) {} }   // запоминаем: на GPT честно скажем «это умеет только Hermes»
        }
      }
      let knownHermesSkills = [];                               // последний известный список навыков Hermes (живёт и когда подключён GPT)
      try { storage.localGet({ yasiaHermesSkills: [] }, (s) => { if (Array.isArray(s && s.yasiaHermesSkills)) knownHermesSkills = s.yasiaHermesSkills; }); } catch (_) {}
      // иконка кнопки навыка «ИИ-мозг» = логотип активного провайдера (Hermes/GPT)
      function updateCapIcon() { try { const ic = root.querySelector('#twtr-cap-ai .twtr-cap-ic'); if (ic && LOGOS[cfg.provider]) ic.innerHTML = LOGOS[cfg.provider]; } catch (_) {} }
      // popup пишет тот же storage.local 'yasiaAI' -> подхватываем смену конфига вживую (без перезагрузки страницы)
      function onStoreChange(ch, area) {
        if (area !== 'local' || !ch || !ch.yasiaAI || !ch.yasiaAI.newValue) return;
        const v = ch.yasiaAI.newValue; if (!v || typeof v !== 'object') return;
        if (v.provider === 'gpt' || v.provider === 'hermes') cfg.provider = v.provider;
        if (v.sessionKey) cfg.sessionKey = v.sessionKey;
        if (v.hermes && typeof v.hermes === 'object') cfg.hermes = Object.assign(cfg.hermes, v.hermes);
        if (v.gpt && typeof v.gpt === 'object') cfg.gpt = Object.assign(cfg.gpt, v.gpt);
        updateCapIcon();
        loadHermesAbilities();   // конфиг сменили -> переоценить умения мозга
      }
      try { chrome.storage.onChanged.addListener(onStoreChange); } catch (_) {}

      // ---------- транспорт: всё через background.js (обход CORS/mixed-content) ----------
      function sendBg(message) {
        return new Promise((resolve) => {
          try {
            chrome.runtime.sendMessage(message, (r) => {
              const le = chrome.runtime.lastError;
              if (le) { resolve({ ok: false, error: le.message || 'runtime error' }); return; }
              resolve(r || { ok: false, error: 'нет ответа от фона' });
            });
          } catch (e) { resolve({ ok: false, error: String((e && e.message) || e) }); }
        });
      }
      async function codexChat(messages, imageUrl) {              // GPT-подписка: через codex-бэкенд, с авто-refresh при 401
        const g = cfg.gpt, cg = g.chatgpt || {};
        const send = (tok, acct) => sendBg({ type: 'YASIA_CODEX_CHAT', accessToken: tok, accountId: acct, model: g.model || 'gpt-5.5', messages, imageUrl, timeoutMs: CFG.timeoutMs || 120000 });
        let r = await send(cg.accessToken, cg.accountId);
        if (r && r.status === 401 && cg.refreshToken) {           // токен протух -> освежить и повторить
          const rf = await sendBg({ type: 'YASIA_CODEX_REFRESH', refreshToken: cg.refreshToken });
          if (rf && rf.ok) { cfg.gpt.chatgpt = { accessToken: rf.accessToken, refreshToken: rf.refreshToken, accountId: rf.accountId }; saveCfg(); r = await send(rf.accessToken, rf.accountId); }
        }
        return r;
      }
      function chat(messages, opts) {
        const imageUrl = (opts && opts.imageUrl) || '';   // опц. скрин страницы (мультимодал)
        if (gptChatGpt()) return codexChat(messages, imageUrl);
        const a = active();
        return sendBg({ type: 'YASIA_AI', baseUrl: a.baseUrl, path: DEF_PATH, apiKey: a.apiKey, model: a.model || 'hermes-agent', sessionKey: cfg.provider === 'hermes' ? (cfg.sessionKey || '') : '', messages, imageUrl, timeoutMs: CFG.timeoutMs || 120000 });
      }
      function ping(profile) {                                   // profile = {baseUrl, apiKey} (текущего или редактируемого провайдера)
        const c = profile || active();
        return sendBg({ type: 'YASIA_AI_PING', baseUrl: c.baseUrl, apiKey: c.apiKey });
      }
      // потоковый чат через Port: handlers = {onProgress({label,tool}), onDelta(text), onDone(content), onError({error})}. Возвращает {stop} или null, если порт не открылся.
      function chatStream(messages, handlers) {
        const a = active(); let port;
        try { port = chrome.runtime.connect({ name: 'yasia-ai-stream' }); } catch (_) { return null; }
        let done = false;
        const finish = (fn, arg) => { if (done) return; done = true; try { fn && fn(arg); } finally { try { port.disconnect(); } catch (_) {} } };
        port.onMessage.addListener((m) => {
          if (!m || done) return;
          if (m.t === 'progress') { try { handlers.onProgress && handlers.onProgress(m); } catch (_) {} }
          else if (m.t === 'delta') { try { handlers.onDelta && handlers.onDelta(m.text || ''); } catch (_) {} }
          else if (m.t === 'done') finish(handlers.onDone, m.content || '');
          else if (m.t === 'error') finish(handlers.onError, m);
        });
        port.onDisconnect.addListener(() => { if (!done) { done = true; try { handlers.onError && handlers.onError({ error: 'disconnected' }); } catch (_) {} } });
        try { port.postMessage({ type: 'start', baseUrl: a.baseUrl, path: DEF_PATH, apiKey: a.apiKey, model: a.model || 'hermes-agent', sessionKey: cfg.provider === 'hermes' ? (cfg.sessionKey || '') : '', messages, timeoutMs: CFG.timeoutMs || 180000 }); }
        catch (_) { return null; }
        return { stop: () => { try { port.disconnect(); } catch (_) {} } };
      }

      function friendlyErr(res, t) {
        if (!res) return t.errNoServer;
        if (res.status === 401 || res.status === 403) return t.errAuth;
        if (res.status === 404) return t.errPath;
        const m = String(res.error || '');
        if (/failed to fetch|networkerror|load failed|econnrefused|err_connection|refused|empty response|no server|no address/i.test(m)) return t.errNoServer;
        if (/abort|timeout|время/i.test(m)) return t.errTimeout;
        return m || t.errNoServer;
      }

      // ---------- сбор контекста со страницы (ai.js — content script, видит DOM напрямую) ----------
      function clipTxt(s) { s = String(s || ''); const m = CFG.maxContext || 6000; return s.length > m ? s.slice(0, m) + '…' : s; }
      function selText() { try { return String((window.getSelection && window.getSelection().toString()) || '').trim(); } catch (_) { return ''; } }
      function tweetTexts() { try { return [...document.querySelectorAll('[data-testid="tweetText"]')].map((e) => (e.innerText || '').trim()).filter(Boolean); } catch (_) { return []; } }
      function postText() { const tw = tweetTexts(); return tw.length ? tw[0] : ''; }
      function pageText() {
        const tw = tweetTexts();
        if (tw.length) return clipTxt(tw.join('\n\n'));
        try { const main = document.querySelector('article, main'); return clipTxt((main ? main.innerText : document.body.innerText) || ''); } catch (_) { return ''; }
      }
      function gather(scope) {
        if (scope === 'selection') return selText();
        if (scope === 'post') return postText();
        if (scope === 'page' || scope === 'thread') return pageText();
        return '';
      }

      function pageCtx() {   // что Яся «видит» на странице: адрес + заголовок + текст
        let url = '', title = '';
        try { url = location.href; } catch (_) {}
        try { title = (document.title || '').trim(); } catch (_) {}
        const txt = pageText();
        return 'URL: ' + url + (title ? '\nЗаголовок: ' + title : '') + (txt ? '\nТекст страницы:\n' + txt : '');
      }
      function buildMessages(actionId, text, lang) {
        const task = TASKS[actionId] || TASKS.ask;
        const instr = task[lang] || task.ru;
        const langLine = lang === 'en' ? 'Reply in English.' : 'Отвечай по-русски.';
        let system = sysPersona(lang) + ' ' + instr + (actionId === 'translate' ? '' : ' ' + langLine);
        let user = text || '';
        if (actionId === 'ask' || actionId === 'find' || actionId === 'advice') {   // свободный вопрос -> добавляем контекст страницы, чтобы Яся «видела», где она
          system += lang === 'en' ? ' You CAN see the current page — its context (URL, title, text) is provided below; use it.' : ' Ты ВИДИШЬ текущую страницу — её контекст (адрес, заголовок, текст) дан ниже, опирайся на него.';
          user = (lang === 'en' ? 'Current page context:\n' : 'Контекст текущей страницы:\n') + pageCtx() + '\n\n---\n' + (lang === 'en' ? 'User request: ' : 'Запрос: ') + (text || '');
        }
        if (actionId === 'reply' || actionId === 'comment') {   // ТВОРЧЕСТВО ОТ ИМЕНИ ПОЛЬЗОВАТЕЛЯ: тексты пишутся под ЕГО голос — подмешиваем профиль/предпочтения из памяти (душа Яси при этом не меняется)
          let prefs = [];
          try { if (Yasia.memory && flags.enabled('memory')) prefs = Yasia.memory.profile().slice(-12).map((p) => p.text); } catch (_) {}
          if (prefs.length) {
            system += (lang === 'en'
              ? '\n\nThe drafts are posted BY THE USER, in their name. Match THEIR voice, interests and preferences (from your memory of them):\n- '
              : '\n\nВарианты публикуются ОТ ИМЕНИ ПОЛЬЗОВАТЕЛЯ. Пиши под ЕГО голос, интересы и предпочтения (из твоей памяти о нём):\n- ') + prefs.join('\n- ');
          }
        }
        system = applySkill(system, text || '', lang);   // есть подходящий выученный навык -> его плейбук в системный промпт
        return { system: system, user: user, variants: !!task.variants };
      }
      function parseVariants(s) {
        s = String(s || '').trim();
        let parts = s.split(/\n\s*-{3,}\s*\n/).map((x) => x.trim()).filter(Boolean);
        if (parts.length < 2) {
          const m = s.split(/\n(?=\s*\d+[.)]\s)/).map((x) => x.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean);
          if (m.length >= 2) parts = m;
        }
        if (parts.length < 2) parts = [s];
        return parts.map((p) => p.replace(/^["'\s]+|["'\s]+$/g, '')).filter(Boolean).slice(0, N);
      }

      // ---------- копирование ----------
      function copy(text, btn) {
        const t = L();
        try {
          navigator.clipboard.writeText(text).then(() => {
            if (btn) { const o = btn.textContent; btn.textContent = t.copied; setTimeout(() => { try { btn.textContent = o; } catch (_) {} }, 1200); }
            if (pet) try { pet.say(pick(t.saidCopy), 1500); } catch (_) {}
          }).catch(() => {});
        } catch (_) {}
      }

      // ---------- рендер результата в произвольный контейнер (общий для inline-области и плавающей карточки) ----------
      function renderThinking(el, line) {
        el.innerHTML = '<div class="twtr-ai-think"><span class="twtr-ai-dots"><i></i><i></i><i></i></span><span class="twtr-ai-line"></span></div>';
        const l = el.querySelector('.twtr-ai-line'); if (l) l.textContent = line;
      }
      function renderError(el, msg) { el.innerHTML = '<div class="twtr-ai-err"></div>'; const e = el.querySelector('.twtr-ai-err'); if (e) e.textContent = msg; }
      function renderResult(el, content, variants) {
        const t = L();
        if (variants && variants.length > 1) {
          el.innerHTML = '<div class="twtr-ai-vars">' + variants.map((v, i) =>
            '<div class="twtr-ai-var"><div class="twtr-ai-var-tx"></div><button class="twtr-ai-copy" data-i="' + i + '" type="button">' + t.copy + '</button></div>').join('') + '</div>';
          const txs = el.querySelectorAll('.twtr-ai-var-tx'); variants.forEach((v, i) => { if (txs[i]) txs[i].textContent = v; });
          el.querySelectorAll('.twtr-ai-copy').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); copy(variants[+b.getAttribute('data-i')], b); }));
        } else {
          el.innerHTML = '<div class="twtr-ai-text"></div><div class="twtr-ai-foot"><button class="twtr-ai-copy" type="button"></button></div>';
          const tx = el.querySelector('.twtr-ai-text'); if (tx) tx.textContent = content;
          const b = el.querySelector('.twtr-ai-copy'); if (b) { b.textContent = t.copy; b.addEventListener('click', (e) => { e.stopPropagation(); copy(content, b); }); }
        }
      }
      function renderSetup(el) {
        const t = L();
        el.innerHTML = '<div class="twtr-ai-setup"><span></span><button class="twtr-ai-setup-btn" type="button"></button></div>';
        el.querySelector('span').textContent = t.setup;
        const b = el.querySelector('.twtr-ai-setup-btn'); b.textContent = t.setupBtn;
        b.addEventListener('click', (e) => { e.stopPropagation(); renderConfig(el); });
      }

      // ---------- форма подключения (вкладки Hermes/GPT; переиспользуется в панели и в карточке) ----------
      function renderConfig(box, onSaved) {
        const t = L();
        let prov = cfg.provider === 'hermes' ? 'gpt' : cfg.provider;   // Hermes-вкладки больше нет в UI: правим GPT/Other (Hermes доступен как пресет «Nous Portal» в «Другой»)
        let am = cfg.gpt.authMode || 'chatgpt';                  // режим GPT-вкладки: 'chatgpt' (подписка) | 'key'
        let presetId = cfg.other.presetId || '';                 // выбранный пресет во вкладке «Другой»
        const liveModels = {};                                   // модели, реально доступные по ключу (GET /v1/models) — заполняются автозагрузкой/проверкой связи, per-провайдер
        let pollTimer = 0;
        const stopPoll = () => { if (pollTimer) { clearInterval(pollTimer); pollTimer = 0; } };
        // поле «Модель» = ВЫПАДАЮЩИЙ СПИСОК всех известных моделей (видны сразу) + пункт «своя модель» с текстовым вводом
        function modelFieldHtml(models, curModel, phMod) {
          const list = models || [];
          const inList = list.indexOf(curModel) >= 0;
          const opts = list.map((m) => '<option value="' + esc(m) + '"' + (m === curModel ? ' selected' : '') + '>' + esc(m) + '</option>').join('');
          const customSel = (!inList && curModel) ? ' selected' : '';
          const custHidden = (!inList && curModel) ? '' : ' style="display:none"';
          return '<label class="twtr-ai-f"><span>' + t.cfgModel + '</span>' +
            '<select class="twtr-ai-in twtr-ai-modelsel" data-k="modelSel"><option value="">' + esc(t.pickModel) + '</option>' + opts +
              '<option value="__custom__"' + customSel + '>' + esc(t.customModel) + '</option></select>' +
            '<input class="twtr-ai-in twtr-ai-modelcustom" data-k="modelCustom" type="text" autocomplete="off" placeholder="' + esc(phMod) + '" value="' + (!inList ? esc(curModel) : '') + '"' + custHidden + '></label>';
        }
        function draw() {
          stopPoll();
          const preset = (prov === 'other') ? (PROVIDERS.find((p) => p.id === presetId) || null) : null;
          const pcfg = (prov === 'other')
            ? { baseUrl: (preset && preset.baseUrl) || '', models: (preset && preset.models) || [], keysUrl: (preset && preset.keysUrl) || '' }
            : (CFG[prov] || {});
          const isGptSub = (prov === 'gpt' && am === 'chatgpt');
          const ph = prov === 'gpt' ? 'sk-…' : (prov === 'other' ? 'API key' : 'API_SERVER_KEY');
          const phUrl = (cfg[prov] && cfg[prov].baseUrl) || pcfg.baseUrl || (prov === 'gpt' ? 'https://api.openai.com' : 'https://…');
          const curModel = (cfg[prov] && cfg[prov].model) || '';
          const phMod = curModel || pcfg.model || (prov === 'gpt' ? 'gpt-5.5' : 'model-name');
          const kurl = pcfg.keysUrl || '';
          const modelsList = (liveModels[prov] && liveModels[prov].length) ? liveModels[prov] : (pcfg.models || []);   // живые модели с эндпоинта (если подтянулись) важнее захардкоженного пресета
          const provTabs =
            '<div class="twtr-ai-prov">' +
              '<button class="twtr-ai-prov-b' + (prov === 'gpt' ? ' on' : '') + '" data-p="gpt" type="button"><span class="twtr-ai-prov-ic">' + (LOGOS.gpt || '') + '</span>GPT</button>' +
              '<button class="twtr-ai-prov-b' + (prov === 'other' ? ' on' : '') + '" data-p="other" type="button"><span class="twtr-ai-prov-ic">' + (LOGOS.other || '') + '</span>' + esc(t.provOther) + '</button>' +
            '</div>';
          const modeTabs = prov === 'gpt' ?
            '<div class="twtr-ai-prov twtr-ai-mode">' +
              '<button class="twtr-ai-prov-b' + (am === 'chatgpt' ? ' on' : '') + '" data-am="chatgpt" type="button">' + t.amSub + '</button>' +
              '<button class="twtr-ai-prov-b' + (am === 'key' ? ' on' : '') + '" data-am="key" type="button">' + t.amKey + '</button>' +
            '</div>' : '';
          const presetField = prov === 'other' ?
            '<label class="twtr-ai-f"><span>' + esc(t.lbPreset) + '</span><select class="twtr-ai-preset"><option value="">—</option>' +
              PROVIDERS.map((p) => '<option value="' + esc(p.id) + '"' + (p.id === presetId ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('') +
            '</select></label>' : '';
          const modelField = modelFieldHtml(modelsList, curModel, phMod);
          if (isGptSub) {
            const signed = !!(cfg.gpt.chatgpt && cfg.gpt.chatgpt.accessToken);
            box.innerHTML = provTabs + modeTabs + modelField +
              '<div class="twtr-ai-signin">' +
                '<button class="twtr-ai-signin-btn" type="button">' + (signed ? t.signedReauth : t.signinBtn) + '</button>' +
                '<div class="twtr-ai-signin-st ' + (signed ? 'ok' : '') + '">' + (signed ? t.signedIn : '') + '</div>' +
              '</div>' +
              '<div class="twtr-ai-cfg-row"><button class="twtr-ai-save" type="button">' + t.cfgSave + '</button></div>' +
              '<div class="twtr-ai-cfg-msg"></div><div class="twtr-ai-hint">' + esc(t.cfgHintSub) + '</div>';
          } else {
            box.innerHTML = provTabs + modeTabs + presetField +
              '<label class="twtr-ai-f"><span>' + t.cfgUrl + '</span><input class="twtr-ai-in" data-k="baseUrl" type="text" placeholder="' + esc(phUrl) + '"></label>' +
              '<label class="twtr-ai-f"><span class="twtr-ai-frow"><span>' + t.cfgKey + '</span>' + (kurl ? '<a class="twtr-ai-getkey" href="' + kurl + '" target="_blank" rel="noopener">' + t.getKey + '</a>' : '') + '</span><input class="twtr-ai-in" data-k="apiKey" type="password" placeholder="' + ph + '"></label>' +
              modelField +
              '<div class="twtr-ai-cfg-row"><button class="twtr-ai-test" type="button">' + t.cfgTest + '</button><button class="twtr-ai-save" type="button">' + t.cfgSave + '</button></div>' +
              '<div class="twtr-ai-cfg-msg"></div><div class="twtr-ai-hint">' + esc(prov === 'gpt' ? t.cfgHintGpt : t.cfgHintOther) + '</div>';
          }
          const ins = box.querySelectorAll('.twtr-ai-in');
          ins.forEach((i) => {
            const k = i.getAttribute('data-k');
            if (k !== 'modelSel' && k !== 'modelCustom') i.value = (cfg[prov] && cfg[prov][k]) || '';   // модель проставлена в HTML (select/своя), базовый URL/ключ — из cfg
            ['mousedown', 'keydown', 'click'].forEach((ev) => i.addEventListener(ev, (e) => e.stopPropagation()));
          });
          const msel = box.querySelector('.twtr-ai-modelsel'), mcust = box.querySelector('.twtr-ai-modelcustom');
          if (msel && mcust) msel.addEventListener('change', () => { const c = msel.value === '__custom__'; mcust.style.display = c ? '' : 'none'; if (c) mcust.focus(); });
          const preSel = box.querySelector('.twtr-ai-preset');   // пресет провайдера -> подставить адрес/модели/ссылку и перерисовать
          if (preSel) preSel.addEventListener('change', (e) => {
            e.stopPropagation();
            cfg.other = Object.assign({}, cfg.other, collect());
            presetId = preSel.value; cfg.other.presetId = presetId;
            const pr = PROVIDERS.find((p) => p.id === presetId);
            if (pr) { if (pr.baseUrl) cfg.other.baseUrl = pr.baseUrl; if ((pr.models || []).indexOf(cfg.other.model) < 0) cfg.other.model = ''; }
            draw();
          });
          const msg = box.querySelector('.twtr-ai-cfg-msg');
          const collect = () => {
            const c = {};
            ins.forEach((i) => { c[i.getAttribute('data-k')] = (i.value || '').trim(); });
            if ('modelSel' in c || 'modelCustom' in c) {   // модель: из списка, либо своя из текстового поля
              c.model = (c.modelSel === '__custom__' || !c.modelSel) ? (c.modelCustom || '') : c.modelSel;
              delete c.modelSel; delete c.modelCustom;
            }
            return c;
          };
          // подтянуть РЕАЛЬНЫЕ модели с эндпоинта (GET /v1/models) и показать все в списке — как это делает Hermes
          async function loadModels(silent) {
            const c = collect();
            if (!c.baseUrl || !c.apiKey) return;
            if (msg && !silent) { msg.className = 'twtr-ai-cfg-msg'; msg.textContent = t.cfgTesting; }
            const r = await ping(c);
            if (r && r.ok && r.models && r.models.length) {
              liveModels[prov] = r.models;
              cfg[prov] = Object.assign({}, cfg[prov], c);   // сохранить введённое перед перерисовкой
              draw();
              if (msg) { msg.className = 'twtr-ai-cfg-msg ok'; msg.textContent = String(t.cfgModelsLoaded || (t.cfgOk + ' ({n})')).replace('{n}', r.models.length); }
            } else if (!silent && msg) { msg.className = 'twtr-ai-cfg-msg err'; msg.textContent = t.cfgFail + ': ' + friendlyErr(r, t); }
          }
          const keyIn = box.querySelector('[data-k="apiKey"]');   // ввёл ключ -> авто-загрузка всех доступных моделей (тихо)
          if (keyIn) keyIn.addEventListener('blur', () => { if ((keyIn.value || '').trim()) loadModels(true); });
          box.querySelectorAll('.twtr-ai-prov-b[data-p]').forEach((b) => b.addEventListener('click', (e) => {
            e.stopPropagation();
            cfg[prov] = Object.assign({}, cfg[prov], collect());  // не теряем введённое при переключении вкладки
            prov = b.getAttribute('data-p'); draw();
          }));
          box.querySelectorAll('.twtr-ai-prov-b[data-am]').forEach((b) => b.addEventListener('click', (e) => {
            e.stopPropagation();
            cfg.gpt = Object.assign({}, cfg.gpt, collect());
            am = b.getAttribute('data-am'); cfg.gpt.authMode = am; draw();
          }));
          const sb = box.querySelector('.twtr-ai-signin-btn');   // вход через ChatGPT (device-code) — опрос в ФОНЕ (alarms): переживает закрытие окна Яси И засыпание воркера
          if (sb) sb.addEventListener('click', async (e) => {
            e.stopPropagation(); const st = box.querySelector('.twtr-ai-signin-st');
            st.className = 'twtr-ai-signin-st'; st.textContent = t.signinStart;
            const s = await sendBg({ type: 'YASIA_CODEX_LOGIN' });
            if (!s || !s.ok) { st.className = 'twtr-ai-signin-st err'; st.textContent = t.signinFail + ': ' + ((s && s.error) || ''); return; }
            try { window.open(s.verifyUrl, '_blank', 'noopener'); } catch (_) {}
            st.innerHTML = esc(t.signinCode) + ' <b>' + esc(s.userCode) + '</b><br><span class="twtr-ai-signin-sub">' + esc(s.verifyUrl) + '</span>';
            pollTimer = setInterval(async () => {
              const r = await sendBg({ type: 'YASIA_CODEX_LOGIN_STATUS' });
              const stt = r && r.state && r.state.status;
              if (!stt || stt === 'pending') return;
              stopPoll();
              if (stt === 'ok') {
                storage.localGet({ yasiaAI: null }, (g) => {
                  const v = g && g.yasiaAI; if (v && v.gpt) { cfg.gpt = Object.assign(cfg.gpt, v.gpt); cfg.provider = 'gpt'; }
                  updateCapIcon();
                  const e2 = box.querySelector('.twtr-ai-signin-st'); if (e2) { e2.className = 'twtr-ai-signin-st ok'; e2.textContent = t.signedIn; }
                  if (onSaved) try { onSaved(); } catch (_) {}
                });
              } else {
                const e2 = box.querySelector('.twtr-ai-signin-st'); if (e2) { e2.className = 'twtr-ai-signin-st err'; e2.textContent = (stt === 'timeout' ? t.signinTimeout : t.signinFail + ': ' + ((r.state && r.state.error) || '')); }
              }
            }, 2500);
          });
          const tb = box.querySelector('.twtr-ai-test');
          if (tb) tb.addEventListener('click', async (e) => {
            e.stopPropagation(); await loadModels(false);   // «Проверить связь» = проверка + подтягивание всех моделей в список
          });
          box.querySelector('.twtr-ai-save').addEventListener('click', (e) => {
            e.stopPropagation(); stopPoll();
            cfg[prov] = Object.assign({}, cfg[prov], collect()); if (prov === 'gpt') cfg.gpt.authMode = am; cfg.provider = prov; saveCfg(); updateCapIcon();
            msg.className = 'twtr-ai-cfg-msg ok'; msg.textContent = t.cfgSaved; if (onSaved) try { onSaved(); } catch (_) {}
          });
        }
        draw();
      }

      // ---------- главный цикл действия: реакция Яси -> запрос в Hermes -> рендер ----------
      async function perform(actionId, text, el, opts) {
        if (!el) return;
        const lang = (tr() && tr().lang) || 'ru';
        const t = AL[lang] || AL.ru;
        if (!isConfigured()) { renderSetup(el); return; }
        if (!(await aiGate(el))) return;   // СТРАЖ: безопасный режим / нет разрешения на отправку текста с этого сайта
        text = clipTxt(text);
        const think = pick((t.think[actionId]) || t.think.default);
        renderThinking(el, think);
        if (pet) { try { pet.say(think, 3200); pet.emote('happy', 1600); } catch (_) {} }   // 'happy' есть в манифесте обоих героев ('excited' нет -> был пустой фолбэк)
        let imageUrl = '';
        if (opts && opts.shot) { const cap = await sendBg({ type: 'YASIA_CAPTURE' }); if (cap && cap.ok && cap.dataUrl) imageUrl = cap.dataUrl; }   // скрин страницы -> в мультимодальный запрос
        const m = buildMessages(actionId, text, lang);
        const memCtx = (actionId === 'ask' || actionId === 'find' || actionId === 'advice');   // память уместна в свободных вопросах
        const sysM = memCtx ? withMemory(m.system, text, lang) : m.system;
        const res = await chat([{ role: 'system', content: sysM }, { role: 'user', content: m.user }], { imageUrl });
        if (!res || !res.ok) { renderError(el, friendlyErr(res, t)); if (pet) try { pet.emote('sad', 1500); } catch (_) {} return; }
        const content = String(res.content || '').trim();
        if (!content) { renderError(el, t.errNoServer); return; }
        renderResult(el, content, m.variants ? parseVariants(content) : null);
        if (pet) try { pet.happy(900); } catch (_) {}
        if (memCtx && !m.variants) learnFrom(text, content);   // учимся из свободного диалога
      }

      // ---------- МАРШРУТИЗАТОР НАМЕРЕНИЙ (v0.9): «понять запрос -> открыть нужный инструмент Яси» ----------
      // Один вызов LLM: модель видит СВОЙ набор инструментов (TOOLS) и решает — открыть навык или просто ответить.
      function toolList(lang) {
        return Object.keys(TOOLS).map((id) => {
          const tl = TOOLS[id], on = flags.enabled(tl.flag);
          return '- ' + id + ': ' + (lang === 'en' ? tl.en : tl.ru) + (on ? '' : (lang === 'en' ? ' [DISABLED]' : ' [ВЫКЛЮЧЕН]'));
        }).join('\n');
      }
      function pageHint() {                                   // компактный контекст для роутера (не льём весь текст)
        let url = '', title = '', hasVid = false;
        try { url = location.href; } catch (_) {}
        try { title = (document.title || '').trim(); } catch (_) {}
        try { hasVid = !!document.querySelector('video'); } catch (_) {}
        return clipTxt('URL: ' + url + (title ? ' | ' + title : '') + (hasVid ? ' | (на странице есть видео)' : ''));
      }
      function parseRoute(s) {                                // вытащить первый JSON-объект из ответа (терпим к ```fences и болтовне вокруг)
        s = String(s || '').trim().replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '');
        const i = s.indexOf('{'), j = s.lastIndexOf('}');
        if (i === -1 || j === -1 || j <= i) return null;
        try { return JSON.parse(s.slice(i, j + 1)); } catch (_) { return null; }
      }
      function renderRoute(el, line, toolId) {                // реплика в образе + кнопка «Открыть ↓» (дублирует авто-открытие)
        const t = L();
        el.innerHTML = '<div class="twtr-ai-text"></div><div class="twtr-ai-foot"><button class="twtr-ai-copy" type="button"></button></div>';
        const tx = el.querySelector('.twtr-ai-text'); if (tx) tx.textContent = line || '';
        const b = el.querySelector('.twtr-ai-copy');
        if (b) { b.textContent = t.openTool; b.addEventListener('click', (e) => { e.stopPropagation(); try { events.emit('cap:open', { which: toolId }); } catch (_) {} }); }
      }
      // ---------- ПАМЯТЬ (провайдеро-независимая): recall в промпт + обучение после ответа (доп. LLM-вызов) ----------
      const memOn = () => { try { return !!(Yasia.memory && flags.enabled('memory')); } catch (_) { return false; } };
      function memRecall(q, lang) { if (!memOn()) return ''; try { return Yasia.memory.recall(q || '', lang) || ''; } catch (_) { return ''; } }
      function withMemory(systemStr, q, lang) {               // подмешиваем выжимку памяти в system (с жёстким лимитом внутри recall)
        const mb = memRecall(q, lang); if (!mb) return systemStr;
        return systemStr + '\n\n' + (lang === 'en' ? 'YOUR MEMORY (use it; if asked about a past site/topic, answer from it):\n' : 'ТВОЯ ПАМЯТЬ (используй её; если спрашивают про прошлый сайт/тему — отвечай по ней):\n') + mb;
      }
      function parseJsonArray(s) {
        s = String(s || '').trim().replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '');
        const i = s.indexOf('['), j = s.lastIndexOf(']'); if (i === -1 || j === -1 || j <= i) return null;
        try { const a = JSON.parse(s.slice(i, j + 1)); return Array.isArray(a) ? a : null; } catch (_) { return null; }
      }
      // ---------- СТРАЖ (v0.9): текст страницы уходит в ИИ только с РАЗРЕШЕНИЯ; в безопасном режиме — никогда ----------
      let aiHosts = {};   // {host: true} — сайты, для которых пользователь разрешил отправку текста в ИИ
      try { storage.localGet({ yasiaAiHosts: {} }, (s) => { if (s && s.yasiaAiHosts && typeof s.yasiaAiHosts === 'object') aiHosts = s.yasiaAiHosts; }); } catch (_) {}
      async function aiGate(el) {                             // true = можно слать; false = отказ (карточка уже показана)
        const t = L();
        if (Yasia.guard && !Yasia.guard.allows('ai')) { if (el) renderError(el, t.gdAiSafe); return false; }   // безопасный режим: ИИ выключен полностью
        let host = ''; try { host = location.hostname.replace(/^www\./, ''); } catch (_) {}
        if (!host || aiHosts[host]) return true;              // уже разрешал для этого сайта
        if (!Yasia.guard) return true;                        // стража нет (старый билд) — поведение как раньше
        const ok = await Yasia.guard.confirm({ text: (t.gdAiAskHost || '').replace('{host}', host), yes: t.gdAiYes, no: t.gdAiNo });
        if (!ok) { if (el) renderError(el, t.gdAiNo); return false; }
        aiHosts[host] = true; try { storage.localSet({ yasiaAiHosts: aiHosts }); } catch (_) {}   // запоминаем согласие на сайт
        return true;
      }

      // ---------- НАВЫКИ (skills.js): релевантный плейбук в промпт; создание — рефлексия в learnFrom или команда в роутере ----------
      const sklOn = () => { try { return !!(Yasia.skills && flags.enabled('skills')); } catch (_) { return false; } };
      function skillBlock(q, lang) {                          // лучший подходящий навык под запрос -> блок с плейбуком в system
        if (!sklOn()) return { text: '', skill: null };
        let m = []; try { m = Yasia.skills.find(q || '', 1); } catch (_) {}
        if (!m.length) return { text: '', skill: null };
        const s = m[0];
        return { skill: s, text: '\n\n' + (lang === 'en' ? 'YOUR LEARNED SKILL «' + s.name + '» — follow this playbook:\n' : 'ТВОЙ ВЫУЧЕННЫЙ НАВЫК «' + s.name + '» — следуй этому плейбуку:\n') + s.playbook };
      }
      function applySkill(systemStr, q, lang) {               // подмешать плейбук + засчитать использование
        const sb = skillBlock(q, lang);
        if (sb.skill) try { Yasia.skills.used(sb.skill.id); } catch (_) {}
        return systemStr + sb.text;
      }
      let lastLearnT = 0, compacting = false;
      async function learnFrom(q, answer) {                   // фоном, ОДИН вызов-рефлексия (learning loop как у Hermes): факты о пользователе + «была ли переиспользуемая процедура?» -> навык
        if (Yasia.guard && !Yasia.guard.allows('ai')) return;   // страж: в безопасном режиме ничего не уходит из браузера
        if (!memOn() && !sklOn()) return;
        const qq = String(q || '').trim(); if (qq.length < 8) return;
        const tnow = Date.now(); if (tnow - lastLearnT < 15000) return; lastLearnT = tnow;   // троттл: не чаще раза в 15с (бережём токены/латентность)
        const lang = (tr() && tr().lang) || 'ru';
        const sys = (lang === 'en'
          ? 'Post-task reflection. Reply with STRICT JSON only: {"facts": [...], "skill": null | {"name": "...", "when": "...", "playbook": "..."}}.\nfacts: 0-3 DURABLE facts/preferences about the USER worth remembering long-term (identity, interests, projects, how they like answers); ignore one-off details and anything about the assistant; [] if nothing.\nskill: ONLY if this exchange contains a clearly REUSABLE procedure/template the user will want again (post format, checklist, workflow) — short name, when = when to apply, playbook = concrete steps. A one-off question is NOT a skill -> null.'
          : 'Рефлексия после задачи. Ответь СТРОГО одним JSON: {"facts": [...], "skill": null | {"name": "...", "when": "...", "playbook": "..."}}.\nfacts: 0-3 ДОЛГОВЕЧНЫХ факта/предпочтения о ПОЛЬЗОВАТЕЛЕ (кто он, интересы, проекты, как любит ответы); разовое и про ассистента — игнорируй; [] если нечего.\nskill: ТОЛЬКО если в обмене есть явно ПЕРЕИСПОЛЬЗУЕМАЯ процедура/шаблон, который пользователь захочет снова (формат поста, чек-лист, воркфлоу) — короткое имя, when = когда применять, playbook = конкретные шаги. Разовый вопрос — НЕ навык -> null.');
        const user = 'User: ' + clipTxt(qq).slice(0, 1200) + '\n\nYasya: ' + clipTxt(String(answer || '')).slice(0, 1200);
        let res; try { res = await chat([{ role: 'system', content: sys }, { role: 'user', content: user }]); } catch (_) { return; }
        if (!res || !res.ok) return;
        const obj = parseRoute(res.content);
        const facts = (obj && Array.isArray(obj.facts)) ? obj.facts : parseJsonArray(res.content);   // фолбэк: модель ответила старым форматом-массивом
        if (memOn() && facts && facts.length) { try { Yasia.memory.addFacts(facts.map((x) => String(x))); } catch (_) {} compactMemory(); }
        if (sklOn() && obj && obj.skill && obj.skill.name) {   // САМА придумала навык из опыта -> сохраняем и говорим об этом
          let it = null; try { it = Yasia.skills.add(obj.skill); } catch (_) {}
          if (it && pet) try { pet.say('🛠 ' + (AL[lang] || AL.ru).sklLearned + ': «' + it.name + '»', 3200); } catch (_) {}
        }
      }
      async function compactMemory() {                        // при переполнении профиля — слить/дедуп одним LLM-вызовом (как context_compressor Hermes, но для памяти)
        if (!memOn() || compacting) return;
        try { if (!Yasia.memory.needsCompaction()) return; } catch (_) { return; }
        compacting = true;
        try {
          const lang = (tr() && tr().lang) || 'ru';
          const cur = Yasia.memory.profile().map((p) => p.text);
          const sys = (lang === 'en'
            ? 'Merge and de-duplicate these long-term facts about the user into a concise list (max 40), keep durable ones, drop redundant/contradicted. Reply with STRICT JSON array of short strings.'
            : 'Слей и дедуплицируй эти долговечные факты о пользователе в компактный список (макс 40), оставив важные и убрав повторы/противоречия. Ответь СТРОГО JSON-массивом коротких строк.');
          const res = await chat([{ role: 'system', content: sys }, { role: 'user', content: JSON.stringify(cur) }]);
          if (res && res.ok) { const merged = parseJsonArray(res.content); if (merged && merged.length) Yasia.memory.setProfileTexts(merged.map((x) => String(x)).slice(0, 40)); }
        } catch (_) {} finally { compacting = false; }
      }
      function abilitiesBlock(lang) {                         // умения мозга: на Hermes — «доступно, ставь agent=true»; на GPT — «знаю, но СЕЙЧАС недоступно, предложи переключиться»
        if (cfg.provider === 'hermes' && hermesSkills.length) {
          return (lang === 'en'
            ? '\nThrough your "brain" (Hermes agent) you can ALSO do these — set agent=true to use them (web search, code, etc.): '
            : '\nЧерез свой «мозг» (агент Hermes) ты ТАКЖЕ умеешь это — ставь agent=true, чтобы задействовать (веб-поиск, код и т.п.): ') + hermesSkills.map((s) => s.name).join(', ');
        }
        if (cfg.provider !== 'hermes' && knownHermesSkills.length) {
          return (lang === 'en'
            ? '\nYour Hermes brain has these skills, but GPT is connected NOW so they are UNAVAILABLE: '
            : '\nУ твоего мозга Hermes есть эти навыки, но СЕЙЧАС подключён GPT и они НЕДОСТУПНЫ: ') + knownHermesSkills.join(', ') +
            (lang === 'en'
              ? '. If the request needs one of them -> tool=null and in answer say honestly it needs the Hermes brain (switch in the AI-brain settings).'
              : '. Если запрос требует один из них -> tool=null и в answer честно скажи, что нужен мозг Hermes (переключить в настройках ИИ-мозга).');
        }
        return '';
      }
      function learnedSkillsLine(lang) {                      // выученные плейбук-навыки самой Яси (для роутера: знает, что у неё есть)
        if (!sklOn()) return '';
        let ls = []; try { ls = Yasia.skills.list().slice(-10); } catch (_) {}
        if (!ls.length) return '';
        return (lang === 'en' ? '\nYour LEARNED playbook skills: ' : '\nТвои ВЫУЧЕННЫЕ плейбук-навыки: ') + ls.map((s) => s.name + (s.when ? ' (' + s.when + ')' : '')).join('; ');
      }
      function statusLine(m, lang) {                          // событие выполнения инструмента -> милый статус Яси
        const s = (String(m.tool || '') + ' ' + String(m.label || '')).toLowerCase();
        if (/web|search|browse|поиск/.test(s)) return lang === 'en' ? '🔍 searching the web…' : '🔍 ищу в сети…';
        if (/code|exec|python|run|script/.test(s)) return lang === 'en' ? '💻 running code…' : '💻 кручу код…';
        if (/file|read|write|файл/.test(s)) return lang === 'en' ? '📂 digging through files…' : '📂 копаюсь в файлах…';
        if (/memory|recall|remember|памя/.test(s)) return lang === 'en' ? '🧠 recalling…' : '🧠 вспоминаю…';
        if (/shell|terminal|bash|command/.test(s)) return lang === 'en' ? '⌨️ working in the terminal…' : '⌨️ работаю в терминале…';
        return '🔧 ' + (m.label || (lang === 'en' ? 'working…' : 'работаю…'));
      }
      function ensureStreamEl(el) {                           // структура «статус + накопленный текст» (строим один раз, потом обновляем)
        if (!el.querySelector('.twtr-ai-stream')) {
          el.innerHTML = '<div class="twtr-ai-stream"><div class="twtr-ai-think"><span class="twtr-ai-dots"><i></i><i></i><i></i></span><span class="twtr-ai-line"></span></div><div class="twtr-ai-text"></div></div>';
        }
        return { line: el.querySelector('.twtr-ai-line'), text: el.querySelector('.twtr-ai-text') };
      }
      function computeFireAt(rem) {                           // {inMinutes|atISO} -> метка времени (мс) или 0
        if (!rem) return 0;
        if (typeof rem.inMinutes === 'number' && rem.inMinutes > 0) return Date.now() + Math.round(rem.inMinutes * 60000);
        if (rem.atISO) { const ms = Date.parse(rem.atISO); if (ms && ms > Date.now() + 1000) return ms; }
        return 0;
      }
      function fmtWhen(fireAt, lang) {
        try { return (lang === 'en' ? 'when: ' : 'когда: ') + new Date(fireAt).toLocaleString(lang === 'en' ? 'en-US' : 'ru-RU', { dateStyle: 'short', timeStyle: 'short' }); } catch (_) { return ''; }
      }
      // ПОЛНЫЙ АГЕНТНЫЙ ОТВЕТ со стримингом статусов (Hermes использует свои инструменты: веб-поиск/код/память). Без JSON-рубашки — отдельный вызов, чтобы не душить агент-луп.
      async function answerWithAgent(q, el) {
        const lang = (tr() && tr().lang) || 'ru';
        const t = AL[lang] || AL.ru;
        const sys = sysPersona(lang) + ' ' + (lang === 'en' ? 'Use your tools (web search, code, memory, etc.) as needed, then answer in plain text. Reply in English.' : 'Используй свои инструменты (веб-поиск, код, память и т.п.) по необходимости, потом ответь простым текстом. Отвечай по-русски.');
        const user = (lang === 'en' ? 'Current page:\n' : 'Текущая страница:\n') + pageCtx() + '\n\n---\n' + (lang === 'en' ? 'Request: ' : 'Запрос: ') + q;
        let acc = '';
        const s = ensureStreamEl(el); if (s.line) s.line.textContent = pick(t.think.find) || pick(t.think.default);
        const ctrl = chatStream([{ role: 'system', content: applySkill(withMemory(sys, q, lang), q, lang) }, { role: 'user', content: user }], {
          onProgress: (m) => { const ss = ensureStreamEl(el); if (ss.line) ss.line.textContent = statusLine(m, lang); if (pet) try { pet.say(statusLine(m, lang), 2400); } catch (_) {} },
          onDelta: (txt) => { acc += txt; const ss = ensureStreamEl(el); if (ss.text) ss.text.textContent = acc; },
          onDone: (content) => { const fin = String(content || acc).trim(); if (fin) { renderResult(el, fin, null); learnFrom(q, fin); } else renderError(el, t.errNoServer); if (pet) try { pet.happy(900); } catch (_) {} },
          onError: () => { perform('ask', q, el); },   // стрим не задался -> честный фолбэк на обычный (нестримовый) ответ
        });
        if (!ctrl) await perform('ask', q, el);        // порт не открылся -> обычный ответ
      }
      async function improveSkill(imp, el, lang) {            // ДОКРУТКА навыка (само-улучшение, как у Hermes): текущий плейбук + правка -> переписанный плейбук (ver++)
        const t = AL[lang] || AL.ru;
        let s = null; try { s = Yasia.skills.byName(String((imp && imp.name) || '')); } catch (_) {}
        if (!s) { renderResult(el, t.sklNoSkill, null); return; }
        renderThinking(el, pick(t.think.default));
        const sys = lang === 'en'
          ? 'Rewrite the skill playbook applying the requested change. Keep it concrete and short. Reply with STRICT JSON only: {"playbook": "..."}'
          : 'Перепиши плейбук навыка с учётом правки. Конкретно и коротко. Ответь СТРОГО одним JSON: {"playbook": "..."}';
        const user = (lang === 'en' ? 'Skill «' : 'Навык «') + s.name + '»\n' + (lang === 'en' ? 'Current playbook:\n' : 'Текущий плейбук:\n') + s.playbook + '\n\n' + (lang === 'en' ? 'Change request: ' : 'Правка: ') + String((imp && imp.note) || '');
        const res = await chat([{ role: 'system', content: sys }, { role: 'user', content: user }]);
        if (!res || !res.ok) { renderError(el, friendlyErr(res, t)); return; }
        const obj = parseRoute(res.content);
        const pb = obj && String(obj.playbook || '').trim();
        if (!pb) { renderError(el, t.errNoServer); return; }
        try { Yasia.skills.add({ name: s.name, when: s.when, playbook: pb }); } catch (_) {}   // одноимённый add = обновление (ver++)
        if (pet) try { pet.say('🛠 ' + t.sklImproved + ': «' + s.name + '»', 2600); pet.happy(800); } catch (_) {}
        renderResult(el, t.sklImproved + ': «' + s.name + '»\n\n' + pb, null);
      }
      async function routeAsk(q, el) {
        if (!el) return;
        const lang = (tr() && tr().lang) || 'ru';
        const t = AL[lang] || AL.ru;
        if (!isConfigured()) { renderSetup(el); return; }
        if (!(await aiGate(el))) return;   // СТРАЖ: безопасный режим / нет разрешения на отправку текста с этого сайта
        const think = pick(t.think.default);
        renderThinking(el, think);
        if (pet) { try { pet.say(think, 2600); pet.emote('happy', 1400); } catch (_) {} }
        let nowISO = ''; try { nowISO = new Date().toISOString(); } catch (_) {}
        const agentHint = hermesSkills.length ? (lang === 'en' ? ' Set "agent": true when the request needs knowledge/compute your brain can do (web search, code, etc.).' : ' Ставь "agent": true, когда запрос требует знаний/вычислений, которые умеет мозг (веб-поиск, код и т.п.).') : '';
        const sys = sysPersona(lang) + '\n\n' +
          (lang === 'en' ? 'You are ALSO an intent router for your OWN built-in tools. Your tools:\n' : 'Ты ТАКЖЕ маршрутизатор к СВОИМ встроенным инструментам. Твои инструменты:\n') +
          toolList(lang) +
          (lang === 'en'
            ? '\n- remind: set a reminder; fill "remind" with the text and EITHER inMinutes (number) OR atISO (ISO 8601). Available always.'
              + '\n- learn_skill: the user TEACHES you a skill («learn a skill: …») — fill "skill" {name, when, playbook}.'
              + '\n- improve_skill: the user asks to refine an existing skill («improve skill X: …») — fill "improve" {name, note}.'
            : '\n- remind: поставить напоминание; заполни "remind" текстом и ЛИБО inMinutes (число), ЛИБО atISO (ISO 8601). Доступно всегда.'
              + '\n- learn_skill: пользователь УЧИТ тебя навыку («выучи навык: …») — заполни "skill" {name, when, playbook}.'
              + '\n- improve_skill: пользователь просит докрутить существующий навык («улучши/докрути навык X: …») — заполни "improve" {name, note}.') +
          learnedSkillsLine(lang) +
          abilitiesBlock(lang) + '\n\n' +
          (lang === 'en'
            ? 'Reply with STRICT JSON only (no markdown, no extra text):\n{"tool": "<id or null>", "say": "<short in-character line>", "answer": "<plain answer if no tool, else null>", "agent": <true|false>, "remind": {"text":"...","inMinutes":<n|null>,"atISO":"<iso|null>"}, "skill": <null|{"name":"...","when":"...","playbook":"..."}>, "improve": <null|{"name":"...","note":"..."}>}\nUse a tool only if available and clearly matching. [DISABLED] tool -> tool=null and explain in answer.' + agentHint
            : 'Ответь СТРОГО одним JSON (без markdown и лишнего текста):\n{"tool": "<id или null>", "say": "<короткая реплика в образе>", "answer": "<обычный ответ, если инструмента нет, иначе null>", "agent": <true|false>, "remind": {"text":"...","inMinutes":<n|null>,"atISO":"<iso|null>"}, "skill": <null|{"name":"...","when":"...","playbook":"..."}>, "improve": <null|{"name":"...","note":"..."}>}\nИспользуй инструмент только если он доступен и явно подходит. [ВЫКЛЮЧЕН] -> tool=null и объясни в answer.' + agentHint);
        const user = (lang === 'en' ? 'Now: ' : 'Сейчас: ') + nowISO + '\n' + (lang === 'en' ? 'Page: ' : 'Страница: ') + pageHint() + '\n\n' + (lang === 'en' ? 'Request: ' : 'Запрос: ') + clipTxt(q);
        const res = await chat([{ role: 'system', content: withMemory(sys, q, lang) }, { role: 'user', content: user }]);
        if (!res || !res.ok) { renderError(el, friendlyErr(res, t)); if (pet) try { pet.emote('sad', 1400); } catch (_) {} return; }
        const parsed = parseRoute(res.content);
        if (parsed && parsed.tool === 'remind') {              // НАПОМИНАНИЕ (локальное, всегда доступно)
          const fireAt = computeFireAt(parsed.remind);
          if (!fireAt) { renderResult(el, t.remindBad, null); return; }
          const r = await sendBg({ type: 'YASIA_REMIND_ADD', text: (parsed.remind && parsed.remind.text) || q, fireAt });
          const ok = r && r.ok;
          const line = (String(parsed.say || '').trim()) || (ok ? t.remindOk : t.remindFail);
          if (pet && ok) try { pet.say(line, 2600); pet.happy(800); } catch (_) {}
          renderResult(el, line + (ok ? '\n' + fmtWhen(fireAt, lang) : ''), null);
          return;
        }
        if (parsed && parsed.tool === 'learn_skill' && sklOn()) {              // пользователь УЧИТ навыку -> сохраняем плейбук
          let it = null; try { it = Yasia.skills.add(parsed.skill || {}); } catch (_) {}
          const line = it ? (t.sklLearned + ': «' + it.name + '» 🛠') : t.errNoServer;
          if (it && pet) try { pet.say('🛠 ' + t.sklLearned + ': «' + it.name + '»', 2800); pet.happy(900); } catch (_) {}
          renderResult(el, it ? line + (it.when ? '\n' + it.when : '') : t.errNoServer, null);
          return;
        }
        if (parsed && parsed.tool === 'improve_skill' && sklOn()) {            // докрутка существующего навыка: второй вызов переписывает плейбук
          await improveSkill(parsed.improve || {}, el, lang);
          return;
        }
        if (parsed && parsed.tool && TOOLS[parsed.tool] && flags.enabled(TOOLS[parsed.tool].flag)) {   // нашёлся ДОСТУПНЫЙ инструмент -> открываем его в окне Яси
          const line = String(parsed.say || '').trim();
          if (pet && line) { try { pet.say(line, 2800); pet.happy(900); } catch (_) {} }
          renderRoute(el, line, parsed.tool);
          try { events.emit('cap:open', { which: parsed.tool }); } catch (_) {}
          return;
        }
        if (parsed && parsed.agent === true && cfg.provider === 'hermes' && hermesCaps.streaming) {   // запрос к знаниям -> полный агент Hermes со стримом статусов
          if (pet && parsed.say) try { pet.say(String(parsed.say).trim(), 2400); } catch (_) {}
          await answerWithAgent(q, el);
          return;
        }
        const ans = parsed && (parsed.answer || parsed.say);   // инструмента нет/выключен -> обычный ответ
        if (ans && String(ans).trim()) { const a = String(ans).trim(); renderResult(el, a, null); if (pet) try { pet.happy(800); } catch (_) {} learnFrom(q, a); return; }
        await perform('ask', q, el);                           // модель не дала валидный JSON -> честный фолбэк на обычный ответ с контекстом страницы
      }

      // ---------- плавающая карточка результата (для меню по выделению) ----------
      let card = null;
      function ensureCard() {
        if (card) return card;
        const wrap = document.createElement('div'); wrap.className = 'twtr-ai-card'; wrap.style.display = 'none';
        wrap.innerHTML = '<div class="twtr-ai-card-head"><span class="twtr-ai-card-title"></span><button class="twtr-ai-card-x" type="button">✕</button></div><div class="twtr-ai-card-body"></div>';
        ['mousedown', 'click'].forEach((ev) => wrap.addEventListener(ev, (e) => e.stopPropagation()));
        wrap.querySelector('.twtr-ai-card-x').addEventListener('click', (e) => { e.stopPropagation(); closeCard(); });
        root.appendChild(wrap);
        card = { wrap, title: wrap.querySelector('.twtr-ai-card-title'), body: wrap.querySelector('.twtr-ai-card-body') };
        return card;
      }
      function openCard(title, rect) { const c = ensureCard(); c.title.textContent = title; c.wrap.style.display = 'block'; placeFixed(c.wrap, rect, true); }
      function closeCard() { if (card) card.wrap.style.display = 'none'; }
      function placeFixed(el, rect, below) {
        const w = el.offsetWidth, h = el.offsetHeight, m = 8, vw = window.innerWidth, vh = window.innerHeight;
        let left = rect.left + rect.width / 2 - w / 2; left = clamp(left, m, Math.max(m, vw - w - m));
        let top = below ? rect.bottom + 8 : rect.top - h - 8;
        if (below && top + h > vh - m) top = rect.top - h - 8;
        if (!below && top < m) top = rect.bottom + 8;
        top = clamp(top, m, Math.max(m, vh - h - m));
        el.style.left = left + 'px'; el.style.top = top + 'px';
      }

      // ---------- мини-меню по выделению текста ----------
      let bar = null, selRect = null, selTextCache = '';
      function ensureBar() {
        if (bar) return bar;
        bar = document.createElement('div'); bar.className = 'twtr-ai-bar'; bar.style.display = 'none';
        ['mousedown', 'click'].forEach((ev) => bar.addEventListener(ev, (e) => e.stopPropagation()));
        root.appendChild(bar); return bar;
      }
      function hideBar() { if (bar) bar.style.display = 'none'; }
      function buildBar(text, rect) {
        const t = L(); const b = ensureBar();
        const acts = [['explain', '💡', t.act.explain], ['translate', '🌐', t.act.translate], ['summarizePost', '✂️', t.act.compress], ['reply', '💬', t.act.reply], ['advice', '🧭', t.act.advice], ['save', '📝', t.act.save]];
        b.innerHTML = '<span class="twtr-ai-bar-cat">🐱</span>' + acts.map(([id, ic, lb]) =>
          '<button class="twtr-ai-bar-btn" data-act="' + id + '" type="button"><span>' + ic + '</span><b>' + lb + '</b></button>').join('');
        b.querySelectorAll('[data-act]').forEach((btn) => btn.addEventListener('click', (e) => { e.stopPropagation(); onPick(btn.getAttribute('data-act'), text, rect); }));
        b.style.display = 'flex'; placeFixed(b, rect, false);
      }
      function onPick(actionId, text, rect) {
        hideBar();
        const t = L();
        if (actionId === 'save') { try { events.emit('notes:add', { text: text }); } catch (_) {} if (pet) try { pet.say(pick(t.saidSave), 1700); pet.happy(900); } catch (_) {} return; }
        openCard(t.title[actionId] || t.title.ask, rect);
        perform(actionId, text, card.body);
      }
      function isEditableNode(node) {
        let el = node && (node.nodeType === 1 ? node : node.parentElement);
        for (let i = 0; el && i < 6; el = el.parentElement, i++) {
          if (el.isContentEditable) return true;
          const tag = el.tagName; if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
        }
        return false;
      }
      function checkSelection() {
        if (!isConfigured()) { hideBar(); return; }
        let sel; try { sel = window.getSelection(); } catch (_) { sel = null; }
        const text = selText();
        if (!sel || sel.rangeCount === 0 || !text || text.length < 2 || text.length > 4000) { hideBar(); return; }
        const anchor = sel.anchorNode;
        const aEl = anchor && (anchor.nodeType === 1 ? anchor : anchor.parentElement);
        if (aEl && root.contains(aEl)) { hideBar(); return; }                 // выделение в нашем UI — игнор
        if (isEditableNode(anchor)) { hideBar(); return; }                    // печатает в поле ввода — не мешаем
        let rect; try { rect = sel.getRangeAt(0).getBoundingClientRect(); } catch (_) { rect = null; }
        if (!rect || (!rect.width && !rect.height)) { hideBar(); return; }
        selRect = { left: rect.left, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
        selTextCache = text;
        buildBar(text, selRect);
      }
      const onMouseUp = () => { setTimeout(checkSelection, 10); };            // даём селекту устаканиться
      const onSelChange = () => { try { if (!selText()) hideBar(); } catch (_) {} };
      const onScroll = () => { hideBar(); };
      const onKey = (e) => { if (e.key === 'Escape') { hideBar(); closeCard(); } };
      document.addEventListener('mouseup', onMouseUp, true);
      document.addEventListener('selectionchange', onSelChange);
      window.addEventListener('scroll', onScroll, true);
      document.addEventListener('keydown', onKey, true);
      const onDocDown = (e) => { const tg = e.target; if (bar && bar.contains(tg)) return; if (card && card.wrap.contains(tg)) return; closeCard(); };
      document.addEventListener('mousedown', onDocDown, true);

      // ---------- панель «ИИ» в окне Яси (статус + быстрые действия + настройка) ----------
      function fillReminders(box2) {   // список напоминаний (просмотр + удаление) — данные из фона (chrome.alarms)
        if (!box2) return; const t = L(); const lang = (tr() && tr().lang) || 'ru';
        sendBg({ type: 'YASIA_REMIND_LIST' }).then((r) => {
          const list = (r && r.ok && r.reminders) || [];
          if (!list.length) { box2.innerHTML = '<div class="twtr-ai-rem-h">' + t.remTitle + '</div><div class="twtr-dlg-empty">' + t.remEmpty + '</div>'; return; }
          box2.innerHTML = '<div class="twtr-ai-rem-h">' + t.remTitle + '</div>' + list.map((x) =>
            '<div class="twtr-ai-rem-i"><span class="twtr-ai-rem-tx"></span><span class="twtr-ai-rem-when"></span><button class="twtr-ai-rem-del" data-id="' + esc(x.id) + '" type="button">✕</button></div>').join('');
          const txs = box2.querySelectorAll('.twtr-ai-rem-tx'), whens = box2.querySelectorAll('.twtr-ai-rem-when');
          list.forEach((x, i) => { if (txs[i]) txs[i].textContent = x.text; if (whens[i]) whens[i].textContent = fmtWhen(x.fireAt, lang); });
          box2.querySelectorAll('.twtr-ai-rem-del').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); sendBg({ type: 'YASIA_REMIND_DEL', id: b.getAttribute('data-id') }).then(() => fillReminders(box2)); }));
        });
      }
      function fillMemory(box2) {   // что Яся помнит: факты о пользователе + журнал сайтов (просмотр/очистка)
        if (!box2) return; const t = L(); const lang = (tr() && tr().lang) || 'ru';
        if (!memOn()) { box2.innerHTML = ''; return; }
        let facts = [], places = [];
        try { facts = Yasia.memory.profile().slice(-8).reverse(); } catch (_) {}
        try { places = Yasia.memory.places().slice(0, 8); } catch (_) {}
        const factsHtml = facts.length
          ? facts.map((f) => '<div class="twtr-ai-rem-i"><span class="twtr-ai-rem-tx" data-fid="' + esc(f.id) + '"></span><button class="twtr-ai-mem-delf" data-fid="' + esc(f.id) + '" type="button">✕</button></div>').join('')
          : '<div class="twtr-dlg-empty">' + t.memEmptyFacts + '</div>';
        const placesHtml = places.length
          ? places.map((p) => '<div class="twtr-ai-rem-i"><span class="twtr-ai-rem-tx" data-host="' + esc(p.host) + '"></span><span class="twtr-ai-rem-when">×' + (p.visits || 1) + '</span></div>').join('')
          : '<div class="twtr-dlg-empty">' + t.memEmptyPlaces + '</div>';
        box2.innerHTML =
          '<div class="twtr-ai-rem-h">' + t.memFactsTitle + (facts.length ? ' <button class="twtr-ai-mem-clr" data-clr="facts" type="button">' + t.memForgetFacts + '</button>' : '') + '</div>' + factsHtml +
          '<div class="twtr-ai-rem-h" style="margin-top:8px">' + t.memPlacesTitle + (places.length ? ' <button class="twtr-ai-mem-clr" data-clr="places" type="button">' + t.memForgetPlaces + '</button>' : '') + '</div>' + placesHtml;
        box2.querySelectorAll('.twtr-ai-rem-tx[data-fid]').forEach((el2) => { const f = facts.find((x) => x.id === el2.getAttribute('data-fid')); if (f) el2.textContent = f.text; });
        box2.querySelectorAll('.twtr-ai-rem-tx[data-host]').forEach((el2) => { const p = places.find((x) => x.host === el2.getAttribute('data-host')); if (p) el2.textContent = p.host + (p.title ? ' — ' + p.title : ''); });
        box2.querySelectorAll('.twtr-ai-mem-delf').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); try { Yasia.memory.removeFact(b.getAttribute('data-fid')); } catch (_) {} fillMemory(box2); }));
        box2.querySelectorAll('.twtr-ai-mem-clr').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); try { if (b.getAttribute('data-clr') === 'facts') Yasia.memory.clearProfile(); else Yasia.memory.clearPlaces(); } catch (_) {} fillMemory(box2); }));
      }
      function fillSkills(box2) {   // выученные навыки: имя + когда применять + версия, с удалением
        if (!box2) return; const t = L();
        if (!sklOn()) { box2.innerHTML = ''; return; }
        let ls = []; try { ls = Yasia.skills.list().slice().reverse(); } catch (_) {}
        const items = ls.length
          ? ls.map((s) => '<div class="twtr-ai-rem-i"><span class="twtr-ai-rem-tx" data-sid="' + esc(s.id) + '"></span><span class="twtr-ai-rem-when">v' + (s.ver || 1) + (s.uses ? ' ×' + s.uses : '') + '</span><button class="twtr-ai-rem-del" data-sid="' + esc(s.id) + '" type="button">✕</button></div>').join('')
          : '<div class="twtr-dlg-empty">' + t.sklEmpty + '</div>';
        box2.innerHTML = '<div class="twtr-ai-rem-h">' + t.sklTitle + '</div>' + items;
        box2.querySelectorAll('.twtr-ai-rem-tx[data-sid]').forEach((el2) => { const s = ls.find((x) => x.id === el2.getAttribute('data-sid')); if (s) el2.textContent = s.name + (s.when ? ' — ' + s.when : ''); });
        box2.querySelectorAll('.twtr-ai-rem-del[data-sid]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); try { Yasia.skills.remove(b.getAttribute('data-sid')); } catch (_) {} fillSkills(box2); }));
      }
      function renderPanel(box) {
        updateCapIcon();
        if (!box) return; const t = L();
        const otherName = (PROVIDERS.find((p) => p.id === cfg.other.presetId) || {}).name || L().provOther;
        const provName = cfg.provider === 'gpt' ? 'GPT' : (cfg.provider === 'other' ? otherName : 'Hermes');
        const statusTx = isConfigured() ? (t.connected + ' · ' + provName) : t.notConnected;
        box.innerHTML =
          '<div class="twtr-ai-status ' + (isConfigured() ? 'ok' : '') + '">' + statusTx + '</div>' +
          '<div class="twtr-ai-quicktitle">' + t.quickTitle + '</div>' +
          '<div class="twtr-ai-quick">' +
            '<button class="twtr-ai-q" data-q="explainPage" type="button">' + t.qExplainPage + '</button>' +
            '<button class="twtr-ai-q" data-q="summarizeThread" type="button">' + t.qSummThread + '</button>' +
          '</div>' +
          '<div class="twtr-ai-rem"></div>' +
          '<div class="twtr-ai-skl" style="margin-bottom:10px"></div>' +
          '<div class="twtr-ai-mem"></div>' +
          '<button class="twtr-ai-cfg-toggle" type="button">' + t.settingsBtn + '</button>' +
          '<div class="twtr-ai-cfg" hidden></div>';
        fillReminders(box.querySelector('.twtr-ai-rem'));
        fillSkills(box.querySelector('.twtr-ai-skl'));
        fillMemory(box.querySelector('.twtr-ai-mem'));
        const out = root.querySelector('#twtr-dlg-ai');
        box.querySelectorAll('.twtr-ai-q').forEach((b) => b.addEventListener('click', (e) => {
          e.stopPropagation();
          const q = b.getAttribute('data-q');
          if (out) { out.hidden = false; perform(q, gather(q === 'explainPage' ? 'page' : 'thread'), out); }
        }));
        const cfgBox = box.querySelector('.twtr-ai-cfg');
        box.querySelector('.twtr-ai-cfg-toggle').addEventListener('click', (e) => {
          e.stopPropagation();
          if (cfgBox.hidden) { renderConfig(cfgBox, () => renderPanel(box)); cfgBox.hidden = false; }
          else cfgBox.hidden = true;
        });
      }

      // ---------- публичный API мозга (pet.js и панель зовут это) ----------
      Yasia.ai = {
        isConfigured: isConfigured,
        askInto: function (el, q, opts) {
          if (!el || !(q || '').trim()) return; el.hidden = false;
          if (opts && opts.shot) { perform('ask', q, el, opts); return; }   // запрос со скрином -> прямой ответ по картинке (без маршрутизации)
          routeAsk(q, el);                                                  // свободный запрос -> сперва понять намерение и при совпадении открыть инструмент
        },
        renderPanel: renderPanel,
        run: function (actionId, scope, el) { perform(actionId, gather(scope), el || root.querySelector('#twtr-dlg-ai')); },
        ping: ping,
        provider: function () { return cfg.provider; },
      };
      updateCapIcon();   // сразу поставить логотип активного провайдера на кнопку навыка

      return {
        destroy() {
          try { chrome.storage.onChanged.removeListener(onStoreChange); } catch (_) {}
          document.removeEventListener('mouseup', onMouseUp, true);
          document.removeEventListener('selectionchange', onSelChange);
          window.removeEventListener('scroll', onScroll, true);
          document.removeEventListener('keydown', onKey, true);
          document.removeEventListener('mousedown', onDocDown, true);
          try { if (bar) bar.remove(); } catch (_) {}
          try { if (card) card.wrap.remove(); } catch (_) {}
          bar = null; card = null;
          if (Yasia.ai) try { delete Yasia.ai; } catch (_) { Yasia.ai = null; }
        },
      };
    },
    destroy(inst) { if (inst && inst.destroy) inst.destroy(); },
  });
})();
