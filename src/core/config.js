// Конфиг Яси — единый источник правды для констант (без логики, только значения).
// Грузится ПЕРЕД pet.js (см. manifest content_scripts[0].js и background.js JS),
// кладёт всё в window.Yasia.config. Меняешь баланс/физику — только здесь.
(() => {
  'use strict';
  const Yasia = (window.Yasia = window.Yasia || {});
  Yasia.config = Object.freeze({
    // герои (скины/персонажи). Добавить персонажа = запись здесь + папка src/heroes/<id>/ с manifest.json и спрайтами.
    // popup строит пикер из этого списка, pet.js берёт его как список framed-героев — без правки логики.
    HEROES: [
      { id: 'catgirl', name: 'Yasya' },
      // { id: 'noema', name: 'Noema', cssClass: 'is-noema' },   // временно скрыта (демо): пикер строится из этого списка
    ],

    // движение
    SPEED: 1.0,            // базовая скорость ходьбы
    RUN_MUL: 2.6,         // во сколько раз быстрее во время бега

    // платформер по структуре страницы
    PLAT_GRAVITY: 1.0,    // ускорение падения
    PLAT_JUMP_UP: 150,    // макс высота прыжка вверх (px экрана)
    PLAT_JUMP_DX: 120,    // макс горизонтальная дальность прыжка (влево-вправо коротко; вверх-вниз свободно)
    PLAT_JUMP_MS: 640,    // длительность дуги прыжка
    PLAT_FLOOR: 4,        // отступ «пола» от низа экрана

    VIEW_PAD_TOP: 64,     // отступы видимой зоны (для пакости «кража буквы»)
    VIEW_PAD_BOTTOM: 24,
    PET_W: 46,
    PET_H: 62,

    // поглаживание мышью: столько пикселей «глажки» курсором по питомцу = одно «погладить»
    STROKE_DIST: 260,

    // голод / опыт / уровни
    HUNGER_PER_MIN: 1.4,  // прирост голода в минуту (0..100)
    FEED_AMOUNT: 34,      // сколько голода снимает одна кормёжка
    FEED_XP: 12,
    LEVEL_XP: [0, 40, 100, 200, 350], // пороги опыта для уровней 1..5
    MAX_LEVEL: 5,
    HUNGER_HUNGRY: 55,    // выше -> просит еду
    HUNGER_STARVING: 82,  // выше -> грустит/вредничает

    // ----- ТАМАГОЧИ v1 (баланс «средний») -----
    // энергия (0..100): высокая -> бегает; низкая -> садится/спит
    ENERGY_START: 100,
    ENERGY_REST_MIN: 0.45,   // пассивный расход в минуту бодрствования (~3.7ч до нуля)
    ENERGY_RUN_SEC: 0.22,    // доп. расход в секунду бега
    ENERGY_SLEEP_MIN: 30,    // восстановление во сне в минуту (wall-clock -> работает и в фоне/оффлайн)
    ENERGY_LOW: 26,          // ниже -> засыпает (resting)
    ENERGY_WAKE: 65,         // спит, пока не выспится до этого уровня (гистерезис -> без микро-снов у порога)
    ENERGY_TIRED: 50,        // ниже -> не бегает

    // привязанность (0..100): открывает фразы/приветствие, растёт от заботы
    BOND_START: 0,
    BOND_DECAY_MIN: 0.05,    // очень медленный спад (почти не падает)
    BOND_FRIEND: 45,         // порог доверия (доп. фразы, приветствие)
    BOND_BESTIE: 78,         // лучший друг (макс милоты)

    // настроение — ПРОИЗВОДНОЕ от голода/энергии/привязанности + бонус от ласки (moodBias)
    MOOD_BASE: 55,
    MOOD_BIAS_MAX: 45,       // потолок бонуса настроения от взаимодействий
    MOOD_BIAS_DECAY_MIN: 3.5,// как быстро бонус тает (в минуту)
    MOOD_HUNGER_K: 0.6,      // штраф за голод выше 60
    MOOD_ENERGY_K: 0.5,      // штраф за энергию ниже 30
    MOOD_BOND_K: 0.15,       // бонус за привязанность
    MOOD_GOOD: 62,           // выше -> хорошее (машет/прыгает/бегает)
    MOOD_BAD: 38,            // ниже -> плохое (сидит/отворачивается/бурчит)

    // шкала дикости (core/behavior.js): автономные пакости управляются статами, а не таймером
    WILD: {
      hungerFrom: 40, hungerK: 0.6,    // голод выше 40 -> дичает (на 100 -> +36)
      moodFrom: 50, moodK: 0.8,        // настроение ниже 50 -> дичает (на 0 -> +40)
      neglectCap: 25, neglectK: 1.2,   // минуты заброшенности (cap 25) -> до +30
      bondK: 0.4,                      // привязанность усмиряет (на bond 100 -> -40)
      minWild: 18,                     // дикость ниже -> не пакостит вовсе (ручная)
      minMs: 8000, maxMs: 78000,       // интервал пакостей: дикая ~8с .. смирная ~78с
    },

    // спонтанные эмоции в простое: ~chance показать эмоцию, иначе гулять дальше (80/20 по умолчанию)
    IDLE_EMOTE: { chance: 0.2, minMs: 6000, maxMs: 11000, pool: ['happy', 'wave', 'pet_purr', 'like_proud'] },

    // болезнь (тамагочи-петля): голод/скука/заброшенность -> шанс заболеть; лечит игрок кнопкой 💊 (страховка: сама через сутки)
    SICK: {
      checkMs: 30000,          // как часто кидаем кубик заболевания
      pStarving: 0.04,         // прибавка шанса за «очень голодная»
      pGrumpy: 0.02,           // прибавка за плохое настроение
      pNeglect: 0.02,          // прибавка за заброшенность дольше neglectMin
      neglectMin: 90,          // минут без взаимодействия = «заброшена»
      moodPenalty: 18,         // штраф к настроению, пока болеет
      healBond: 4, healXp: 6, healMood: 6,   // награда за лечение (забота сближает)
      autoHealMs: 24 * 3600 * 1000,          // сутки без лечения -> выздоравливает сама (не мучаем неактивного игрока)
    },
    // ежедневный стрик: первый визит дня -> приветствие + XP-бонус, растущий со стриком (с потолком)
    STREAK: { xpPerDay: 2, xpCap: 14 },

    // эффекты действий заботы на статы (hunger/energy/bond/mood/xp)
    // ----- ИИ-мозг v0.8 (Hermes/GPT Brain) — дефолты подключения. ДВА провайдера, оба OpenAI-совместимые (POST /v1/chat/completions) -----
    // Запрос ВСЕГДА идёт через background.js (обход CORS/mixed-content). Ключи провайдера хранятся локально (storage.local),
    // НЕ синкаются в облако. Hermes (Nous Research) рекомендован: ключи LLM живут внутри него; GPT — прямой OpenAI-ключ.
    AI: {
      provider: 'hermes',                 // активный провайдер: 'hermes' | 'gpt'
      path: '/v1/chat/completions',       // общий POST-эндпоинт чата (одинаков у обоих)
      sessionKey: 'yasia:x',              // X-Hermes-Session-Key — общая «память» Яси между запросами (только Hermes)
      timeoutMs: 120000,                  // ждём ответ агента (с инструментами Hermes может думать долго)
      variants: 3,                        // сколько вариантов просить для «придумать ответ/комментарий»
      maxContext: 6000,                   // макс. длина текста страницы/треда, отдаваемого в запрос (символы)
      // models — подсказки для выпадающего списка модели (можно вписать ЛЮБУЮ вручную); keysUrl — куда вести «где взять ключ»
      hermes: { baseUrl: 'http://127.0.0.1:8642', model: 'hermes-agent', models: ['hermes-agent'], keysUrl: 'https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server/' },   // локальный API-сервер Hermes
      gpt:    { baseUrl: 'https://api.openai.com', model: 'gpt-5.5', models: ['gpt-5.5', 'gpt-5', 'gpt-5-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini', 'o3', 'o4-mini'], keysUrl: 'https://platform.openai.com/api-keys' },   // OpenAI напрямую; дефолт — последняя gpt-5.5
      other:  { baseUrl: '', model: '', models: [], keysUrl: '' },   // «Другой» провайдер: любой OpenAI-совместимый (baseUrl+ключ+модель), как «свой эндпоинт» у Hermes
      // ПРЕСЕТЫ для вкладки «Другой» (в стиле Hermes: Nous Portal / OpenRouter / OpenAI / свой). Выбрал -> подставились адрес/модели/ссылка на ключ; модель и адрес правятся вручную.
      providers: [
        { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api', keysUrl: 'https://openrouter.ai/keys', models: ['openai/gpt-5.5', 'anthropic/claude-sonnet-5', 'google/gemini-2.5-pro', 'deepseek/deepseek-chat', 'meta-llama/llama-4-maverick', 'x-ai/grok-4'] },
        { id: 'nous', name: 'Nous Portal', baseUrl: 'https://inference-api.nousresearch.com', keysUrl: 'https://portal.nousresearch.com/', models: ['Hermes-4-405B', 'Hermes-4-70B', 'DeepHermes-3-Llama-3-8B'] },
        { id: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai', keysUrl: 'https://console.groq.com/keys', models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'moonshotai/kimi-k2-instruct'] },
        { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', keysUrl: 'https://platform.deepseek.com/api_keys', models: ['deepseek-chat', 'deepseek-reasoner'] },
        { id: 'together', name: 'Together', baseUrl: 'https://api.together.xyz', keysUrl: 'https://api.together.ai/settings/api-keys', models: ['meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8', 'deepseek-ai/DeepSeek-V3', 'Qwen/Qwen3-235B-A22B-fp8'] },
        { id: 'mistral', name: 'Mistral', baseUrl: 'https://api.mistral.ai', keysUrl: 'https://console.mistral.ai/api-keys', models: ['mistral-large-latest', 'mistral-small-latest', 'codestral-latest'] },
        { id: 'xai', name: 'xAI (Grok)', baseUrl: 'https://api.x.ai', keysUrl: 'https://console.x.ai/', models: ['grok-4', 'grok-3', 'grok-3-mini'] },
        { id: 'ollama', name: 'Ollama (локально)', baseUrl: 'http://127.0.0.1:11434', keysUrl: '', models: ['llama3.2', 'qwen2.5', 'mistral-nemo'] },
        { id: 'custom', name: 'Свой эндпоинт', baseUrl: '', keysUrl: '', models: [] },
      ],
      // квадратные SVG-значки провайдеров (переиспользуют popup/pet.js/ai.js) — без внешних файлов
      logos: {
        hermes: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="6" fill="#6c5ce7"/><path d="M7.5 6.5h2v3.2h5V6.5h2v11h-2v-3.6h-5v3.6h-2z" fill="#fff"/><path d="M3.6 9.2l3.4 1-3.4 1zM20.4 9.2l-3.4 1 3.4 1z" fill="#fff" opacity=".85"/></svg>',
        gpt: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="6" fill="#10a37f"/><path d="M12 4.6l1.8 4.0 4.0 1.8-4.0 1.8L12 16.2l-1.8-4.0L6.2 10.4l4.0-1.8z" fill="#fff"/><circle cx="12" cy="10.4" r="1.5" fill="#10a37f"/></svg>',
        other: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="6" fill="#5a6472"/><path d="M12 6.5a2.4 2.4 0 100 4.8 2.4 2.4 0 000-4.8zM7 14.5a2 2 0 100 4 2 2 0 000-4zm10 0a2 2 0 100 4 2 2 0 000-4z" fill="#fff"/><path d="M12 11.3v2.4M10.4 15.8l-2 .9M13.6 15.8l2 .9" stroke="#fff" stroke-width="1.3"/></svg>',
      },
    },

    ACT_FEED:  { hunger: -34, energy: 5,  bond: 3, mood: 10, xp: 12 },
    ACT_PET:   { mood: 14, bond: 5, xp: 2 },
    ACT_PLAY:  { mood: 20, energy: -12, hunger: 6, bond: 7, xp: 6 },
    ACT_CALL:  { mood: 4,  bond: 1 },
    ACT_HELP:  { mood: -2, energy: -10, bond: 5, xp: 5 },
    ACT_WAKE:  { energy: 4 },
    ACT_COOLDOWN_MS: 1000,   // антиспам действий
    GREET_AWAY_MS: 60000,    // отсутствовал дольше -> приветствие при возврате (если bond высокий)
  });
})();
