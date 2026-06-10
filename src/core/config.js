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
      { id: 'noema', name: 'Noema', cssClass: 'is-noema' },
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
      gpt:    { baseUrl: 'https://api.openai.com', model: 'gpt-5.5', models: ['gpt-5.5', 'gpt-5', 'gpt-4.1', 'gpt-4o', 'gpt-4o-mini', 'o3'], keysUrl: 'https://platform.openai.com/api-keys' },   // OpenAI напрямую; дефолт — последняя gpt-5.5
      // квадратные SVG-значки провайдеров (переиспользуют popup/pet.js/ai.js) — без внешних файлов
      logos: {
        hermes: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="6" fill="#6c5ce7"/><path d="M7.5 6.5h2v3.2h5V6.5h2v11h-2v-3.6h-5v3.6h-2z" fill="#fff"/><path d="M3.6 9.2l3.4 1-3.4 1zM20.4 9.2l-3.4 1 3.4 1z" fill="#fff" opacity=".85"/></svg>',
        gpt: '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="6" fill="#10a37f"/><path d="M12 4.6l1.8 4.0 4.0 1.8-4.0 1.8L12 16.2l-1.8-4.0L6.2 10.4l4.0-1.8z" fill="#fff"/><circle cx="12" cy="10.4" r="1.5" fill="#10a37f"/></svg>',
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
