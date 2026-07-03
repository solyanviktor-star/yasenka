(() => {
  'use strict';

  // Только верхнее окно
  if (window.top !== window) return;

  const ROOT_ID = 'twtr-pet-root';
  if (document.getElementById(ROOT_ID)) return; // защита от повторной инъекции

  console.log('%c🟩 Твиттер-Питомец (Creeper) запущен', 'color:#5cba47;font-weight:bold', location.href);

  // ---------- параметры ----------
  // значения вынесены в src/core/config.js (window.Yasia.config) — грузится перед pet.js
  const {
    SPEED, RUN_MUL,
    PLAT_GRAVITY, PLAT_JUMP_UP, PLAT_JUMP_DX, PLAT_JUMP_MS, PLAT_FLOOR,
    VIEW_PAD_TOP, VIEW_PAD_BOTTOM,
    PET_W, PET_H, STROKE_DIST,
    HUNGER_PER_MIN, FEED_AMOUNT, FEED_XP, LEVEL_XP, MAX_LEVEL,
    HUNGER_HUNGRY, HUNGER_STARVING, WILD, IDLE_EMOTE, SICK, STREAK,
    ENERGY_START, ENERGY_REST_MIN, ENERGY_RUN_SEC, ENERGY_SLEEP_MIN, ENERGY_LOW, ENERGY_WAKE, ENERGY_TIRED,
    BOND_START, BOND_DECAY_MIN, BOND_FRIEND, BOND_BESTIE,
    MOOD_BASE, MOOD_BIAS_MAX, MOOD_BIAS_DECAY_MIN, MOOD_HUNGER_K, MOOD_ENERGY_K, MOOD_BOND_K, MOOD_GOOD, MOOD_BAD,
    ACT_FEED, ACT_PET, ACT_PLAY, ACT_CALL, ACT_HELP, ACT_WAKE, ACT_COOLDOWN_MS, GREET_AWAY_MS,
  } = (window.Yasia && window.Yasia.config) || {};

  // ---------- состояние ----------
  let enabled = true;
  let mode = 'idle';          // idle | wander | approach | beg | happy
  let busy = false;           // занят анимацией (пакость/еда)
  let px = 80, py = 0, tx = 80, ty = 0, face = 1;
  let happyUntil = 0, wanderUntil = 0;
  let hiddenAt = 0, lastHref = location.href;
  let lastSave = 0, lastTick = 0;
  let nextMischief = 0;
  let hopPhase = 0, hopY = 0, prevPx = 80, prevPy = 0;
  let mouseX = 0, mouseY = 0;
  let paused = false;         // ⏸ пауза (попап): замерла на месте, автодействия спят; статы идут (wall-clock), явные клики работают
  let roam = true;            // ходит/бегает сама (переключается в настройках)
  let running = false, runUntil = 0, nextRunDecide = 0, runMul = 1;
  let dragging = false, dragOffX = 0, dragOffY = 0, grabPx = 0, grabPy = 0, didDrag = false;
  let thrown = false, dragVx = 0, dragVy = 0, lastDragX = 0, lastDragY = 0, peakVx = 0, peakVy = 0;   // бросок по инерции (+ пик скорости кисти)
  // платформер
  let ledges = [], standLedge = null, lastLedgeScan = 0, vy = 0, vx = 0, lastLeftEl = null;   // lastLeftEl — блок, с которого только что спрыгнула (анти-пинг-понг в свободном платформере)
  let jumping = false;   // в прыжке; внутренности прыжка (откуда/куда/горб/дроп) — в движке core/platformer.js (engine.jumpPhase/isDrop)
  let walkTargetX = 0, nextJumpDecide = 0, sayUntil = 0, nextChatter = 0, climbing = false, falling = false;
  let testKind = null, testUntil = 0, testDir = 1, testEmo = null, forceRunUntil = 0;   // ручная проверка действий/эмоций; forceRunUntil — превью «Бег» держит бег БЕЗ хайджека общих таймеров авто-решений
  // игровые параметры
  let hungerBase = 0, hungerAt = Date.now(), xp = 0, level = 1;
  // ТАМАГОЧИ: статы (модель base+at — линейное затухание по времени, как у голода; считается одинаково в любой вкладке и попапе)
  let energyBase = 100, energyAt = Date.now(), energyResting = false;   // энергия 0..100 (wall-clock: ставка по режиму сон/бодрствование)
  let bondBase = 0, bondAt = Date.now();            // привязанность 0..100
  let moodBiasBase = 0, moodBiasAt = Date.now();    // бонус настроения от ласки (тает к 0)
  let lastInteractAt = Date.now();                  // последнее взаимодействие (кормёжка/ласка/игра) -> «заброшенность» для шкалы дикости
  let sickAt = 0, nextSickCheck = 0;                // болезнь: 0 = здорова, иначе метка начала (тамагочи-петля, лечит игрок 💊)
  let wildMul = 1;                                  // ползунок вредности из попапа (sync yasiaWildMul): 0 = тихоня, 2 = прокудница
  let animOff = {};                                 // выключенные анимации (sync yasiaAnimOff): не используются в АВТОНОМНОЙ жизни (тесты/careState работают)
  let HERO_BEHAVIORS = [];                          // библиотека автономных поведений из манифеста героя (данные, не код) -> core/behavior.pickBehavior
  const recentBeh = {};                             // id поведения -> когда игралось (cooldown/анти-повтор селектора)
  let fellPeakY = null;                             // самая высокая точка текущего полёта -> сквош-приземление (land) при глубоком падении
  let pendingEmote = null;                          // эмоция, отложенная до приземления: ПАДЕНИЕ В ПРИОРИТЕТЕ — сначала земля, потом чувства ({emo, ms, line, sayMs})
  let goEdgeUntil = 0, goEdgeX = 0;                  // «идёт к краю блока, чтобы сесть» (sit_edge): цель у края текущей полки, окно времени
  let ambient = null, ambientEmo = null, resting = false;   // текущее состояние заботы (null -> первый setAmbient не короткозамкнётся)
  let happyKind = 'happy';   // что показывать в mode==='happy': 'happy' (подпрыг от ласки/еды) или 'wave' (намеренное приветствие)
  let nextAmbient = 0, nextCarePersist = 0, nextAmbSpeak = 0, nextAct = 0, awakeUntil = 0, nextIdleEmote = 0;
  let hiding = false, awayAt = 0;                   // «спрятать» + метка ухода со вкладки (для приветствия)
  let downloading = false, dlHoldT = null;          // качается видео -> Яся переходит в ОГНЕННУЮ форму (стоит, горит)
  let watching = false, watchArrived = false, watchDismissed = false, lastPopcornT = 0, watchTestUntil = 0;   // играет видео -> Яся идёт под видео, садится (watchArrived); watchDismissed=прогнали от видео; watchTestUntil — ручной тест
  let watchHelp = false, watchHelpSayT = 0;   // видео высоко, выше не залезть -> стоит на самой высокой/ближней полке и просит подсадить (англ.)
  let watchClimbing = false, watchClimbCx = 0, watchClimbY = 0, watchStuck = false, watchHopT = 0, watchStuckT = 0;   // лезет к видео по полкам (goal-directed); watchStuck=выше/ближе не достать -> просит; watchHopT=подпрыг на месте; watchStuckT=когда впервые застряла (дебаунс «подсадить»)
  let watchFromEl = null, watchMoodT = 0, watchPingT = 0, pendingMad = false;   // watchFromEl=только что покинутая полка (анти-пинг-понг); watchPingT=таймер анти-крюка (чтобы не зависнуть на настоящем обратном пути); watchMoodT=троттл роста настроения; pendingMad=злость стартует на отпускании
  let watchVid = null;   // на какое видео нацелена (DOM-ссылка) -> при смене целевого видео сбрасываем «дошла»/«просит» и заново оцениваем достижимость
  let gameActive = false, gameId = null, gameTargetX = 0, gameRun = false, gameVy = 0, gameFloor = true;   // мини-игра «забрала» питомца: главный цикл ведёт её к gameTargetX и шлёт 'game:tick' (логика в systems/games.js). gameFloor=false -> позицию ведёт сама игра (прятки за элементами)
  let gameClimb = false, gameClimbCx = 0, gameClimbY = 0;   // игра-платформер: лезет по полкам страницы к точке (gameClimbCx,gameClimbY) — напр. запрыгнуть к высокому курсору
  let speedMul = 1, sizeMul = 1, userScale = 1, userSpeed = 1, throwMul = 1;   // userScale — размер, userSpeed — скорость ходьбы, throwMul — сила инерции броска (ползунки)
  const STATE_KEY = 'petState';

  // ---------- DOM ----------
  const FACE_SVG = `<svg class="creeper__face" viewBox="0 0 8 8">
    <rect x="1" y="2" width="2" height="2"></rect>
    <rect x="5" y="2" width="2" height="2"></rect>
    <rect x="3" y="3" width="2" height="3"></rect>
    <rect x="2" y="5" width="2" height="2"></rect>
    <rect x="4" y="5" width="2" height="2"></rect>
  </svg>`;

  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.innerHTML = `
    <button class="twtr-pet-toggle" id="twtr-pet-toggle" type="button">🐾</button>
    <button class="twtr-pet-settings-btn" id="twtr-settings-btn" type="button">⚙</button>
    <div class="twtr-pet-settings" id="twtr-settings">
      <div class="twtr-set-title">Настройки питомца</div>
      <div class="twtr-set-row">
        <span id="twtr-l-size">Размер</span>
        <span class="twtr-set-stepper">
          <button class="twtr-set-mini" data-act="dec" type="button">−</button>
          <span class="twtr-set-val" id="twtr-scale-val">100%</span>
          <button class="twtr-set-mini" data-act="inc" type="button">+</button>
        </span>
      </div>
      <div class="twtr-set-row">
        <span id="twtr-l-speed">Скорость</span>
        <span class="twtr-set-stepper">
          <input class="twtr-set-range" id="twtr-speed" type="range" min="30" max="200" step="10" value="100">
          <span class="twtr-set-val" id="twtr-speed-val">100%</span>
        </span>
      </div>
      <div class="twtr-set-row">
        <span id="twtr-l-inertia">Инерция</span>
        <span class="twtr-set-stepper">
          <input class="twtr-set-range" id="twtr-inertia" type="range" min="0" max="200" step="10" value="100">
          <span class="twtr-set-val" id="twtr-inertia-val">100%</span>
        </span>
      </div>
      <div class="twtr-set-row">
        <span id="twtr-l-roam">Ходит и бегает</span>
        <button class="twtr-set-switch" id="twtr-roam-sw" type="button" role="switch" aria-checked="true"><span class="twtr-set-knob"></span></button>
      </div>
      <div class="twtr-set-sub" id="twtr-l-mode">Режим:</div><!-- режимы поведения (страж, v0.9): гейтят автономные действия -->
      <div class="twtr-mode-row">
        <button class="twtr-mode-btn" data-mode="normal" type="button">😺</button>
        <button class="twtr-mode-btn" data-mode="calm" type="button">😌</button>
      </div>
      <div class="twtr-set-sub">Проверить действие:</div>
      <div class="twtr-test-grid">
        <button class="twtr-test-btn" data-test="idle" type="button">🐾 Стоять</button>
        <button class="twtr-test-btn" data-test="wave" type="button">👋 Помахать</button>
        <button class="twtr-test-btn" data-test="left" type="button">← Идёт</button>
        <button class="twtr-test-btn" data-test="right" type="button">Идёт →</button>
        <button class="twtr-test-btn" data-test="jump" type="button">⬆ Прыжок</button>
        <button class="twtr-test-btn" data-test="climb" type="button">⛰ Карабкаться</button>
        <span id="twtr-test-emos" style="display:contents"></span><!-- кнопки эмоций строятся из манифеста героя (renderTestEmos) -->
        <button class="twtr-test-btn" data-test="emo:fall" type="button">😱 Падение</button>
        <button class="twtr-test-btn" data-test="emo:run" type="button">🏃 Бег</button>
      </div>
    </div>
    <div class="twtr-pet-dialog" id="twtr-dialog">
      <div class="twtr-dlg-backdrop" id="twtr-dlg-backdrop"></div>
      <div class="twtr-dlg-card">
        <div class="twtr-dlg-head">
          <span class="twtr-dlg-title">🐱 Яся</span>
          <span class="twtr-dlg-head-r">
            <button class="twtr-dlg-lang" id="twtr-dlg-lang" type="button">EN</button>
            <button class="twtr-dlg-x" id="twtr-dlg-x" type="button">✕</button>
          </span>
        </div>
        <div class="twtr-dlg-scroll" id="twtr-dlg-scroll">
        <div class="twtr-dlg-greet" id="twtr-dlg-greet"></div>
        <div class="twtr-dlg-ask">
          <input class="twtr-dlg-askin" id="twtr-dlg-ask" type="text">
          <button class="twtr-dlg-askshot" id="twtr-dlg-askshot" type="button" title="📸">📸</button>
          <button class="twtr-dlg-asksend" id="twtr-dlg-asksend" type="button">→</button>
        </div>
        <div class="twtr-dlg-ai" id="twtr-dlg-ai" hidden></div>
        <div class="twtr-dlg-caps" id="twtr-dlg-caps">
          <div class="twtr-skill" data-skill="ai">
            <button class="twtr-dlg-cap" id="twtr-cap-ai" type="button"><span class="twtr-cap-ic">🤖</span><span class="twtr-cap-tx" id="twtr-cap-ai-tx"></span><span class="twtr-cap-arr">›</span></button>
            <div class="twtr-skill-body" id="twtr-skill-ai" hidden>
              <div class="twtr-dlg-aipanel" id="twtr-dlg-aipanel"></div>
            </div>
          </div>
          <div class="twtr-skill" data-skill="care">
            <button class="twtr-dlg-cap" id="twtr-cap-care" type="button"><span class="twtr-cap-ic">🐾</span><span class="twtr-cap-tx" id="twtr-cap-care-tx"></span><span class="twtr-cap-arr">›</span></button>
            <div class="twtr-skill-body" id="twtr-skill-care" hidden>
              <div class="twtr-dlg-care" id="twtr-dlg-care"></div>
            </div>
          </div>
          <div class="twtr-skill" data-skill="dl">
            <button class="twtr-dlg-cap" id="twtr-cap-dl" type="button"><span class="twtr-cap-ic">📥</span><span class="twtr-cap-tx" id="twtr-cap-dl-tx"></span><span class="twtr-cap-arr">›</span></button>
            <div class="twtr-skill-body" id="twtr-skill-dl" hidden>
              <div class="twtr-dlg-video" id="twtr-dlg-video"></div>
            </div>
          </div>
          <div class="twtr-skill" data-skill="games">
            <button class="twtr-dlg-cap" id="twtr-cap-games" type="button"><span class="twtr-cap-ic">🎮</span><span class="twtr-cap-tx" id="twtr-cap-games-tx"></span><span class="twtr-cap-arr">›</span></button>
            <div class="twtr-skill-body" id="twtr-skill-games" hidden>
              <div class="twtr-dlg-games" id="twtr-dlg-games"></div>
            </div>
          </div>
          <div class="twtr-skill" data-skill="reply" id="twtr-skill-reply-wrap" hidden><!-- автореплаер: секция видна только при включённом флаге replier (см. openDialog) -->
            <button class="twtr-dlg-cap" id="twtr-cap-reply" type="button"><span class="twtr-cap-ic">✍️</span><span class="twtr-cap-tx" id="twtr-cap-reply-tx"></span><span class="twtr-cap-arr">›</span></button>
            <div class="twtr-skill-body" id="twtr-skill-reply" hidden>
              <div class="twtr-dlg-reply" id="twtr-dlg-reply"></div>
            </div>
          </div>
          <div class="twtr-skill" data-skill="notes">
            <button class="twtr-dlg-cap" id="twtr-cap-notes" type="button"><span class="twtr-cap-ic">📝</span><span class="twtr-cap-tx" id="twtr-cap-notes-tx"></span><span class="twtr-cap-arr">›</span></button>
            <div class="twtr-skill-body" id="twtr-skill-notes" hidden>
              <textarea class="twtr-dlg-text" id="twtr-dlg-text" rows="3"></textarea>
              <div class="twtr-dlg-actions"><button class="twtr-dlg-save" id="twtr-dlg-save" type="button">Сохранить</button></div>
              <div class="twtr-dlg-list" id="twtr-dlg-list"></div>
            </div>
          </div>
        </div>
        <div class="twtr-dlg-capsempty" id="twtr-dlg-capsempty" hidden></div>
        </div>
      </div>
    </div>
    <div class="twtr-pet is-walking" id="twtr-pet">
      <div class="twtr-pet__bubble" id="twtr-pet-bubble">❤?</div>
      <div class="twtr-pet-sign" id="twtr-pet-sign" hidden></div>
      <div class="twtr-pet__inner">
        <div class="twtr-pet__char">
          <div class="creeper">
            <div class="creeper__legs">
              <span class="creeper__leg leg-back leg-a"></span>
              <span class="creeper__leg leg-back leg-b"></span>
              <span class="creeper__leg leg-front leg-b"></span>
              <span class="creeper__leg leg-front leg-a"></span>
            </div>
            <div class="creeper__body"></div>
            <div class="creeper__head">${FACE_SVG}</div>
          </div>
          <div class="twtr-pet__sprite" id="twtr-sprite"></div>
        </div>
      </div>
    </div>`;
  document.documentElement.appendChild(root);

  const pet = root.querySelector('#twtr-pet');
  const inner = root.querySelector('.twtr-pet__inner');
  const bubble = root.querySelector('#twtr-pet-bubble');
  const toggle = root.querySelector('#twtr-pet-toggle');
  const settingsBtn = root.querySelector('#twtr-settings-btn');
  const settingsPanel = root.querySelector('#twtr-settings');
  const scaleVal = root.querySelector('#twtr-scale-val');
  const speedRange = root.querySelector('#twtr-speed');
  const speedVal = root.querySelector('#twtr-speed-val');
  const inertiaRange = root.querySelector('#twtr-inertia');
  const inertiaVal = root.querySelector('#twtr-inertia-val');
  const roamSw = root.querySelector('#twtr-roam-sw');
  const dialog = root.querySelector('#twtr-dialog');
  const dlgText = root.querySelector('#twtr-dlg-text');
  const dlgList = root.querySelector('#twtr-dlg-list');
  const dlgVideo = root.querySelector('#twtr-dlg-video');
  const dlgCare = root.querySelector('#twtr-dlg-care');
  const sprite = root.querySelector('#twtr-sprite');
  const frameEls = {};                                   // все кадры лежат слоями-картинками, переключаем видимость (без мерцания от смены src)
  // (заполняется ниже из CAT_SETS — по одному <img> на кадр)
  let curFrameEl = null;
  let firstFrameReady = false, pendingReveal = false;   // первый показ ждём декодирования стартового кадра -> без «прозрачного квадрата» на первой загрузке
  function showFrame(name) {
    let el = frameEls[name];
    if (!el && CAT_SETS[name]) el = frameEls[CAT_SETS[name][0]];   // дали имя СОСТОЯНИЯ (idle/wave/jump) -> берём первый кадр (idle0…)
    if (!el || el === curFrameEl) return;
    if (curFrameEl) curFrameEl.classList.remove('on');
    el.classList.add('on'); curFrameEl = el;
  }

  // ---------- выбор героя ----------
  // реестр скинов с покадровой анимацией. dir — папка в src/heroes/. Раскладка кадров у всех одна (CAT_FRAMES).
  const isFramed = () => hero !== 'creeper';   // любой герой со спрайт-кадрами (всё, кроме старого крипера); список героев — в core/config.js HEROES, папка = id
  let hero = 'catgirl';   // 'creeper' (скрыт) | 'catgirl' = Yasia (по умолчанию) | 'noema'
  // кошка — кадры по состояниям. ИСТОЧНИК ПРАВДЫ — манифест героя (src/heroes/<id>/manifest.json), который грузит
  // applyManifest() и переписывает таблицы ниже. Значения здесь = FALLBACK, если манифест не загрузился (поведение не ломается).
  let CAT_IDLE_MS = 480, CAT_WALK_MS = 110, CAT_RUN_MS = 70, CAT_JUMP_MS = 70, CAT_CLIMB_MS = 170, CAT_FALL_MS = 90, CAT_WAVE_MS = 150;
  const CAT_EMO_MS = 150;                        // дефолт для эмоции без своего тайминга
  let CAT_FIRE_MS = 130; const FIRE_MIN_MS = 2600;   // огонь мерцает (мс/кадр); огненная форма держится минимум столько (видно даже на быстром скачивании)
  // темп эмоций по смыслу (мс/кадр): сон медленно «дышит», голод настойчив, злость дрожит резко
  let EMO_MS = { sleep: 480, hungry: 180, sad: 260, angry: 120, dizzy: 170, happy: 130 };
  const emoMs = (name) => EMO_MS[name] || CAT_EMO_MS;
  const HAPPY_HOP_PX = 18, HAPPY_HOP_MS = 340;   // радость — высота и частота подпрыгивания
  let CAT_FRAMES = {             // state -> сколько кадров (1 = одиночный спрайт <state>.png в папке <state>/)
    idle: 4, walk: 6, jump: 4, climb: 1, wave: 4,                                   // idle=дыхание, wave=махание, jump=дуга
    happy: 4, sad: 5, angry: 5, dizzy: 5, hungry: 5, sleep: 5, fall: 5, run: 6,     // эмоции = упорядоченные циклы (ping-pong)
    fire: 4,                                                                        // ОГНЕННАЯ форма (только Яся): стоит, пламя мерцает — на время скачивания видео
  };
  // эмоции, где кадры = разные позы (не motion-арк) -> включаем кросс-фейд, чтобы сгладить скачки. Ходьбу/бег/прыжок НЕ трогаем.
  const EMO_XFADE = {};   // кросс-фейд ОТКЛЮЧЁН: между разными позами он давал двоение («мигание»). Плавность теперь = упорядоченные кадры + ping-pong
  const STATIC_HOLD = { idle: 1 };   // состояния-«одна картинка»: кадр НЕ циклим (даже если в манифесте их несколько); оживление = мягкое CSS-дыхание .twtr-pet__char (покой = 1 картинка, как раньше)
  // эмоции-движения проигрываем ping-pong (0..n-1..1) -> бесшовный цикл из последовательности «начало -> пик»
  let PING_PONG = { sad: 1, angry: 1, dizzy: 1, hungry: 1, sleep: 1 };
  let FRAME_SRC = null;          // key -> относительный путь спрайта из манифеста (если null -> папочная конвенция)
  let MANIFEST_EMOS = [];        // эмоции из манифеста [{key,icon,label}] -> авто-кнопки тест-сетки и подписи
  const AMBIENT_DEFAULT = { sleep: 'sleep', hungry: 'hungry', grumpy: 'angry', starving: 'sad', sick: 'dizzy' }; // care-state -> эмоция (фолбэк; манифест переопределяет полем careState на эмоции; sick без спрайта = головокружение)
  let AMBIENT_EMO = Object.assign({}, AMBIENT_DEFAULT);
  let ACTION_STATE = {};         // appState из манифеста (напр. watching) -> имя анимации; событийные действия (смотрит видео и т.п.)
  const CAT_SETS = {}, CAT_DIR = {};
  // дефолты-фолбэк в ОДНОМ месте: если манифест не загрузился, всё откатывается сюда (без загрязнения таблиц от прошлого героя)
  function resetToDefaults() {
    CAT_IDLE_MS = 480; CAT_WALK_MS = 110; CAT_RUN_MS = 70; CAT_JUMP_MS = 70; CAT_CLIMB_MS = 170; CAT_FALL_MS = 90; CAT_WAVE_MS = 150; CAT_FIRE_MS = 130;
    EMO_MS = { sleep: 480, hungry: 180, sad: 260, angry: 120, dizzy: 170, happy: 130 };
    CAT_FRAMES = { idle: 4, walk: 6, jump: 4, climb: 1, wave: 4, happy: 4, sad: 5, angry: 5, dizzy: 5, hungry: 5, sleep: 5, fall: 5, run: 6 };
    if (hero === 'catgirl') CAT_FRAMES.fire = 4;   // огненная форма только у Яси (и в фолбэке без манифеста)
    PING_PONG = { sad: 1, angry: 1, dizzy: 1, hungry: 1, sleep: 1 };
    AMBIENT_EMO = Object.assign({}, AMBIENT_DEFAULT);   // care-state -> эмоция: дефолтная карта
    ACTION_STATE = {};                                  // app-state-анимации только из манифеста (в фолбэке нет)
    MANIFEST_EMOS = [];                                 // тест-сетка откатится на DEFAULT_EMOS
    FRAME_SRC = null;
    for (const k in CAT_SETS) delete CAT_SETS[k];
    for (const k in CAT_DIR) delete CAT_DIR[k];
    for (const st in CAT_FRAMES) {
      const n = CAT_FRAMES[st];
      CAT_SETS[st] = n === 1 ? [st] : Array.from({ length: n }, (_, i) => st + i);    // idle->['idle'], walk->['walk0'..'walk5']
      for (const f of CAT_SETS[st]) CAT_DIR[f] = st;                                   // walk3->'walk', angry0->'angry'
    }
  }
  resetToDefaults();   // первичная сборка наборов из дефолтов (манифест переопределит при загрузке героя)
  for (const st in CAT_SETS) for (const f of CAT_SETS[st]) {                         // строим слои-картинки (по одному <img> на кадр)
    const im = document.createElement('img'); im.setAttribute('data-f', f); im.alt = ''; sprite.appendChild(im); frameEls[f] = im;
  }
  let catIdx = 0, catStep = 0, lastFrameT = 0, catAct = null;   // catStep — счётчик для ping-pong (0..2(n-1))
  function frameUrl(k) {
    const dir = hero;   // папка героя = его id (src/heroes/<id>/)
    try {
      const rel = (FRAME_SRC && FRAME_SRC[k]) ? FRAME_SRC[k] : (CAT_DIR[k] || k) + '/' + k + '.png';   // путь из манифеста или папочная конвенция (фолбэк)
      // ?v=<версия> — cache-buster: при замене спрайта файл лежит по тому же URL, и Chrome отдал бы СТАРЫЙ кадр из кэша. Версия в URL = свежая загрузка после reload расширения.
      const ver = (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || '0';
      return chrome.runtime.getURL('src/heroes/' + dir + '/' + rel) + '?v=' + ver;
    } catch (_) { return ''; }
  }
  function buildCatFrames() {
    for (const k in frameEls) {
      if (FRAME_SRC) {                                                  // манифест активен: гасим кадры, которых нет у текущего героя
        if (!FRAME_SRC[k]) { frameEls[k].removeAttribute('src'); continue; }
        frameEls[k].src = frameUrl(k); continue;
      }
      if (!CAT_DIR[k]) { frameEls[k].removeAttribute('src'); continue; }   // фолбэк: гасим осиротевшие слои прошлого героя (нет в текущих наборах) -> без 404
      const u = frameUrl(k); if (u) frameEls[k].src = u;
    }
  }
  function ensureLayer(key) {   // <img>-слой под новый кадр из манифеста (которого не было в дефолтах)
    if (frameEls[key]) return;
    const im = document.createElement('img'); im.setAttribute('data-f', key); im.alt = ''; sprite.appendChild(im); frameEls[key] = im;
  }
  // применить манифест героя как ИСТОЧНИК ПРАВДЫ: пересобрать наборы кадров/тайминги/ping-pong (поведение = данные).
  function applyManifest(m) {
    const A = (m && m.animations) || {};
    const sets = {}, src = {}, ms = {}, pp = {}, frames = {}, emos = [], am = {}, act = {};
    for (const name in A) {
      const a = A[name] || {};
      const fr = Array.isArray(a.frames) ? a.frames : [];
      const keys = fr.map((p) => String(p).split('/').pop().replace(/\.png$/i, ''));   // ключ кадра = имя файла без .png (idle0, climb…)
      sets[name] = keys.length ? keys : [name];
      frames[name] = sets[name].length;
      keys.forEach((k, i) => { src[k] = fr[i]; });
      if (a.fps) ms[name] = Math.round(1000 / a.fps);
      if (a.pingpong) pp[name] = 1;
      if (a.group === 'emotions') emos.push({ key: name, icon: a.icon || '', label: a.label || name });   // -> тест-сетка + подпись (новая эмоция = кнопка)
      if (a.careState) am[a.careState] = name;   // care-state -> эмоция: авто-показ по состоянию питомца (данные, не код)
      if (a.appState) act[a.appState] = name;    // app-state -> анимация: событийное действие (напр. watching=смотрит видео)
    }
    for (const k in CAT_SETS) delete CAT_SETS[k];
    for (const k in CAT_DIR) delete CAT_DIR[k];
    for (const name in sets) { CAT_SETS[name] = sets[name]; for (const k of sets[name]) CAT_DIR[k] = name; }
    CAT_FRAMES = frames;
    const mm = (n, d) => (ms[n] != null ? ms[n] : d);
    CAT_IDLE_MS = mm('idle', 480); CAT_WALK_MS = mm('walk', 110); CAT_RUN_MS = mm('run', 70);
    CAT_JUMP_MS = mm('jump', 70); CAT_CLIMB_MS = mm('climb', 170); CAT_FALL_MS = mm('fall', 90);
    CAT_WAVE_MS = mm('wave', 150); CAT_FIRE_MS = mm('fire', 130);
    EMO_MS = Object.assign({}, ms, { sleep: mm('sleep', 480), hungry: mm('hungry', 180), sad: mm('sad', 260), angry: mm('angry', 120), dizzy: mm('dizzy', 170), happy: mm('happy', 130) });   // fps ЛЮБОЙ эмоции из манифеста (...ms) + семантические дефолты для известных
    PING_PONG = pp;
    FRAME_SRC = src;
    MANIFEST_EMOS = emos;
    AMBIENT_EMO = Object.assign({}, AMBIENT_DEFAULT, am);   // карта care-state -> эмоция из манифеста (с дефолтами как фолбэк)
    ACTION_STATE = act;   // карта app-state -> анимация из манифеста (watching и т.п.)
    if (emos.length) EMOTIONS = emos.map((e) => ({ key: e.key, emo: e.icon, name: e.label })).concat(EMO_EXTRA);   // подписи в облачке — тоже из манифеста
    for (const k in src) ensureLayer(k);   // докинуть слои под новые кадры (новые эмоции/действия)
    // библиотека автономных поведений (данные): {id, anim, kind, when, weight, cooldown, dur, sayPool} -> pickBehavior в idle-жизни
    const B = (m && m.behaviors) || {};
    HERO_BEHAVIORS = Object.keys(B).map((id) => Object.assign({ id }, B[id]));
  }
  function renderTestEmos() {   // строит кнопки эмоций в сетке «Проверить действие» из манифеста (а не из статичного HTML)
    const box = root.querySelector('#twtr-test-emos');
    if (!box) return;
    const list = (MANIFEST_EMOS && MANIFEST_EMOS.length) ? MANIFEST_EMOS : DEFAULT_EMOS;
    box.innerHTML = list.map((e) =>
      `<button class="twtr-test-btn" data-test="emo:${e.key}" type="button">${(e.icon ? e.icon + ' ' : '') + (e.label || e.key)}</button>`).join('')
      + (CAT_SETS.fire ? '<button class="twtr-test-btn" data-test="fire" type="button">' + tr().tbFire + '</button>' : '')   // кнопка огня только у героя с fire в манифесте
      + (watchAnim() ? '<button class="twtr-test-btn" data-test="watch" type="button">' + tr().tbPopcorn + '</button>' : '');   // кнопка «смотрит видео» только у героя с watching-анимацией
  }
  function applyHero() {
    pet.classList.toggle('is-catgirl', isFramed());   // класс = режим спрайт-кадров (любой скин)
    const HEROES_CFG = (window.Yasia && Yasia.config && Yasia.config.HEROES) || [];   // скин-CSS из реестра (data-driven): у кого есть cssClass — тоглим по текущему герою
    if (HEROES_CFG.length) HEROES_CFG.forEach((h) => { if (h.cssClass) pet.classList.toggle(h.cssClass, h.id === hero); });
    else pet.classList.toggle('is-noema', hero === 'noema');   // фолбэк, если реестр не загрузился
    if (!isFramed()) return;
    const finish = () => {
      buildCatFrames(); catIdx = 0; catAct = null; showFrame('idle');
      pet.classList.toggle('is-fire', downloading && !!CAT_SETS.fire);   // огонь/свечение только у героя, у кого fire есть (смена скина во время скачивания)
      renderTestEmos();   // сетка тест-эмоций строится из манифеста (новая эмоция = кнопка без правки кода)
      const idle0 = (CAT_SETS.idle && CAT_SETS.idle[0]) || 'idle';   // базовый кадр = первый idle
      const probe = new Image();   // откат на крипера только если базовый кадр реально не грузится
      probe.onerror = () => { if (isFramed()) pet.classList.remove('is-catgirl'); };
      probe.src = frameEls[idle0] ? frameEls[idle0].src : '';
      const idleEl = frameEls[idle0];   // показываем Ясю только когда стартовый PNG декодирован (иначе мелькает пустой квадрат)
      const markReady = () => { firstFrameReady = true; if (pendingReveal) { pendingReveal = false; pet.style.opacity = '1'; } };
      if (!idleEl || !idleEl.src) markReady();
      else if (idleEl.complete && idleEl.naturalWidth > 0) markReady();   // уже в кэше
      else { idleEl.addEventListener('load', markReady, { once: true }); idleEl.addEventListener('error', markReady, { once: true }); setTimeout(markReady, 2000); }   // страховка: не остаться невидимой, если картинка не грузится
    };
    const id = hero;
    if (Yasia.heroes) Yasia.heroes.load(id, (m) => {
      if (id !== hero) return;                 // устаревший колбэк: герой сменился во время async-загрузки манифеста
      if (m) applyManifest(m); else resetToDefaults();   // нет манифеста -> чистые дефолты + папочный фолбэк
      finish();
    });
    else { resetToDefaults(); finish(); }
  }

  py = ty = prevPy = window.innerHeight - PET_H - 40;
  mouseX = window.innerWidth / 2; mouseY = window.innerHeight / 2;

  // ---------- утилиты ----------
  const now = () => performance.now();
  const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

  // ---------- речь питомца ---------- (пулы фраз вынесены в L.<lang>.say.* — локализуются переключателем языка)
  const SP = (k) => (tr().say && tr().say[k]) || [];   // пул реплик текущего языка
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  function say(text, ms) {
    bubble.textContent = text;
    bubble.classList.remove('talk');
    void bubble.offsetWidth;                  // рестарт анимации pop-out
    bubble.classList.add('show', 'talk');
    sayUntil = now() + (ms || 1600);
  }

  function cleanup() { try { root.remove(); } catch (_) {} }

  function dialogOpen() { return !!document.querySelector('div[role="dialog"]'); }
  function isTyping() {
    const a = document.activeElement;
    return !!a && (a.isContentEditable || a.tagName === 'TEXTAREA' || a.tagName === 'INPUT');
  }

  // ---------- голод / уровни ----------
  function currentHunger() {
    return clamp(hungerBase + (Date.now() - hungerAt) / 60000 * HUNGER_PER_MIN, 0, 100);
  }
  function levelFromXp(x) {
    let lv = 1;
    for (let i = 0; i < LEVEL_XP.length; i++) if (x >= LEVEL_XP[i]) lv = i + 1;
    return lv;
  }
  function applyAbilities() {
    level = levelFromXp(xp);
    speedMul = 1 + (level - 1) * 0.12;     // с уровнем — живее
    sizeMul = 1 + (level - 1) * 0.06;      // и крупнее
    pet.classList.toggle('is-glow', level >= 4);
  }

  // ---------- ТАМАГОЧИ: статы (energy/bond/mood) ----------
  const elapsedMin = (at) => (Date.now() - at) / 60000;
  // энергия: во сне (energyResting) растёт, иначе тратится — wall-clock, поэтому восстановление работает и в фоне/оффлайн
  function currentEnergy() {
    const rate = energyResting ? ENERGY_SLEEP_MIN : -ENERGY_REST_MIN;
    return clamp(energyBase + elapsedMin(energyAt) * rate, 0, 100);
  }
  function setEnergyResting(r) { if (r === energyResting) return; energyBase = currentEnergy(); energyAt = Date.now(); energyResting = r; }   // фиксируем энергию на смене режима
  function currentBond() { return clamp(bondBase - elapsedMin(bondAt) * BOND_DECAY_MIN, 0, 100); }
  function currentWildness() {   // дикость 0..100: голод/скука/заброшенность дичат, привязанность усмиряет (core/behavior.js)
    const neglectMin = (Date.now() - lastInteractAt) / 60000;
    const w = (Yasia.behavior && Yasia.behavior.wildnessOf)
      ? Yasia.behavior.wildnessOf({ hunger: currentHunger(), mood: currentMood(), bond: currentBond(), neglectMin }, WILD)
      : 50;
    return clamp(w * wildMul, 0, 100);   // ползунок вредности из попапа: 0 = совсем не пакостит, 2 = вдвое дичее
  }
  function currentMoodBias() {   // бонус от ласки тает к нулю
    const dec = elapsedMin(moodBiasAt) * MOOD_BIAS_DECAY_MIN;
    return moodBiasBase > 0 ? Math.max(0, moodBiasBase - dec) : Math.min(0, moodBiasBase + dec);
  }
  function currentMood() {       // ПРОИЗВОДНОЕ: голод/энергия/привязанность + бонус
    const h = currentHunger(), e = currentEnergy(), b = currentBond();
    let m = MOOD_BASE + currentMoodBias();
    if (h > 60) m -= (h - 60) * MOOD_HUNGER_K;
    if (e < 30) m -= (30 - e) * MOOD_ENERGY_K;
    m += b * MOOD_BOND_K;
    if (sickAt && SICK) m -= SICK.moodPenalty;   // болеет -> кисло на душе (пока не полечили)
    return clamp(m, 0, 100);
  }
  // мутаторы (rebase: читаем текущее с учётом затухания, прибавляем дельту, сбрасываем метку времени)
  function addEnergy(d) { energyBase = clamp(currentEnergy() + d, 0, 100); energyAt = Date.now(); }
  function addBond(d) { bondBase = clamp(currentBond() + d, 0, 100); bondAt = Date.now(); }
  function addMoodBias(d) { moodBiasBase = clamp(currentMoodBias() + d, -MOOD_BIAS_MAX, MOOD_BIAS_MAX); moodBiasAt = Date.now(); }
  function addHunger(d) { hungerBase = clamp(currentHunger() + d, 0, 100); hungerAt = Date.now(); }
  function saveCare(extra) {
    Yasia.storage.localSet(Object.assign({
      hunger: hungerBase, hungerAt,
      energy: energyBase, energyAt, energyResting,
      bond: bondBase, bondAt,
      moodBias: moodBiasBase, moodBiasAt,
      sick: sickAt,
    }, extra || {}));
  }

  // амбиентное состояние по статам -> поза/поведение
  function computeAmbient() {
    const h = currentHunger(), e = currentEnergy(), m = currentMood();
    const sleepThr = resting ? ENERGY_WAKE : ENERGY_LOW;          // гистерезис: засыпает на ENERGY_LOW, просыпается только выспавшись (ENERGY_WAKE)
    if (e < sleepThr && now() > awakeUntil) return 'sleep';
    if (sickAt) return 'sick';                                   // болеет -> вялая, ждёт лечения (выше голода: лечат раньше, чем кормят)
    if (h >= HUNGER_STARVING) return 'starving';                 // очень голодная -> грустит/вредничает
    if (m <= MOOD_BAD) return 'grumpy';                          // плохое настроение -> сидит/бурчит
    if (h >= HUNGER_HUNGRY) return 'hungry';                     // голодная -> просит
    if (m >= MOOD_GOOD && e >= ENERGY_TIRED) return 'playful';   // довольна и бодра -> бегает/прыгает
    return 'normal';
  }
  function setAmbient(a) {
    if (a === ambient) return;
    ambient = a;
    ambientEmo = AMBIENT_EMO[a] || null;   // care-state -> эмоция по карте (из манифеста: поле careState; иначе дефолт) -> новая авто-эмоция = только данные
    resting = (a === 'sleep');
    setEnergyResting(resting);                         // сон <-> бодрствование переключает знак ставки энергии
    pet.classList.toggle('is-resting', resting);
  }
  function ambientSpeak(t) {
    if (t < nextAmbSpeak || busy || dragging || hiding || gameActive || dialog.classList.contains('show') || isTyping()) return;
    nextAmbSpeak = t + 11000 + Math.random() * 12000;
    let line = null;
    if (ambient === 'sleep') { if (Math.random() < 0.5) line = tr().sZzz; }
    else if (ambient === 'sick') line = pick(SP('sick'));
    else if (ambient === 'starving') line = pick(SP('starving'));
    else if (ambient === 'hungry') line = pick(SP('hungry'));
    else if (ambient === 'grumpy') line = pick(SP('grumpy'));
    else if (currentBond() >= BOND_FRIEND && Math.random() < 0.5) line = pick(SP('bond'));
    if (line) say(line, 2200);
  }
  // спонтанная idle-жизнь: периодический кубик (IDLE_EMOTE.chance играем / иначе гуляет дальше), а ЧТО играть выбирает
  // core/behavior.pickBehavior по библиотеке из манифеста героя (weights/when/cooldown) — новое поведение = данные, не код.
  function maybeIdleEmote(t) {
    if (Yasia.guard && !Yasia.guard.allows('chatter')) return;     // спокойный режим -> без спонтанных эмоций
    if (!IDLE_EMOTE || !roam || paused || busy || dragging || hiding || gameActive || resting || thrown || jumping || falling || watching) return;   // watching: поход к видео/просмотр не прерываем позами (иначе «идёт-машет-идёт»)
    if (dialog.classList.contains('show') || isTyping() || now() < testUntil) return;
    if (ambient !== 'normal' && ambient !== 'playful') return;     // негативные состояния (голод/сон/злость/болезнь) эмотят сами
    if (t < nextIdleEmote) return;
    nextIdleEmote = t + IDLE_EMOTE.minMs + Math.random() * (IDLE_EMOTE.maxMs - IDLE_EMOTE.minMs);
    if (Math.random() >= (IDLE_EMOTE.chance || 0.2)) return;       // 80% -> дальше ходит/прыгает по странице
    if (HERO_BEHAVIORS.length && Yasia.behavior && Yasia.behavior.pickBehavior) {
      const st = { hunger: currentHunger(), mood: currentMood(), energy: currentEnergy(), bond: currentBond(), wild: currentWildness() };
      // «сидит на краю» требует опоры-полки; у края садится сразу, иначе САМА идёт к ближайшему краю и садится по прибытии (goSitEdge)
      const canSitEdge = !!standLedge && !standLedge.floor && !falling && !jumping && !watching && !gameActive;   // на полу «краёв» нет — только на блоках
      let cands = HERO_BEHAVIORS.filter((b) => !animOff[b.anim || b.id]);   // тумблеры анимаций (попап) гасят поведение целиком
      if (!canSitEdge) cands = cands.filter((b) => (b.anim || b.id) !== 'sit_edge');   // в воздухе/на полу/у видео -> «сидеть на краю» недоступна
      const b = Yasia.behavior.pickBehavior(cands, st, recentBeh, t, Math.random, { wild: st.wild, bondFriend: BOND_FRIEND });
      if (b) {
        recentBeh[b.id] = t;
        if ((b.anim || b.id) === 'sit_edge') { goSitEdge(t); return; }   // сесть на край: у края — сразу, с середины — сама идёт к краю (общий хелпер)
        playEmote(b.anim || b.id, (b.dur || 2.4) * 1000);
        if (b.sayPool && Math.random() < 0.6) { const line = pick(SP(b.sayPool)); if (line) say(line, 2000); }   // подпись — не каждый раз (не заспамить)
        return;
      }
    }
    const pool = (IDLE_EMOTE.pool || ['happy', 'wave']).filter((k) => !animOff[k]);   // фолбэк: старый пул (манифест без behaviors)
    if (pool.length) playEmote(pool[Math.floor(Math.random() * pool.length)], 2400);
  }
  // болезнь: раз в SICK.checkMs кидаем кубик по факторам голода/настроения/заброшенности; выздоровление — кнопкой 💊 (или сама через сутки)
  function sickCheck(t) {
    if (!SICK) return;
    if (t < nextSickCheck) return;
    nextSickCheck = t + SICK.checkMs;
    if (sickAt) {
      if (Date.now() - sickAt > SICK.autoHealMs) { sickAt = 0; saveCare({ sick: 0 }); nextAmbient = 0; }   // отлежалась сама
      return;
    }
    let p = 0;
    if (currentHunger() >= HUNGER_STARVING) p += SICK.pStarving;
    if (currentMood() <= MOOD_BAD) p += SICK.pGrumpy;
    if ((Date.now() - lastInteractAt) / 60000 > SICK.neglectMin) p += SICK.pNeglect;
    if (p > 0 && Math.random() < p) {
      sickAt = Date.now(); saveCare({ sick: sickAt }); nextAmbient = 0;   // заболела -> ambient пересчитается немедленно
      say(pick(SP('sick')) || '🤒', 2400);
    }
  }
  function careTick(t, dt) {
    // восстановление сна теперь в currentEnergy (wall-clock); здесь только доп. расход на бег
    if (!resting && running && pet.classList.contains('is-moving')) addEnergy(-ENERGY_RUN_SEC * dt / 1000);
    if (comeUntil && t > comeUntil) comeUntil = 0;          // не добежала за отведённое время — снимаем «зов»
    if (t > nextAmbient) { nextAmbient = t + 1200; setAmbient(computeAmbient()); }
    if (t > nextCarePersist) { nextCarePersist = t + 5000; saveCare(); }
    ambientSpeak(t);
    maybeIdleEmote(t);
    sickCheck(t);
  }

  // ---------- ТАМАГОЧИ: действия пользователя (скил «Забота») ----------
  function applyAct(a) {
    if (!a) return;
    lastInteractAt = Date.now();   // любое действие = взаимодействие -> сбрасывает «заброшенность» (успокаивает дикость)
    if (a.hunger) addHunger(a.hunger);
    if (a.energy) addEnergy(a.energy);
    if (a.bond) addBond(a.bond);
    if (a.mood) addMoodBias(a.mood);
    if (a.xp) gainXp(a.xp);
  }
  let comeUntil = 0;                          // пока бежит на зов — целевая точка у курсора
  function comeHere() {                       // «позвать» — прибегает к курсору
    if (hiding) unhide();
    awakeUntil = now() + 8000; nextAmbient = now() + 1200; setAmbient(computeAmbient());   // мгновенно будим (resting=false), иначе не побежит
    const tgt = clamp((mouseX || window.innerWidth / 2) - PET_W / 2, 0, window.innerWidth - PET_W);
    walkTargetX = tgt; running = true; runUntil = now() + 2200; nextRunDecide = now() + 2400; nextJumpDecide = now() + 2600; comeUntil = now() + 2600;
    face = tgt > px ? 1 : -1;
    setMode('wander');   // НЕ happy: иначе ветка happy в tick не вызывает платформер и питомец стоит. Радость — по прибытии
    say(pick(SP('come')), 1400);
  }
  function hide() { hiding = true; pet.classList.add('is-hiding'); setMode('idle'); say(tr().sHide, 1600); }
  function unhide() { if (!hiding) return; hiding = false; pet.classList.remove('is-hiding'); setMode('happy'); happyUntil = now() + 900; }
  function playEmote(emo, ms) {
    if (thrown || falling || jumping) { pendingEmote = { emo, ms }; return; }   // в полёте эмоций нет: физика доиграет, эмоция стрельнёт на земле (блок в tick)
    testKind = 'emo'; testEmo = emo; testUntil = now() + (ms || 2600); setMode('idle'); climbing = false; jumping = false;
  }
  function doFeed() { applyAct(ACT_FEED); saveCare(); feedEat(); }
  function doPet() { applyAct(ACT_PET); saveCare(); playEmote('pet_purr', 2200); say(currentBond() >= BOND_FRIEND ? pick(SP('bond')) : tr().sPetMur, 1600); }
  function doPlay() {
    if (sickAt) { say(tr().sSickCant, 1900); return; }             // болеет — сначала полечи
    if (currentEnergy() < 12) { addMoodBias(-3); saveCare(); say(tr().sPlayTired, 1800); return; }
    applyAct(ACT_PLAY); saveCare();
    if (CAT_SETS.pounce) startPounce(); else playEmote('like_proud', 2600);   // наскок = рывок вперёд (движение), не поза на месте
    say(tr().sPlayYay, 1800);
  }
  // сесть на край опоры: у края — сразу (лицом наружу, ноги свисают); с середины — идёт к ближайшему краю, сядет по прибытии (ветка goEdge в platformerTick)
  function goSitEdge(t) {
    if (!standLedge || falling || jumping) return false;
    const x1 = standLedge.x1, x2 = standLedge.x2;
    if (px <= x1 + 12 || px + PET_W >= x2 - 12) { face = (px <= x1 + 12) ? -1 : 1; playEmote('sit_edge', 3600); return true; }
    const leftNear = (px - x1) <= (x2 - (px + PET_W));
    goEdgeX = leftNear ? x1 : (x2 - PET_W);
    goEdgeUntil = t + 8000;   // окно похода: на полу край = край экрана, путь бывает полэкрана
    return true;
  }
  // наскок в движении: короткий рывок вперёд прыжками (кадры pounce), в сторону курсора; держится в пределах текущей полки/экрана
  function startPounce() {
    testKind = 'pounce'; testEmo = null; testUntil = now() + 1600; goEdgeUntil = 0;
    face = (mouseX || window.innerWidth / 2) > px + PET_W / 2 ? 1 : -1; testDir = face;
    climbing = false; jumping = false; falling = false; thrown = false; vx = 0; vy = 0;
    setMode('idle');
  }
  function doHeal() {   // 💊 лечение: тамагочи-петля «заболела -> полечи -> сближение»
    if (!sickAt) { say(tr().sHealNot, 1600); return; }
    sickAt = 0;
    applyAct({ bond: SICK.healBond, xp: SICK.healXp, mood: SICK.healMood });
    saveCare({ sick: 0 }); nextAmbient = 0;
    playEmote(CAT_SETS.heal ? 'heal' : 'happy', 2600);
    say(tr().sHealDone, 2200);
  }
  function doCall() { applyAct(ACT_CALL); saveCare(); comeHere(); }
  function doHelp() {
    if (currentMood() <= MOOD_BAD || currentEnergy() < 20) { addMoodBias(-2); saveCare(); say(tr().sHelpNoEnergy, 1800); return; }
    applyAct(ACT_HELP); saveCare(); unhide();
    setMode('happy'); happyUntil = now() + 1500; startTest('jump'); say(pick(SP('help')), 1900);
  }
  function doWake() {
    const sleepy = resting || currentEnergy() <= ENERGY_TIRED;
    if (!sleepy) { say(tr().sWakeNot, 1500); return; }
    applyAct(ACT_WAKE);
    if (currentEnergy() < ENERGY_LOW + 12) addEnergy(ENERGY_LOW + 12 - currentEnergy());   // реально выводим из сна (иначе уснёт снова через окно awakeUntil)
    awakeUntil = now() + 20000; nextAmbient = now() + 1200; setAmbient(computeAmbient()); saveCare();
    playEmote('wake', 2400); say(tr().sWakeUp, 1700);
  }
  function careAction(k) {
    if (now() < nextAct) return; nextAct = now() + ACT_COOLDOWN_MS;
    const movers = { call: 1, help: 1, hide: 1, play: 1 };  // действия с перемещением -> закрываем облачко (иначе ветка «диалог открыт» в tick замораживает наскок)
    if (movers[k]) closeDialog();
    ({ feed: doFeed, pet: doPet, play: doPlay, call: doCall, help: doHelp, hide: hide, wake: doWake, heal: doHeal }[k] || (() => {}))();
    if (!movers[k] && dialog.classList.contains('show')) renderCareStatus();
  }

  // ---------- мини-игры (логика в src/systems/games.js) ----------
  // pet.js даёт играм безопасный API над питомцем (позиция/курсор/XP/настроение/эмоции/ходьба) — см. petApi в yasiaCtx.
  // Игра «забирает» питомца (gameClaim): главный цикл ведёт его к gameTargetX (наземно) и каждый кадр шлёт 'game:tick',
  // где модуль игры двигает свои сущности, ставит цель и считает столкновения. Обычное гуляние/пакости/видео — на паузе.
  function gameClaim(id) {
    if (downloading) return false;                         // не мешаем скачиванию видео
    if (watching) setWatching(false);
    if (hiding) unhide();
    closeDialog();
    gameActive = true; gameId = id || null; gameTargetX = px; gameRun = false; gameVy = 0; gameFloor = true; gameClimb = false;
    thrown = false; jumping = false; climbing = false; falling = false; vy = 0; vx = 0; testKind = null; running = false;
    pendingEmote = null; goEdgeUntil = 0;   // игра начинается с чистого листа: отложенная злость/намерение сесть на край не должны сработать посреди раунда
    pet.style.opacity = '1'; pet.style.pointerEvents = '';   // на случай, если прошлая игра прятала питомца
    setMode('idle');
    return true;
  }
  function gameRelease() {
    if (!gameActive) return;
    gameActive = false; gameId = null; running = false; gameClimb = false; gameFloor = true;   // ВАЖНО: сбросить gameClimb, иначе обычный платформер после игры полезет к старой цели
    pet.style.opacity = '1'; pet.style.pointerEvents = '';   // вернуть видимость/кликабельность (прятки могли спрятать)
    resetToWander();
  }
  function gameTick(t, dt) {
    if (gameClimb) {                                          // игра-платформер: лезет по полкам к точке (запрыгивает к высокому курсору)
      platformerTick(t, dt);
    } else if (jumping) {                                     // выполняем дугу баллистического прыжка (pet.hop -> стомп зомби)
      updateJump(t);
    } else if (gameFloor) {                                   // наземные игры: ведём к цели + гравитация к полу
      const floorY = window.innerHeight - PLAT_FLOOR - PET_H; // НЕмасштабированная высота: спрайт растёт ВВЕРХ от низа бокса (origin 50% 100%) -> ноги всегда на py+PET_H (как в платформере/watching)
      const sp = SPEED * userSpeed * (gameRun ? RUN_MUL : 1.6);
      const adx = gameTargetX - px;
      if (Math.abs(adx) > 3) { px += clamp(adx, -sp, sp); face = adx < 0 ? -1 : 1; running = gameRun; }
      else running = false;
      if (py < floorY) { gameVy = Math.min(gameVy + PLAT_GRAVITY, 26); py = Math.min(py + gameVy, floorY); }
      else { py = floorY; gameVy = 0; }
      px = clamp(px, 0, window.innerWidth - PET_W);
    } else { running = false; }                               // позицию ведёт сама игра через pet.place() (прятки)
    if (mode === 'happy' && t > happyUntil) setMode('idle');
    try { Yasia.events.emit('game:tick', { t, dt }); } catch (_) {}   // модуль игры обновляет сущности/цель/коллизии
  }
  // целенаправленное лазание к точке (gameClimbCx,gameClimbY) для игр: жадный прыжок вверх к ближайшей подходящей полке,
  // иначе просто идём по горизонтали к цели на текущем уровне. Своя (не watch*) логика — выверенный watchClimbDecide не трогаем.
  function gameClimbDecide(t) {
    if (!standLedge) return;
    const W = PET_W, cx = px + W / 2, goalCx = gameClimbCx, goalY = gameClimbY;
    const onLedgeX = goalCx >= standLedge.x1 - 4 && goalCx <= standLedge.x2 + 4;   // курсор по горизонтали над текущей полкой?
    const goalAbove = standLedge.y - goalY > 30;     // курсор заметно ВЫШЕ
    const goalBelow = goalY - standLedge.y > 30;     // курсор заметно НИЖЕ
    walkTargetX = clamp(goalCx - W / 2, standLedge.x1, standLedge.x2 - W);    // по умолчанию идём к курсору по X в пределах полки
    if (!goalAbove && !goalBelow && onLedgeX) return;                        // курсор на этом же уровне и над полкой -> просто дойдём пешком
    const minLedgeY = PET_H * Math.max(1, sizeMul * userScale);              // полки за верхом экрана — игнор
    const gd = (L) => Math.abs(clamp(goalCx, L.x1 + W / 2, L.x2 - W / 2) - goalCx) + Math.abs(L.y - goalY);   // близость полки к курсору (X+Y)
    let best = null, bestD = gd(standLedge) - 4;                             // прыгаем, только если так СТРОГО ближе к курсору (без дрожи)
    for (const L of ledges) {
      if (L === standLedge || L.y < minLedgeY) continue;
      if (!ledgeJumpable(standLedge, L)) continue;                           // достижимо прыжком вверх/вбок/ВНИЗ (вниз ledgeJumpable пускает далеко)
      const d = gd(L);
      if (d < bestD) { best = { L, c: clamp(goalCx, L.x1 + W / 2, L.x2 - W / 2) }; bestD = d; }
    }
    if (best) {
      const offC = clamp(best.c, standLedge.x1 + W / 2, standLedge.x2 - W / 2);
      if (Math.abs(cx - offC) > 8) { walkTargetX = clamp(offC - W / 2, standLedge.x1, standLedge.x2 - W); return; }   // дойти до точки отрыва -> прыгнуть
      startJump(best.L, best.c, t);
      return;
    }
    if (goalBelow || !onLedgeX) walkTargetX = goalCx - W / 2;                // прыжком не достать, а курсор ниже/в стороне -> шагнуть С КРАЯ к нему (платформер уронит на нижний уровень за краем)
  }

  // ---------- движение ----------
  function pickWanderTarget() {
    const m = 60;
    tx = m + Math.random() * (window.innerWidth - m * 2 - PET_W);
    ty = window.innerHeight * 0.55 + Math.random() * (window.innerHeight * 0.38 - PET_H);
    wanderUntil = now() + 1800 + Math.random() * 2800;
  }
  function setMode(m) {
    if (m === 'happy') happyKind = 'happy';   // ВСЕГДА сброс на подпрыг (даже если уже happy); приветствие выставит 'wave' сразу после
    if (mode === m) return;
    mode = m;
    pet.classList.toggle('is-walking', m === 'wander');
    pet.classList.toggle('is-happy', m === 'happy');
    bubble.classList.toggle('show', m === 'happy');
  }
  function resetToWander() { setMode('wander'); pickWanderTarget(); }

  // ОГНЕННАЯ форма на время скачивания: качается видео -> Яся замирает и горит, скачалось -> обычное состояние.
  function setDownloading(on) {
    downloading = on;
    pet.classList.toggle('is-fire', on && !!CAT_SETS.fire);   // огненное свечение только у героя с fire (у Noema — нет)
    catAct = null;                          // чистый переход кадра (fire <-> обычное)
  }
  function startDownloading() { if (dlHoldT) { clearTimeout(dlHoldT); dlHoldT = null; } setDownloading(true); }
  function stopDownloadingSoon(startedAt) {  // держим форму минимум FIRE_MIN_MS, чтобы её было видно даже на мгновенном скачивании
    const wait = Math.max(0, FIRE_MIN_MS - (now() - startedAt));
    if (dlHoldT) clearTimeout(dlHoldT);
    dlHoldT = setTimeout(() => { dlHoldT = null; setDownloading(false); }, wait);
  }

  // ---------- «СМОТРИТ ВИДЕО»: на странице играет видео -> Яся смотрит с попкорном ----------
  // Анимация берётся по appState='watching' из манифеста (data-driven). Детект события (видео играет) — это «КОГДА», логика.
  const watchAnim = () => { const a = ACTION_STATE.watching; return (a && CAT_SETS[a]) ? a : null; };   // null -> у героя нет такой анимации -> обычное поведение
  function playingVideo() {   // самое КРУПНОЕ играющее видео на странице (под него и садимся)
    const vids = document.getElementsByTagName('video');
    let best = null, bestArea = 0;
    for (let i = 0; i < vids.length; i++) {
      const v = vids[i];
      if (v.paused || v.ended || v.readyState <= 2 || !(v.currentTime > 0)) continue;
      const r = v.getBoundingClientRect();
      if (r.width < 80 || r.height < 60) continue;   // отсекаем пиксельные/трекинговые видео
      const area = r.width * r.height;
      if (area > bestArea) { bestArea = area; best = v; }
    }
    return best;
  }
  const anyVideoPlaying = () => !!playingVideo();
  function setWatching(on) { if (watching === on) return; watching = on; if (on) { if (testKind === 'run') { testKind = null; forceRunUntil = 0; running = false; walkTargetX = px; } } else { watchArrived = false; watchHelp = false; watchHelpSayT = 0; watchClimbing = false; watchStuck = false; watchStuckT = 0; watchVid = null; watchFromEl = null; watchPingT = 0; } catAct = null; }   // вкл -> отменяем живое превью «Бег» (не сосуществуют); выкл -> сбросить «дошла»/«лезет»/«просит подсадить»/цель/маршрут; catAct=null -> чистый переход кадра
  let watchRecheckT = null, watchOffT = null;
  function refreshWatching() {   // дебаунс + ГИСТЕРЕЗИС: вкл сразу, выкл с задержкой (буферизация видео не должна сгонять её с места)
    if (watchRecheckT) return;
    watchRecheckT = setTimeout(() => {
      watchRecheckT = null;
      const realPlaying = anyVideoPlaying();
      if (!realPlaying) watchDismissed = false;   // видео встало -> снимаем «прогнали» (новый запуск снова заинтересует)
      const playing = (realPlaying && !watchDismissed) || now() < watchTestUntil;   // прогнали от видео -> не подходим, пока это видео не остановится
      if (playing) { if (Yasia.guard && !Yasia.guard.allows('watch') && now() >= watchTestUntil) return; if (watchOffT) { clearTimeout(watchOffT); watchOffT = null; } setWatching(true); }   // рабочий/безопасный режим: сама к видео не бежит (ручной тест — можно)
      else if (watching && !watchOffT) { watchOffT = setTimeout(() => { watchOffT = null; setWatching(false); }, 1400); }   // видео встало -> уходит не сразу
    }, 120);
  }
  ['play', 'playing', 'pause', 'ended', 'emptied', 'waiting'].forEach((ev) => document.addEventListener(ev, refreshWatching, true));
  setInterval(refreshWatching, 1500);   // страховка: автоплей/SPA-навигация (если событие не поймали)

  // частицы попкорна: вылетают вбок из ведёрка, падают на пол, лежат ~2с, тают
  const POPCORN_EVERY = 950, POPCORN_SZ = 22;
  function spawnKernel() {
    let url = ''; try { url = chrome.runtime.getURL('src/items/popcorn.png'); } catch (_) {}
    if (!url) return;
    const k = document.createElement('img'); k.className = 'twtr-popcorn-k'; k.src = url; k.alt = '';
    const sx = clamp(px + PET_W / 2 - POPCORN_SZ / 2, 0, window.innerWidth - POPCORN_SZ);
    const sy = py + PET_H * 0.35;                                  // ~уровень ведёрка
    k.style.left = sx + 'px'; k.style.top = sy + 'px';
    root.appendChild(k);
    const dir = Math.random() < 0.5 ? -1 : 1;                      // влево/вправо
    const dx = dir * (50 + Math.random() * 110);
    const upH = 50 + Math.random() * 50;
    const floorDY = (py + PET_H - POPCORN_SZ * 0.4) - sy;          // «пол» = уровень её ног (лежат у неё под видео, а не на дне экрана)
    const spin = Math.round(Math.random() * 540 - 270);
    requestAnimationFrame(() => { k.style.transform = `translate(${Math.round(dx * 0.55)}px, ${-Math.round(upH)}px) rotate(${Math.round(spin / 2)}deg)`; });   // подлёт вверх-вбок
    setTimeout(() => { k.style.transition = 'transform .5s cubic-bezier(.6,0,.9,.4)'; k.style.transform = `translate(${Math.round(dx)}px, ${Math.round(floorDY)}px) rotate(${spin}deg)`; }, 300);   // падение на пол
    setTimeout(() => { k.style.transition = 'opacity .45s ease'; k.style.opacity = '0'; }, 2800);   // полежал ~2с -> тает
    setTimeout(() => k.remove(), 3300);
  }
  function popcornTick(t) {   // поток зёрнышек, пока Яся смотрит видео
    if (!(watching && watchAnim() && watchArrived) || document.hidden || dialog.classList.contains('show')) return;   // только когда уже села под видео
    if (t - lastPopcornT > POPCORN_EVERY) { lastPopcornT = t; spawnKernel(); }
  }
  // рисованные значки частиц (SVG — рендерятся одинаково в любом Chrome, не зависят от эмодзи-шрифта, который у части систем пустой/обрезан)
  const HEART_SVG = '<svg viewBox="0 0 24 22" width="100%" height="100%"><path d="M12 21C12 21 1.5 13.6 1.5 6.9 1.5 3.6 4 1.5 6.8 1.5 8.9 1.5 10.9 2.7 12 4.7 13.1 2.7 15.1 1.5 17.2 1.5 20 1.5 22.5 3.6 22.5 6.9 22.5 13.6 12 21 12 21Z" fill="#ff4d6d" stroke="#c9184a" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  const BONE_SVG = '<svg viewBox="0 0 34 20" width="100%" height="100%"><g fill="#f4eeda" stroke="#b7a271" stroke-width="1.6"><rect x="7" y="6.5" width="20" height="7" rx="3"/><circle cx="7" cy="6" r="4.6"/><circle cx="7" cy="14" r="4.6"/><circle cx="27" cy="6" r="4.6"/><circle cx="27" cy="14" r="4.6"/></g></svg>';
  // сердечко: вылетает вбок-вверх и опадает как попкорн (разлёт + мягкое падение), пока играет ласка/гордость
  function spawnHeart() {
    const h = document.createElement('div'); h.className = 'twtr-pet-heart'; h.innerHTML = HEART_SVG;
    const s = sizeMul * userScale;
    const headTop = py + PET_H - PET_H * s;                        // визуальная макушка (спрайт растёт вверх от низа бокса на масштаб)
    const sz = 16 + Math.random() * 10; h.style.width = h.style.height = sz.toFixed(0) + 'px';
    const sx = clamp(px + PET_W / 2 - sz / 2, 0, window.innerWidth - sz);
    const sy = clamp(headTop + PET_H * 0.15, 0, window.innerHeight - sz);
    h.style.left = sx + 'px'; h.style.top = sy + 'px'; h.style.opacity = '1';
    root.appendChild(h);
    const dir = Math.random() < 0.5 ? -1 : 1;
    const dx = dir * (26 + Math.random() * 54), upH = 34 + Math.random() * 34, rot = Math.round(Math.random() * 50 - 25);
    const fallDY = 26 + Math.random() * 30;                        // опадает после подлёта (как попкорн, но мягче — сердечки лёгкие)
    requestAnimationFrame(() => { h.style.transform = `translate(${Math.round(dx * 0.5)}px, ${-upH.toFixed(0)}px) rotate(${rot}deg)`; });   // разлёт вбок-вверх
    setTimeout(() => { h.style.transition = 'transform .7s cubic-bezier(.5,0,.7,.5), opacity .7s ease'; h.style.transform = `translate(${Math.round(dx)}px, ${Math.round(fallDY)}px) rotate(${rot * 2}deg)`; h.style.opacity = '0'; }, 340);   // опадает и тает
    setTimeout(() => h.remove(), 1150);
  }
  let lastHeartT = 0;
  function heartTick(t) {   // поток сердечек, пока активна эмоция ласки/гордости (мур/like_proud) — данные, а не таймер: привязан к проигрываемой эмоции
    if (document.hidden || dragging || paused) return;
    const emo = (testKind === 'emo' && t < testUntil) ? testEmo : null;
    if (emo !== 'pet_purr' && emo !== 'like_proud') return;
    if (t - lastHeartT > 300) { lastHeartT = t; spawnHeart(); }
  }
  // обглоданная кость: в конце еды Яся выбрасывает её НАЗАД (против взгляда); падает на пол и лежит как попкорн, пока не растает
  function throwBone() {
    const b = document.createElement('div'); b.className = 'twtr-pet-bone'; b.innerHTML = BONE_SVG;
    const sz = 26; b.style.width = sz + 'px'; b.style.height = (sz * 0.6).toFixed(0) + 'px';
    const startX = clamp(px + PET_W / 2 - sz / 2, 0, window.innerWidth - sz), startY = py + PET_H * 0.4;
    b.style.left = startX + 'px'; b.style.top = startY + 'px';
    root.appendChild(b);
    const back = -face;                                            // назад = против направления взгляда
    const floorY = window.innerHeight - PLAT_FLOOR - 16;           // ложится на пол страницы
    const dx = back * (60 + Math.random() * 70), spin = Math.round(Math.random() * 500 - 250);
    requestAnimationFrame(() => { b.style.transform = `translate(${Math.round(dx * 0.5)}px, -${40 + Math.round(Math.random() * 24)}px) rotate(${Math.round(spin / 2)}deg)`; });   // подлёт назад-вверх
    setTimeout(() => { b.style.transition = 'transform .5s cubic-bezier(.6,0,.9,.4)'; b.style.transform = `translate(${Math.round(dx)}px, ${Math.round(floorY - startY)}px) rotate(${spin}deg)`; }, 320);   // падение на пол
    setTimeout(() => { b.style.transition = 'opacity .7s ease'; b.style.opacity = '0'; }, 5200);   // полежала подольше попкорна (кости накапливаются) -> тает
    setTimeout(() => b.remove(), 6000);
  }
  // фразы (англ.): просит подсадить наверх, когда видео в ленте и до него не допрыгнуть
  const HELP_CALLS = ['Help me up!', 'Lift me up there!', 'Boost me up!', "I can't reach… help?", 'Pull me up to watch!', 'Gimme a lift!'];
  // фразы (англ.): злится, когда её утащили от фильма
  const MAD_CALLS = ['Hey! I was watching!', "I wasn't done!", 'Rude! Put me back!', 'My movie! 😾', 'Hmph! 😠'];
  // фразы (ру+англ.): плеер YouTube ещё не прогрузил поток -> просит дать ролику поиграть и повторить
  const YT_BUFFER_CALLS = [
    'Дай ролику поиграть немного — я подгружу плеер 🎬 · Play it a bit so I can load the player',
    'Плеер ещё грузится! Посмотри видео пару минут и жми снова 🍿 · Player still loading — watch a bit, then hit it again',
    'Чуть проиграй видео со звуком, чтобы я поймала поток 🎬 · Let it play with sound so I can grab the stream',
  ];

  // ---------- опыт ----------
  function gainXp(amount) {
    xp += amount;
    Yasia.storage.localSet({ xp });   // левелап покажет onChanged (единый путь)
  }
  function levelUp() {
    bubble.textContent = '⭐ ' + tr().lvl + level;
    bubble.classList.add('show');
    if (CAT_SETS.levelup) playEmote('levelup', 2400);   // фанфары из манифеста (спрайт есть -> салют звёзд), иначе прежний подпрыг
    else { setMode('happy'); happyUntil = now() + 1200; }
    spawnParticles('#ffd34d', 14);
    Yasia.events.emit('levelup', { level });   // шина событий: подписчики появятся при выносе систем
  }

  // ---------- пакости (визуальные) ----------
  function maybeMischief(t) {
    if (Yasia.guard && !Yasia.guard.allows('mischief')) return;   // режимы (страж): пакости только в обычном
    if (busy || gameActive || t < nextMischief || isTyping() || dialogOpen() || thrown || jumping || falling || dragging) return;   // не пакостим во время активной физики (бросок/прыжок/падение) — busy заморозил бы полёт
    const wild = currentWildness();
    const iv = (Yasia.behavior && Yasia.behavior.mischiefIntervalMs) ? Yasia.behavior.mischiefIntervalMs(wild, WILD) : 20000;
    if (!iv) { nextMischief = t + 8000; return; }                 // смирная (дикость ниже порога) -> не пакостит, перепроверим позже
    nextMischief = t + iv + Math.random() * iv * 0.3;            // дикость задаёт интервал (+джиттер)
    glassCrack();
  }
  function crackSVG() {
    const cx = 60, cy = 60, n = 8; let lines = '';
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i / n) + (Math.random() * 0.5 - 0.25), len = 36 + Math.random() * 18;
      const mx = cx + Math.cos(a) * len * 0.5 + (Math.random() * 8 - 4), my = cy + Math.sin(a) * len * 0.5 + (Math.random() * 8 - 4);
      const ex = cx + Math.cos(a) * len, ey = cy + Math.sin(a) * len;
      lines += `<polyline points="${cx},${cy} ${mx.toFixed(1)},${my.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}"/>`;
    }
    let ring = '';
    for (const rad of [16, 28]) { let pts = ''; for (let i = 0; i <= n; i++) { const a = Math.PI * 2 * i / n, rr = rad + (Math.random() * 6 - 3); pts += `${(cx + Math.cos(a) * rr).toFixed(1)},${(cy + Math.sin(a) * rr).toFixed(1)} `; } ring += `<polyline points="${pts.trim()}"/>`; }
    return `<svg viewBox="0 0 120 120" width="120" height="120"><g fill="none" stroke="#fff" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round">${lines}${ring}</g><g fill="none" stroke="rgba(120,170,255,.75)" stroke-width="0.9">${lines}</g></svg>`;
  }
  function glassCrack() {
    busy = true; setMode('happy'); happyUntil = now() + 600;
    const size = 120, cx = clamp(px + PET_W / 2, 70, window.innerWidth - 70), cy = clamp(py, 80, window.innerHeight - 80);
    const el = document.createElement('div'); el.className = 'twtr-pet-crack';
    el.style.left = (cx - size / 2) + 'px'; el.style.top = (cy - size / 2) + 'px'; el.innerHTML = crackSVG();
    root.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => el.classList.add('fade'), 1900);
    setTimeout(() => { el.remove(); busy = false; setMode('wander'); }, 2700);
  }

  // ---------- кормление ----------
  // еда КАК АНИМАЦИЯ: ровно 2 полных цикла кадров; КАЖДЫЙ раз, когда цикл доходит до последнего кадра
  // (облизывается с голой косточкой), вылетает кость — съела ножку -> кость, и так на каждом круге.
  // Единственный вход для всех путей (кормление, попап, тест-сетка).
  function playEatCycle() {
    if (thrown || falling || jumping) { pendingEmote = { emo: 'eat', ms: 0 }; return 0; }   // в полёте — отложим ЦЕЛИКОМ (иначе кость вылетит без еды)
    const fMs = (emoMs('eat') || 200) / userSpeed;                  // длительность одного кадра (с учётом ползунка скорости)
    const cycleMs = Math.round(CAT_SETS.eat.length * fMs);          // один полный круг кадров
    const CYCLES = 2;
    playEmote('eat', cycleMs * CYCLES);                             // busy не ставим: он замораживает ВЕСЬ tick (кадры бы не листались); неподвижность даёт testKind='emo'
    for (let i = 1; i <= CYCLES; i++) setTimeout(throwBone, i * cycleMs - Math.round(fMs / 2));   // кость — ПОКА показан кадр с косточкой, в конце КАЖДОГО круга
    return cycleMs * CYCLES;
  }
  function feedEat() {
    if (CAT_SETS.eat) {   // полноценная анимация еды из манифеста: ножка уже В КАДРАХ (eat0…) — летящая картинка мяса не нужна, ест сразу
      const eatMs = playEatCycle();
      bubble.textContent = '😋'; bubble.classList.add('show');
      setTimeout(() => { bubble.classList.remove('show'); setMode('wander'); }, (eatMs || 2400) + 600);
      return;
    }
    busy = true;
    // фолбэк без eat-кадров (крипер): мясо прилетает снизу + chomp
    const meat = document.createElement('img');
    try { meat.src = chrome.runtime.getURL('src/items/meat.png'); } catch (_) {}
    meat.className = 'twtr-pet-meat';
    const startX = px + PET_W / 2 - 18, startY = window.innerHeight - 30;
    meat.style.left = startX + 'px'; meat.style.top = startY + 'px';
    root.appendChild(meat);
    requestAnimationFrame(() => { meat.style.transform = `translate(${(px + PET_W / 2 - 18) - startX}px, ${(py + 8) - startY}px) scale(1)`; });
    setTimeout(() => { setMode('happy'); happyUntil = now() + 900; bubble.textContent = '😋'; pet.classList.add('is-chomp'); }, 520);
    setTimeout(() => { meat.remove(); pet.classList.remove('is-chomp'); }, 950);
    setTimeout(() => { busy = false; setMode('wander'); }, 1200);
  }

  // ---------- частицы (поощрение в играх и заботе) ----------
  function spawnParticles(color, count) {
    const cx = px + PET_W / 2, cy = py + PET_H / 2;
    for (let i = 0; i < count; i++) {
      const p = document.createElement('div'); p.className = 'twtr-particle';
      p.style.background = color; p.style.left = cx + 'px'; p.style.top = cy + 'px';
      const ang = Math.random() * Math.PI * 2, dist = 40 + Math.random() * 70;
      root.appendChild(p);
      requestAnimationFrame(() => { p.style.transform = `translate(${Math.cos(ang) * dist}px, ${Math.sin(ang) * dist}px) scale(.3)`; p.style.opacity = '0'; });
      setTimeout(() => p.remove(), 650);
    }
  }
  // ---------- перетаскивание мышкой ----------
  pet.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    dragging = true; didDrag = false; thrown = false;
    dragOffX = mouseX - px; dragOffY = mouseY - py;
    grabPx = px; grabPy = py;
    dragVx = 0; dragVy = 0; peakVx = 0; peakVy = 0; lastDragX = px; lastDragY = py;   // начинаем мерить скорость «кисти»
    pet.classList.add('is-grabbed');               // взяли «за шкирку» — болтается
    pet.classList.remove('is-moving');
    if (isFramed()) showFrame('idle');  // замираем на кадре
    e.preventDefault(); e.stopPropagation();
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false; pet.classList.remove('is-grabbed'); jumping = false;
    standLedge = null;                                   // оторвали от опоры — летит/падает
    if (paused) { thrown = false; vx = 0; vy = 0; saveState(); return; }   // пауза: просто переставили на новое место, без инерции (иначе зависнет в воздухе — ветка paused не зовёт физику)
    const power = throwMul;                              // 0..2 (ползунок «Инерция» 0..200%)
    const gain = power <= 1 ? power : 1 + (power - 1) * 9;   // нелинейно: 0%->0, 100%->×1, 200%->×10 (на максе лёгкий толчок отшвыривает)
    const vmax = 34 + 58 * power;                        // ПОТОЛОК скорости растёт с инерцией (34..150); раньше фикс ±38 «съедал» разницу
    const bvx = Math.abs(peakVx) > Math.abs(dragVx) ? peakVx : dragVx;   // берём пик «кисти», а не сглаженный хвост
    const bvy = Math.abs(peakVy) > Math.abs(dragVy) ? peakVy : dragVy;
    vx = clamp(bvx * gain, -vmax, vmax);                 // инерция броска: горизонталь
    vy = clamp(bvy * gain, -vmax, 24 + 28 * power);      // вертикаль (вверх можно сильно подкинуть)
    thrown = (Math.abs(vx) > 3 || Math.abs(vy) > 3);     // реальный бросок -> летит по инерции; мягко поставили/подсадили (скорость ~0) -> не бросок (на видео-странице watching доведёт под видео)
    if (pendingMad) { pendingMad = false; pendingEmote = { emo: 'angry', ms: 3000, line: pick(MAD_CALLS), sayMs: 1900 }; }   // забрали от кино -> ЗЛИТСЯ, но ПОСЛЕ приземления: физика решит на ближайшем тике, стоит она или летит (на земле сыграет сразу, ~1 кадр)
    saveState();
  });

  // ---------- поглаживание мышью ----------
  // водишь курсором по питомцу (не таща) — накапливается «глажка»; STROKE_DIST px = одно «погладить».
  // careAction('pet') сам держит кулдаун ACT_COOLDOWN_MS, так что спам движений не накручивает статы.
  let strokeAcc = 0, strokeLX = 0, strokeLY = 0, strokeLastT = 0;
  pet.addEventListener('mousemove', (e) => {
    if (dragging || thrown || busy || gameActive || downloading || watching || hiding) return;   // сидящую у кино/спрятанную случайной мышью не дёргаем
    const t = now();
    if (t - strokeLastT > 600) strokeAcc = 0;            // пауза в движении — глажка начинается заново
    else strokeAcc += Math.hypot(e.clientX - strokeLX, e.clientY - strokeLY);
    strokeLastT = t; strokeLX = e.clientX; strokeLY = e.clientY;
    if (strokeAcc >= (STROKE_DIST || 260)) { strokeAcc = 0; careAction('pet'); }
  });

  // ---------- меню настроек (размер) ----------
  function applyScale() { if (scaleVal) scaleVal.textContent = Math.round(userScale * 100) + '%'; render(); }
  function applySpeed() { const p = Math.round(userSpeed * 100); if (speedVal) speedVal.textContent = p + '%'; if (speedRange) speedRange.value = p; }
  if (speedRange) {
    speedRange.addEventListener('input', (e) => { e.stopPropagation(); userSpeed = (+speedRange.value) / 100; applySpeed(); Yasia.storage.syncSet({ walkSpeed: userSpeed }); });
    speedRange.addEventListener('mousedown', (e) => e.stopPropagation());
    speedRange.addEventListener('click', (e) => e.stopPropagation());
  }
  function applyInertia() { const p = Math.round(throwMul * 100); if (inertiaVal) inertiaVal.textContent = p + '%'; if (inertiaRange) inertiaRange.value = p; }
  if (inertiaRange) {
    inertiaRange.addEventListener('input', (e) => { e.stopPropagation(); throwMul = (+inertiaRange.value) / 100; applyInertia(); Yasia.storage.syncSet({ throwPower: throwMul }); });
    inertiaRange.addEventListener('mousedown', (e) => e.stopPropagation());
    inertiaRange.addEventListener('click', (e) => e.stopPropagation());
  }
  settingsBtn.addEventListener('click', (e) => { e.stopPropagation(); settingsPanel.classList.toggle('show'); });
  settingsPanel.addEventListener('click', (e) => {
    const tb = e.target.closest('[data-test]'); if (tb) { e.stopPropagation(); startTest(tb.dataset.test); return; }
    const b = e.target.closest('[data-act]'); if (!b) return; e.stopPropagation();
    if (b.dataset.act === 'inc') userScale = Math.min(4.8, +(userScale + 0.2).toFixed(2));   // до 2× от прежнего максимума
    if (b.dataset.act === 'dec') userScale = Math.max(0.6, +(userScale - 0.2).toFixed(2));
    applyScale();
    Yasia.storage.syncSet({ scale: userScale });
  });
  function applyRoam() {
    roamSw.classList.toggle('on', roam);
    roamSw.setAttribute('aria-checked', roam ? 'true' : 'false');
    if (!roam) { running = false; jumping = false; pet.classList.remove('is-jump'); if (mode !== 'happy') setMode('idle'); }
    else { standLedge = null; vy = 0; jumping = false; nextJumpDecide = 0; if (mode === 'idle') setMode('wander'); }
  }
  roamSw.addEventListener('click', (e) => {
    e.stopPropagation(); roam = !roam; applyRoam();
    Yasia.storage.syncSet({ roam });
  });
  function applyPaused() {   // ⏸ пауза (тумблер в попапе): замереть на месте, не пряча; статы wall-clock идут дальше
    if (paused) {
      if (gameActive) { try { Yasia.events.emit('game:stop'); } catch (_) {} }   // игру честно завершаем (иначе зомби/мясо зависнут на экране)
      running = false; jumping = false; climbing = false; falling = false; thrown = false; vx = 0; vy = 0;
      pendingEmote = null; goEdgeUntil = 0;   // пауза гасит отложенную эмоцию и намерение сесть на край
      pet.classList.remove('is-moving', 'is-jump');
      if (mode !== 'happy') setMode('idle');
    } else {
      standLedge = null; nextJumpDecide = 0;             // опору переоценит платформер
      if (roam && mode === 'idle') setMode('wander');
    }
  }

  // эмоции для подписи в облачке. DEFAULT_EMOS = фолбэк, если манифест не загрузился; applyManifest перестраивает из манифеста.
  const EMO_EXTRA = [   // не-эмоции, но тоже тест-кнопки emo:<key> с подписью (движение, проигрываемое как «эмоция» в тесте)
    { key: 'fall', emo: '😱', name: 'Падение' },
    { key: 'run',  emo: '🏃', name: 'Бег' },
  ];
  const DEFAULT_EMOS = [
    { key: 'happy',  icon: '😺', label: 'Радость' },
    { key: 'sad',    icon: '😿', label: 'Грусть' },
    { key: 'angry',  icon: '😠', label: 'Злость' },
    { key: 'dizzy',  icon: '💫', label: 'Голова' },
    { key: 'hungry', icon: '🍖', label: 'Голод' },
    { key: 'sleep',  icon: '😴', label: 'Сон' },
  ];
  let EMOTIONS = DEFAULT_EMOS.map((e) => ({ key: e.key, emo: e.icon, name: e.label })).concat(EMO_EXTRA);
  document.addEventListener('click', (e) => {                 // клик вне меню — закрыть
    if (settingsPanel.classList.contains('show') && !settingsPanel.contains(e.target) && e.target !== settingsBtn) settingsPanel.classList.remove('show');
  });

  // ---------- диалоговое окно: заметки + скачивание видео СО СТРАНИЦЫ ----------
  // Перехваченные прямые mp4-URL прилетают из src/injected.js (мир страницы) только на 4 площадках.
  const capturedMedia = [];
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || !e.data.__yasiaMedia) return;
    const m = e.data.__yasiaMedia;
    if (!m.url || !/^https?:/.test(m.url)) return;
    const ex = capturedMedia.find((c) => c.url === m.url);
    if (ex) { if ((m.bitrate || 0) > (ex.bitrate || 0)) ex.bitrate = m.bitrate; if (!ex.tweetId && m.tweetId) ex.tweetId = m.tweetId; if (!ex.cover && m.cover) ex.cover = m.cover; } // примиряем id/обложку при коллизии URL
    else { capturedMedia.push(m); if (capturedMedia.length > 60) capturedMedia.shift(); }
  });

  // спросить у injected.js (мир страницы) активный ролик TikTok-ленты прямо из React-данных страницы
  let __yasiaReqSeq = 0;
  function requestActiveTikTok() {
    return new Promise((resolve) => {
      const reqId = ++__yasiaReqSeq; let done = false;
      const cleanup = () => { clearTimeout(t); window.removeEventListener('message', onMsg); };
      const onMsg = (e) => {
        if (e.source !== window || !e.data || !e.data.__yasiaActive) return;
        const a = e.data.__yasiaActive; if (a.reqId !== reqId || done) return;
        done = true; cleanup(); resolve(a && a.url ? a : null);
      };
      const t = setTimeout(() => { if (!done) { done = true; cleanup(); resolve(null); } }, 700);
      window.addEventListener('message', onMsg);
      try { window.postMessage({ __yasiaActiveReq: reqId }, '*'); } catch (_) { done = true; cleanup(); resolve(null); }
    });
  }

  function detectPlatform() {
    const h = location.hostname;
    if (/(^|\.)tiktok\.com$/.test(h)) return 'tiktok';
    if (/(^|\.)(twitter|x)\.com$/.test(h)) return 'twitter';
    if (/(^|\.)instagram\.com$/.test(h)) return 'instagram';
    if (/(^|\.)(youtube\.com|youtu\.be)$/.test(h)) return 'youtube';
    return 'generic';
  }
  function nameFromUrl(u) { try { const p = new URL(u).pathname.split('/').pop().split('?')[0]; return /\.(mp4|webm|mov)$/i.test(p) ? p : (p || 'video') + '.mp4'; } catch (_) { return 'video.mp4'; } }

  // ---------- активный ролик ленты (общее для TikTok/Instagram) ----------
  // В ленте <video>.src — это blob:/MediaSource, реальной ссылки на mp4 на элементе НЕТ. Поэтому по элементу
  // только определяем, КАКОЙ ролик активен (id/обложка), и матчим к пойманному по сети JSON.
  function activeFeedVideo() {
    const cy = window.innerHeight / 2;
    const cands = [];
    document.querySelectorAll('video').forEach((vid) => {
      const r = vid.getBoundingClientRect();
      if (r.width < 80 || r.height < 80) return;                 // не аватарки/иконки
      const vh = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0); // видимая высота во вьюпорте
      if (vh <= 0) return;                                       // вне экрана
      cands.push({ vid, vh, center: (r.top + r.bottom) / 2, brackets: r.top <= cy && r.bottom >= cy, playing: !vid.paused && vid.readyState >= 2 });
    });
    let pool = cands.filter((c) => c.brackets);                  // рамка содержит центр экрана
    if (!pool.length) pool = cands;
    pool.sort((a, b) => (b.playing - a.playing) || (b.vh - a.vh) || (Math.abs(a.center - cy) - Math.abs(b.center - cy)));
    return pool[0] ? pool[0].vid : null;
  }
  // ключ обложки: самый длинный сегмент пути (объект-хэш) без resize-трансформа ~tplv и без query —
  // одна обложка приходит с разными x-expires/x-signature, поэтому сравниваем только стабильную часть.
  function coverKey(u) {
    if (!u || typeof u !== 'string') return null;
    let path;
    try { path = new URL(u, location.href).pathname; } catch (_) { path = u.split('?')[0]; }
    let best = '';
    for (const s of path.split('/')) { const seg = s.split('~')[0]; if (seg.length > best.length) best = seg; }
    return best || path || null;
  }
  // обложки рядом с активным видео: poster + <img> в контейнере (равны cover из API)
  function activeVideoCovers(vid) {
    const out = [];
    if (!vid) return out;
    const p = vid.getAttribute('poster') || vid.poster; if (p && /^https?:/.test(p)) out.push(p);
    let node = vid;
    for (let i = 0; i < 6 && node; i++) { if (node.querySelectorAll) node.querySelectorAll('img[src^="http"]').forEach((im) => { if (im.src) out.push(im.src); }); node = node.parentElement; }
    return out;
  }
  // пойманное медиа, чья обложка совпала с активным видео (самопроверяющийся матч: чужая картинка не совпадёт)
  function matchCaptured(vid, kind) {
    const keys = new Set(activeVideoCovers(vid).map(coverKey).filter(Boolean));
    if (!keys.size) return null;
    const cap = capturedMedia.filter((c) => c.kind === kind && c.cover && keys.has(coverKey(c.cover)));
    if (!cap.length) return null;
    return cap.slice().sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
  }

  // TikTok — качаем ИМЕННО активный ролик ленты, playAddr БЕЗ вотермарки.
  const TT_REF = 'https://www.tiktok.com/';
  // id активного ролика: id самого <video> (xgwrapper-N-<awemeId>) -> ссылка /video|photo/<id> в карточке
  // ссылка на ролик в пределах ОДНОЙ карточки -> id из href. Поднимаемся, пока предок не крупнее карточки;
  // при нескольких ссылках берём ту, что вертикально пересекается с видео (иначе можно зацепить соседний ролик).
  function linkIdNearVideo(vid, selector, re) {
    if (!vid || !vid.getBoundingClientRect) return null;
    const vr = vid.getBoundingClientRect();
    const cap = Math.max(vr.height * 1.6, window.innerHeight * 0.95);
    let p = vid.parentElement, scope = vid.parentElement || vid;
    for (let i = 0; i < 6 && p; i++) { const pr = p.getBoundingClientRect(); if (pr.height > cap) break; scope = p; p = p.parentElement; }
    const matches = [];
    if (scope.querySelectorAll) scope.querySelectorAll(selector).forEach((a) => { const m = (a.getAttribute('href') || '').match(re); if (m) matches.push({ id: m[1], a }); });
    if (!matches.length) return null;
    if (matches.length === 1) return matches[0].id;            // в карточке одна ссылка на ролик — она и есть
    let bestId = null, bestOv = -Infinity;
    for (const mt of matches) { const ar = mt.a.getBoundingClientRect(); const ov = Math.min(ar.bottom, vr.bottom) - Math.max(ar.top, vr.top); if (ov > bestOv) { bestOv = ov; bestId = mt.id; } }
    return bestOv > 0 ? bestId : null;                         // нет ссылки, пересекающейся с видео -> лучше null (сработает матч по обложке)
  }
  function ttIdFromVideo(vid) {
    if (!vid) return null;
    const mid = (vid.id || '').match(/xgwrapper-\d+-(\d+)/); if (mid) return mid[1];   // id самого элемента — не уплывает на соседа
    return linkIdNearVideo(vid, 'a[href*="/video/"], a[href*="/photo/"]', /\/(?:video|photo)\/(\d+)/);
  }
  function bestTikTokUrl(v) {
    let url = Array.isArray(v.playAddr) ? v.playAddr[0] : v.playAddr;
    if (Array.isArray(v.bitrateInfo) && v.bitrateInfo.length) {
      const best = v.bitrateInfo.slice().sort((a, b) => (b.Bitrate || 0) - (a.Bitrate || 0))[0];
      const u = best && best.PlayAddr && best.PlayAddr.UrlList && best.PlayAddr.UrlList[0];
      if (u) url = u;
    }
    return url || null;
  }
  function readTikTokSSR() {                                      // встроенный JSON (есть на детальной странице ролика)
    const el = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
    if (el) { try {
      const scope = (JSON.parse(el.textContent) || {}).__DEFAULT_SCOPE__ || {};
      const vd = scope['webapp.video-detail'];
      let item = vd && vd.itemInfo && vd.itemInfo.itemStruct;
      if (!item) for (const k in scope) { const v = scope[k]; if (v && v.itemInfo && v.itemInfo.itemStruct) { item = v.itemInfo.itemStruct; break; } }
      if (item) return item;
    } catch (_) {} }
    const sigi = document.getElementById('SIGI_STATE');
    if (sigi) { try { const s = JSON.parse(sigi.textContent); const id = Object.keys(s.ItemModule || {})[0]; if (id) return s.ItemModule[id]; } catch (_) {} }
    return null;
  }
  function ttResult(url, item, focal) {
    const user = ((item && item.author && item.author.uniqueId) || 'tiktok').replace(/[^\w.-]/g, '_');
    return { url, filename: `tiktok_${user}_${(item && item.id) || focal || Date.now()}.mp4`, referer: TT_REF };
  }
  async function extractTikTok() {
    const vid = activeFeedVideo();
    const onDetail = /\/(?:video|photo)\/\d+/.test(location.pathname);
    let focal = ttIdFromVideo(vid);
    if (!focal && onDetail) focal = (location.pathname.match(/\/(?:video|photo)\/(\d+)/) || [])[1];
    // 0) АКТИВНЫЙ ролик прямо из React-данных страницы (через injected.js) — единственный источник, который
    //    называет ролик в ленте «Рекомендации» (где id нет ни в URL, ни в DOM). Доверяем, если не противоречит focal.
    const act = await requestActiveTikTok();
    if (act && act.url && act.id && (!focal || String(focal) === String(act.id))) {
      const user = (act.author || 'tiktok').replace(/[^\w.-]/g, '_');
      return { url: act.url, filename: `tiktok_${user}_${act.id}.mp4`, referer: TT_REF };
    }
    // 1) детальная: встроенный JSON — самый точный (если это и есть активный ролик)
    if (onDetail) { const ssr = readTikTokSSR(); if (ssr && ssr.video && (!focal || String(ssr.id) === String(focal))) { const u = bestTikTokUrl(ssr.video); if (u) return ttResult(u, ssr, focal); } }
    // 2) знаем id активного ролика -> точный матч в пойманном по сети
    if (focal) { const cap = capturedMedia.filter((c) => c.kind === 'tiktok' && String(c.tweetId) === String(focal)); if (cap.length) { const b = cap.slice().sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0]; return { url: b.url, filename: `tiktok_${focal}.mp4`, referer: TT_REF }; } }
    // 3) подтверждение по обложке активного видео — самопроверка (приоритет над сетевым фетчем по id)
    const byCover = matchCaptured(vid, 'tiktok'); if (byCover) return { url: byCover.url, filename: `tiktok_${byCover.tweetId || focal || Date.now()}.mp4`, referer: TT_REF };
    // 3.5) id известен, но не пойман и обложка не совпала -> тянем SSR по этому id (как по ссылке) — АВТО без копирования
    if (focal) { const m = await ttByLink({ id: focal }); if (m) return m; }
    // 4) детальная без фокуса — SSR как есть
    if (onDetail) { const ssr = readTikTokSSR(); if (ssr && ssr.video) { const u = bestTikTokUrl(ssr.video); if (u) return ttResult(u, ssr, focal); } }
    // 5) знаем активный ролик, но его mp4 не пойман -> честно «не найдено»
    return pickCapturedTikTok(focal);
  }
  function pickCapturedTikTok(focal) {
    const c = capturedMedia.filter((x) => x.kind === 'tiktok' || /tiktokcdn/.test(x.url));
    // ТОЛЬКО если пойман РОВНО один ролик — он однозначен. Иначе НЕ угадываем (раньше брали последний пойманный
    // = случайный из ленты, отсюда «качает рандом»). Несколько кандидатов -> честно «не найдено», пусть юзер даст ссылку.
    if (c.length === 1) return { url: c[0].url, filename: `tiktok_${focal || c[0].tweetId || Date.now()}.mp4`, referer: TT_REF };
    return null;
  }

  // Twitter/X — сперва перехваченные варианты, затем публичный syndication-эндпоинт (токен из id, как yt-dlp/cobalt)
  function tweetFilename(id) { const m = location.pathname.match(/\/([^/]+)\/status\/(\d+)/); return `x_${(m && m[1]) || 'video'}_${id || (m && m[2]) || Date.now()}.mp4`; }
  async function extractTwitter() {
    const id = (location.pathname.match(/\/status\/(\d+)/) || [])[1];
    // 1) syndication по ТОЧНОМУ id твита — всегда именно этот ролик (через background, иначе CORS)
    if (id) { try {
      const tok = ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
      const res = await chrome.runtime.sendMessage({ type: 'YASIA_FETCH', url: `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${tok}&lang=en` });
      if (res && res.ok && res.text) {
        const j = JSON.parse(res.text);
        const md = j.mediaDetails || (j.video ? [j] : []);
        let variants = [];
        (md || []).forEach((mm) => { if (mm.video_info && Array.isArray(mm.video_info.variants)) variants = variants.concat(mm.video_info.variants); });
        const best = variants.filter((x) => x.content_type === 'video/mp4').sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
        if (best) return { url: best.url, filename: tweetFilename(id) };
      }
    } catch (_) {} }
    // 2) перехваченное — ТОЛЬКО привязанное к этому твиту (не чужое из ленты/ответов)
    const cap = capturedMedia.filter((c) => c.kind === 'twitter' && id && c.tweetId === id);
    if (cap.length) { const b = cap.slice().sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0]; return { url: b.url, filename: tweetFilename(id) }; }
    return null;
  }

  // Instagram — перехваченные video_versions, затем встроенный data-sjs JSON, затем og:video
  function igFilename(code) { return `instagram_${code || (location.pathname.match(/\/(?:reel|reels|p|tv)\/([^/]+)/) || [])[1] || Date.now()}.mp4`; }
  function walkIg(node, cb, depth) {
    if (!node || typeof node !== 'object' || (depth || 0) > 14) return;
    if (Array.isArray(node.video_versions) || typeof node.video_url === 'string') cb(node);
    for (const k in node) { const v = node[k]; if (v && typeof v === 'object') walkIg(v, cb, (depth || 0) + 1); }
  }
  const IG_REF = 'https://www.instagram.com/';
  // shortcode активного ролика: ссылка /reel|p|tv/<code> в пределах его карточки (геометрически связанная с видео)
  function igCodeFromVideo(vid) {
    return linkIdNearVideo(vid, 'a[href*="/reel/"], a[href*="/reels/"], a[href*="/p/"], a[href*="/tv/"]', /\/(?:reel|reels|p|tv)\/([^/?#]+)/);
  }
  async function extractInstagram() {
    const vid = activeFeedVideo();
    const code = igCodeFromVideo(vid) || (location.pathname.match(/\/(?:reel|reels|p|tv)\/([^/?#]+)/) || [])[1] || null;
    // 1) знаем code активного ролика -> точный матч в пойманном по сети
    if (code) { const cap = capturedMedia.filter((c) => c.kind === 'instagram' && String(c.tweetId) === String(code)); if (cap.length) { const b = cap.slice().sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0]; return { url: b.url, filename: igFilename(code), referer: IG_REF }; } }
    // 2) подтверждение по обложке активного видео — самопроверка
    const byCover = matchCaptured(vid, 'instagram'); if (byCover) return { url: byCover.url, filename: igFilename(byCover.tweetId || code), referer: IG_REF };
    // 2.5) code известен, но не пойман и обложка не совпала -> media-API по pk (как по ссылке) — АВТО без копирования
    if (code) { const m = await igByLink({ code }); if (m) return m; }
    // 3) встроенный data-sjs JSON, точный по code (берём максимальную ширину)
    let exact = null, any = null;
    document.querySelectorAll('script[type="application/json"], script[data-sjs]').forEach((s) => {
      const t = s.textContent; if (!t || (t.indexOf('video_versions') === -1 && t.indexOf('video_url') === -1)) return;
      let j; try { j = JSON.parse(t); } catch (_) { return; }
      walkIg(j, (it) => {
        let url = null;
        if (Array.isArray(it.video_versions) && it.video_versions.length) url = it.video_versions.slice().sort((a, b) => (b.width || 0) - (a.width || 0))[0].url;
        else if (typeof it.video_url === 'string') url = it.video_url;
        if (!url) return;
        const c = it.code || it.shortcode;
        const cand = { url, filename: igFilename(c || code), referer: IG_REF };
        if (c && code && c === code && !exact) exact = cand;
        if (!any) any = cand;
      });
    });
    if (exact) return exact;
    // 4) в ЛЕНТЕ при известном code не качаем чужое; на ОДИНОЧНОМ посте можно довериться og:video/data-sjs (описывают этот пост)
    const single = /\/(?:reel|reels|p|tv)\/[^/?#]+/.test(location.pathname);
    if (code && !single) return null;
    const og = document.querySelector('meta[property="og:video"],meta[property="og:video:url"],meta[property="og:video:secure_url"]');
    if (og && og.content && /^https?:/.test(og.content)) return { url: og.content, filename: igFilename(code), referer: IG_REF }; // og:video на одиночном посте — гарантированно текущий
    if (any && single) return any;   // «любое найденное» — только на одиночном посте (описывает его), в ленте это был бы рандом
    return null;
  }

  function extractGeneric() {
    const og = document.querySelector('meta[property="og:video"],meta[property="og:video:url"],meta[property="og:video:secure_url"]');
    if (og && og.content && /^https?:/.test(og.content)) return { url: og.content, filename: nameFromUrl(og.content) };
    const v = document.querySelector('video');
    const src = v && (v.currentSrc || v.src || (v.querySelector('source') && v.querySelector('source').src));
    if (src && /^https?:/.test(src) && src.indexOf('blob:') !== 0) return { url: src, filename: nameFromUrl(src) };
    return null;
  }

  // YouTube — отдельный движок в МИРЕ страницы (src/yt-page.js), общаемся через postMessage.
  // (Шифр подписи + чтение ytInitialPlayerResponse требуют page-world.) HD-склейка (mp4box) — там же, не для Web Store.
  let ytReqId = 0;
  function ytProgress(d) {                                    // прогресс HD/захвата: и в диалоге, и на самой Ясе (видно после закрытия окна)
    let txt;
    const t = tr();
    if (d.phase === 'prepare') txt = t.stPrepHd;
    else if (d.phase === 'mux') txt = t.stMux;
    else if (d.phase === 'buffer') { const pct = d.total ? Math.round(d.loaded / d.total * 100) : 0; txt = t.stCapturing + pct + t.stCapturingTail; }
    else { const pct = d.total ? Math.round(d.loaded / d.total * 100) : 0; txt = (d.phase === 'video' ? t.stDlVideo : t.stDlAudio) + pct + '%'; }
    const status = dlgVideo && dlgVideo.querySelector('#twtr-dlg-status');
    if (status) { status.className = 'twtr-dlg-status'; status.textContent = txt; }
    say('⬇ ' + txt, 6000);                                    // дублируем на питомца — окно можно закрыть, прогресс остаётся виден
  }
  function resolveYouTube() {
    return new Promise((resolve) => {
      const id = ++ytReqId; let done = false, timer = null;
      const cleanup = () => { window.removeEventListener('message', onMsg); if (timer) clearTimeout(timer); };
      const arm = (ms) => { if (timer) clearTimeout(timer); timer = setTimeout(() => { if (!done) { done = true; cleanup(); resolve(null); } }, ms); };
      const onMsg = (e) => {
        if (e.source !== window || !e.data || e.data.reqId !== id) return;
        if (e.data.__yasiaYtProgress) { ytProgress(e.data); arm(180000); return; }   // живой -> продлеваем ожидание (HD идёт минуты)
        if (e.data.__yasiaYtResult === undefined) return;
        done = true; cleanup();
        const r = e.data.__yasiaYtResult;
        resolve(r && (r.url || r.ok || r.error) ? r : null);
      };
      window.addEventListener('message', onMsg);
      try { window.postMessage({ __yasiaYtRequest: true, reqId: id }, '*'); } catch (_) {}
      arm(30000);                                             // первичный таймаут на разбор плеера; ранний пульс 'prepare' его продлевает
    });
  }

  // мост: MAIN-мир (yt-page.js) просит URL mp4box.all.min.js — у нас (isolated) есть chrome.runtime.getURL
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || !e.data.__yasiaMp4boxReq) return;
    let url = ''; try { url = chrome.runtime.getURL('vendor/mp4box.all.min.js'); } catch (_) {}
    if (url) try { window.postMessage({ __yasiaMp4boxUrl: url, reqId: e.data.reqId }, '*'); } catch (_) {}
  });

  // ---------- ТОЧНОЕ скачивание по СКОПИРОВАННОЙ ссылке («Поделиться → Копировать ссылку») ----------
  // Самый надёжный путь: id берём из ссылки, которую дал сам TikTok/Instagram/X — без угадывания «какой ролик на экране».
  function parseMediaLink(text) {
    if (!text || typeof text !== 'string') return null;
    const um = text.match(/https?:\/\/[^\s"'<>]+/);
    const url = (um ? um[0] : text).trim();
    let m;
    if ((m = url.match(/tiktok\.com\/(?:@[\w.\-]+\/)?(?:video|photo)\/(\d{6,25})/i))) return { platform: 'tiktok', id: m[1], canonical: url };
    if (/(?:vm|vt)\.tiktok\.com\/[\w]+/i.test(url)) return { platform: 'tiktok', short: url };
    if ((m = url.match(/instagram\.com\/(?:[\w.\-]+\/)?(?:reel|reels|p|tv)\/([\w-]+)/i))) return { platform: 'instagram', code: m[1], canonical: url };
    if ((m = url.match(/(?:twitter|x)\.com\/[^/]+\/status\/(\d+)/i))) return { platform: 'twitter', id: m[1] };
    if ((m = url.match(/(?:youtube\.com\/(?:watch\?[^#]*\bv=|shorts\/|live\/)|youtu\.be\/)([\w-]{6,})/i))) return { platform: 'youtube', id: m[1] };
    return null;
  }
  // shortcode Instagram -> media pk: shortcode это pk в base64 (алфавит url-safe), декодируем в число
  function igShortcodeToPk(code) {
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    try { let pk = 0n; for (const ch of String(code)) { const i = A.indexOf(ch); if (i < 0) return null; pk = pk * 64n + BigInt(i); } return pk.toString(); }
    catch (_) { return null; }
  }
  async function ttByLink(t) {
    const id = t.id || null;
    if (id) {   // 1) ровно этот ролик уже пойман в ленте по сети — самый надёжный матч
      const cap = capturedMedia.filter((c) => c.kind === 'tiktok' && String(c.tweetId) === String(id));
      if (cap.length) { const b = cap.slice().sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0]; return { url: b.url, filename: `tiktok_${id}.mp4`, referer: TT_REF }; }
    }
    const url = t.canonical || (id ? `https://www.tiktok.com/@i/video/${id}` : t.short);   // 2) фолбэк: тянем SSR страницы ролика по ссылке
    if (!url) return null;
    let res = null; try { res = await chrome.runtime.sendMessage({ type: 'YASIA_FETCH', url, credentials: 'include' }); } catch (_) {}
    if (!res || !res.ok || !res.text) return null;
    const html = res.text;
    let item = null, m = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
    if (m) { try {
      const scope = (JSON.parse(m[1]) || {}).__DEFAULT_SCOPE__ || {};
      const vd = scope['webapp.video-detail']; item = (vd && vd.itemInfo && vd.itemInfo.itemStruct) || null;
      if (!item) for (const k in scope) { const v = scope[k]; if (v && v.itemInfo && v.itemInfo.itemStruct) { item = v.itemInfo.itemStruct; break; } }
    } catch (_) {} }
    if (!item) { m = html.match(/<script id="SIGI_STATE"[^>]*>([\s\S]*?)<\/script>/); if (m) { try { const s = JSON.parse(m[1]); const k = Object.keys(s.ItemModule || {})[0]; if (k) item = s.ItemModule[k]; } catch (_) {} } }
    if (item && item.video) { const u = bestTikTokUrl(item.video); if (u) return ttResult(u, item, id); }
    return null;
  }
  async function igByLink(t) {
    const code = t.code; if (!code) return null;
    const cap = capturedMedia.filter((c) => c.kind === 'instagram' && String(c.tweetId) === String(code));   // 1) пойман по сети
    if (cap.length) { const b = cap.slice().sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0]; return { url: b.url, filename: igFilename(code), referer: IG_REF }; }
    const pk = igShortcodeToPk(code);   // 2) фолбэк: media-API по pk с куками сессии
    if (pk) {
      let res = null; try { res = await chrome.runtime.sendMessage({ type: 'YASIA_FETCH', url: `https://www.instagram.com/api/v1/media/${pk}/info/`, credentials: 'include', headers: { 'X-IG-App-ID': '936619743392459' } }); } catch (_) {}
      if (res && res.ok && res.text) { try {
        const it = (JSON.parse(res.text).items || [])[0];
        if (it && Array.isArray(it.video_versions) && it.video_versions.length) { const best = it.video_versions.slice().sort((a, b) => (b.width || 0) - (a.width || 0))[0]; if (best && best.url) return { url: best.url, filename: igFilename(code), referer: IG_REF }; }
      } catch (_) {} }
    }
    return null;
  }
  async function twitterById(id) {
    if (!id) return null;
    try {
      const tok = ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
      const res = await chrome.runtime.sendMessage({ type: 'YASIA_FETCH', url: `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${tok}&lang=en` });
      if (res && res.ok && res.text) {
        const j = JSON.parse(res.text); const md = j.mediaDetails || (j.video ? [j] : []); let variants = [];
        (md || []).forEach((mm) => { if (mm.video_info && Array.isArray(mm.video_info.variants)) variants = variants.concat(mm.video_info.variants); });
        const best = variants.filter((x) => x.content_type === 'video/mp4').sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
        if (best) return { url: best.url, filename: tweetFilename(id) };
      }
    } catch (_) {}
    const cap = capturedMedia.filter((c) => c.kind === 'twitter' && c.tweetId === id);
    if (cap.length) { const b = cap.slice().sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0]; return { url: b.url, filename: tweetFilename(id) }; }
    return null;
  }
  // явная цель из поля ввода или буфера обмена — только на «своей» площадке (чужую/устаревшую ссылку игнорируем)
  // некоторые сайты (Instagram) запрещают Clipboard API через Permissions-Policy — проверяем заранее,
  // иначе сам вызов readText() пишет «Permissions policy violation» в лог расширения (даже под try/catch).
  function clipboardReadable() {
    try {
      const fp = document.permissionsPolicy || document.featurePolicy;
      if (fp && typeof fp.allowsFeature === 'function') return fp.allowsFeature('clipboard-read');
    } catch (_) {}
    return true;   // не знаем -> пробуем
  }
  async function explicitLinkTarget() {
    const plat = detectPlatform();
    if (plat !== 'tiktok' && plat !== 'instagram' && plat !== 'twitter') return null;
    const linkEl = root.querySelector('#twtr-dlg-link');
    let t = parseMediaLink((linkEl && linkEl.value) || '') || parseMediaLink((dlgText && dlgText.value) || '');
    if (!t && navigator.clipboard && navigator.clipboard.readText && clipboardReadable()) {
      try { t = parseMediaLink(await navigator.clipboard.readText()); } catch (_) {}
    }
    if (!t || t.platform !== plat) return null;
    return t;
  }
  async function resolveExplicit(t) {
    if (t.platform === 'tiktok') return await ttByLink(t);
    if (t.platform === 'instagram') return await igByLink(t);
    if (t.platform === 'twitter') return await twitterById(t.id);
    return null;   // youtube — только текущая страница
  }

  async function resolveCurrentVideo() {
    const p = detectPlatform();
    if (p === 'tiktok') return await extractTikTok();
    if (p === 'twitter') return await extractTwitter();
    if (p === 'instagram') return await extractInstagram();
    if (p === 'youtube') return await resolveYouTube();
    return extractGeneric();
  }

  // ---------- окно по клику: язык RU/EN + меню возможностей ----------
  // словарь интерфейса (RU/EN) вынесен в core/i18n.js — здесь только ссылка (язык и перерисовка остаются тут)
  const L = (window.Yasia && Yasia.i18n && Yasia.i18n.L) || { ru: {}, en: {} };
  let dlgLang = 'ru';
  const tr = () => L[dlgLang] || L.ru;
  const setTxt = (sel, txt) => { const el = root.querySelector(sel); if (el) el.textContent = txt; };
  // панель настроек (⚙) строится в root.innerHTML один раз -> перелейбливаем подписи/кнопки при смене языка
  function renderSettingsLang() {
    const t = tr();
    const setEl = (sel, tx) => { const e = root.querySelector(sel); if (e && tx != null) e.textContent = tx; };
    setEl('.twtr-set-title', t.setTitle);
    setEl('#twtr-l-size', t.setSize); setEl('#twtr-l-speed', t.setSpeed); setEl('#twtr-l-inertia', t.setInertia); setEl('#twtr-l-roam', t.setRoam);
    setEl('.twtr-set-sub', t.setTest);
    const map = { idle: t.tbIdle, wave: t.tbWave, left: t.tbLeft, right: t.tbRight, jump: t.tbJump, climb: t.tbClimb, 'emo:fall': t.tbFall, 'emo:run': t.tbRun };
    root.querySelectorAll('.twtr-test-btn[data-test]').forEach((b) => { const k = b.getAttribute('data-test'); if (map[k]) b.textContent = map[k]; });
    renderModeRow();   // подписи режимов тоже зависят от языка
  }
  function renderDlgLang() {
    const t = tr();
    renderSettingsLang();
    setTxt('.twtr-dlg-title', t.dlgTitle);   // заголовок окна тоже локализуем: «🐱 Яся» / «🐱 Yasya» (был жёстко зашит в HTML)
    setTxt('#twtr-dlg-greet', t.greet);
    setTxt('#twtr-cap-ai-tx', t.ai);
    setTxt('#twtr-cap-care-tx', t.care);
    setTxt('#twtr-cap-dl-tx', t.dl);
    setTxt('#twtr-cap-games-tx', t.games);
    setTxt('#twtr-cap-reply-tx', t.replier);
    setTxt('#twtr-cap-notes-tx', t.notes);
    setTxt('#twtr-dlg-save', t.save);
    setTxt('#twtr-dlg-lang', t.other);
    if (dlgText) dlgText.placeholder = t.ph;
    const ask = root.querySelector('#twtr-dlg-ask'); if (ask) ask.placeholder = t.askPh;
    const ce = root.querySelector('#twtr-dlg-capsempty'); if (ce && !ce.hidden) ce.textContent = t.capsEmpty;
    const aiBody = root.querySelector('#twtr-skill-ai');
    if (aiBody && !aiBody.hidden && Yasia.ai && Yasia.ai.renderPanel) Yasia.ai.renderPanel(root.querySelector('#twtr-dlg-aipanel'));   // панель ИИ открыта -> перерисовать на новом языке
    renderNotes();
    const careBody = root.querySelector('#twtr-skill-care');
    if (careBody && !careBody.hidden) buildCareSection();   // скил заботы открыт -> перерисовать на новом языке
    const dlBody = root.querySelector('#twtr-skill-dl');
    if (dlBody && !dlBody.hidden) buildVideoSection();   // скил видео открыт -> перерисовать на новом языке
    const gBody = root.querySelector('#twtr-skill-games');
    if (gBody && !gBody.hidden) buildGamesSection();     // скил игр открыт -> перерисовать на новом языке
  }
  // фильтр возможностей по тексту ввода (поиск — первая функция поля)
  function filterCaps(q) {
    q = (q || '').trim().toLowerCase();
    let shown = 0;
    root.querySelectorAll('#twtr-dlg-caps .twtr-skill').forEach((w) => {
      const txEl = w.querySelector('.twtr-cap-tx');
      const tx = (txEl ? txEl.textContent : '').toLowerCase();
      const ok = !q || tx.indexOf(q) !== -1;
      w.style.display = ok ? '' : 'none'; if (ok) shown++;
    });
    const ce = root.querySelector('#twtr-dlg-capsempty');
    if (ce) { ce.hidden = !(q && shown === 0); ce.textContent = tr().capsEmpty; }
  }
  // обращение к ИИ (вторая функция поля) — делегируем «мозгу» (system/ai.js -> Hermes/GPT через background)
  function askAI(q, opts) {
    const shot = !!(opts && opts.shot);
    if (!(q || '').trim() && !shot) return;
    const ai = root.querySelector('#twtr-dlg-ai'); if (!ai) return;
    ai.hidden = false;
    const def = ((tr().lang || 'ru') === 'en') ? 'Look at the screenshot of this page: what is it and what can I do here? Tell me where to click.' : 'Посмотри на скриншот страницы: что это и что тут можно сделать? Подскажи, куда нажать.';
    const text = (q || '').trim() || def;   // со скрином можно без текста — подставим вопрос по умолчанию
    if (Yasia.ai && Yasia.ai.askInto) Yasia.ai.askInto(ai, text, opts);   // мозг сам сходит в Hermes/GPT и отрисует ответ/варианты
    else ai.textContent = tr().aiStub;                            // флаг aiAssistant выключен / система не стартовала
  }
  // окно-облачко над Ясей: позиционируем по её реальному прямоугольнику (а не по центру экрана)
  function positionDialog() {
    const card = root.querySelector('.twtr-dlg-card'); if (!card) return;
    const scroll = root.querySelector('#twtr-dlg-scroll');
    const r = inner.getBoundingClientRect();        // ВИЗУАЛЬНЫЙ прямоугольник (с масштабом) — спрайт растёт вверх за пределы бокса 46×62
    const vw = window.innerWidth, vh = window.innerHeight, m = 8;
    const mouthX = r.left + r.width * 0.5;          // центр Яси по X
    const GAP = 22, TAIL = 13;                        // зазор над Ясей (с запасом на свечение) + длина хвостика
    const aboveSpace = r.top - m - GAP, belowSpace = vh - r.bottom - m - GAP;
    const below = aboveSpace < belowSpace && aboveSpace < 300;     // сверху тесно (Яся вверху) -> облачко снизу
    if (scroll) scroll.style.maxHeight = Math.max(110, (below ? belowSpace : aboveSpace) - 80) + 'px';
    const cw = card.offsetWidth, ch = card.offsetHeight, corner = 26;
    const side = mouthX < vw / 2 ? 'left' : 'right';   // Яся слева -> облако растёт вправо (хвостик в ЛЕВОМ углу), и наоборот
    let left = side === 'left' ? (mouthX - corner) : (mouthX + corner - cw);
    left = Math.max(m, Math.min(left, vw - cw - m));
    let top = below ? (r.bottom + GAP) : (r.top - GAP - ch);   // облако с зазором, Ясю НЕ перекрывает
    top = Math.max(m, Math.min(top, vh - ch - m));
    card.style.left = left + 'px'; card.style.top = top + 'px';
    card.classList.toggle('below', below);
    const tailX = Math.max(14, Math.min(mouthX - left, cw - 14));   // хвостик в углу, направлен на Ясю
    card.style.setProperty('--tailx', tailX + 'px');
    card.style.setProperty('--tailh', TAIL + 'px');
  }
  function closeAllSkills() {
    root.querySelectorAll('.twtr-skill').forEach((w) => { w.classList.remove('open'); const b = w.querySelector('.twtr-skill-body'); if (b) b.hidden = true; });
  }
  // скил = тоггл: клик открывает его содержимое прямо под кнопкой, повторный клик — сворачивает обратно в меню
  function toggleSkill(which) {
    const wrap = root.querySelector('.twtr-skill[data-skill="' + which + '"]'); if (!wrap) return;
    const wasOpen = wrap.classList.contains('open');
    closeAllSkills();
    if (wasOpen) return;                                  // был открыт -> теперь закрыт (вернулись в меню)
    wrap.classList.add('open');
    const body = wrap.querySelector('.twtr-skill-body'); if (body) body.hidden = false;
    if (which === 'ai') {                                 // ИИ-мозг: панель строит system/ai.js (статус+быстрые действия+настройка)
      const box = root.querySelector('#twtr-dlg-aipanel');
      if (Yasia.ai && Yasia.ai.renderPanel) Yasia.ai.renderPanel(box);
      else if (box) box.innerHTML = `<div class="twtr-dlg-empty">${tr().aiStub || ''}</div>`;   // флаг aiAssistant выключен/система упала -> честный отказ
    }
    else if (which === 'care') buildCareSection();
    else if (which === 'dl') buildVideoSection();
    else if (which === 'games') buildGamesSection();
    else if (which === 'reply') {                         // автореплаер: панель строит systems/replier.js
      const box = root.querySelector('#twtr-dlg-reply');
      if (Yasia.replier && Yasia.replier.renderPanel) Yasia.replier.renderPanel(box);
      else if (box) box.innerHTML = `<div class="twtr-dlg-empty">${tr().replierOff || ''}</div>`;   // флаг выключен/система упала -> честный отказ
    }
    else if (Yasia.flags && !Yasia.flags.enabled('notes')) {   // флаг выключен/система упала -> честный отказ (как у скачивания), а не мёртвая панель
      const l = root.querySelector('#twtr-dlg-list'); if (l) l.innerHTML = `<div class="twtr-dlg-empty">${tr().notesOff || 'Заметки выключены.'}</div>`;
    }
    else { renderNotes(); try { dlgText.focus(); } catch (_) {} }
  }

  // меню мини-игр: список запускаемых игр. Логику ведёт systems/games.js (через шину 'game:start').
  function buildGamesSection() {
    const t = tr();
    const box = root.querySelector('#twtr-dlg-games'); if (!box) return;
    if (Yasia.flags && !Yasia.flags.enabled('games')) { box.innerHTML = `<div class="twtr-dlg-empty">${t.gamesOff}</div>`; return; }
    const games = [
      { id: 'chase', ic: '🐭', name: t.gChase, desc: t.gChaseD, on: true },
      { id: 'food', ic: '🍖', name: t.gFood, desc: t.gFoodD, on: true },
      { id: 'zombie', ic: '🏹', name: t.gZombie, desc: t.gZombieD, on: true },
      { id: 'hide', ic: '🙈', name: t.gHide, desc: t.gHideD, on: true },
    ];
    box.innerHTML = games.map((g) =>
      `<button class="twtr-game-btn${g.on ? '' : ' off'}" data-game="${g.id}" type="button"${g.on ? '' : ' disabled'}>`
      + `<span class="twtr-game-ic">${g.ic}</span><span class="twtr-game-tx"><b>${g.name}</b><i>${g.desc}</i></span></button>`).join('');
    box.querySelectorAll('[data-game]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (b.disabled) return;
      const id = b.getAttribute('data-game');
      closeDialog();
      try { Yasia.events.emit('game:start', { id }); } catch (_) {}
    }));
  }

  function buildVideoSection() {
    const t = tr();
    const p = detectPlatform();
    const known = (p === 'tiktok' || p === 'twitter' || p === 'instagram' || p === 'youtube');
    const hintStyle = 'font-size:11px;color:#536471;margin-top:6px;line-height:1.35;';
    const imgBtn = `<button class="twtr-dlg-dl" id="twtr-dlg-dli" type="button">${t.dlImgsBtn}</button>`;
    const wireImgs = () => { const b = dlgVideo.querySelector('#twtr-dlg-dli'); if (b) b.addEventListener('click', (e) => { e.stopPropagation(); doDownloadImages(e.currentTarget); }); };
    if (!known && !extractGeneric()) {   // видео нет — но картинки со страницы скачать можно всегда
      dlgVideo.innerHTML = `<div class="twtr-dlg-hint" style="${hintStyle}">${t.novideo}</div>${imgBtn}<div class="twtr-dlg-status" id="twtr-dlg-status"></div>`;
      wireImgs(); return;
    }
    const name = { tiktok: 'TikTok', twitter: 'Twitter / X', instagram: 'Instagram', youtube: 'YouTube' }[p] || (dlgLang === 'en' ? 'Video' : 'Видео');
    const wm = p === 'tiktok' ? t.wmTt : (p === 'youtube' ? t.wmYt : '');
    const hint = (p === 'tiktok' || p === 'instagram') ? `<div class="twtr-dlg-hint" style="${hintStyle}">${t.hintShare}</div>`
      : (p === 'youtube' ? `<div class="twtr-dlg-hint" style="${hintStyle}">${t.hintYt}</div>` : '');
    const linkField = (p === 'tiktok' || p === 'instagram' || p === 'twitter') ? `<input class="twtr-dlg-link" id="twtr-dlg-link" type="text" placeholder="${t.linkPh}">` : '';
    dlgVideo.innerHTML = `<span class="twtr-dlg-plat">🎬 ${name} — ${t.onpage}</span>${linkField}<button class="twtr-dlg-dl" id="twtr-dlg-dl" type="button">${t.dlbtn}${wm}</button>${imgBtn}<div class="twtr-dlg-status" id="twtr-dlg-status"></div>${hint}`;
    dlgVideo.querySelector('#twtr-dlg-dl').addEventListener('click', (e) => { e.stopPropagation(); doDownload(e.currentTarget); });
    wireImgs();
  }

  // ---------- скачивание картинок ----------
  // На X/Twitter — фото твитов (pbs.twimg.com/media) в максимальном качестве (name=orig);
  // на остальных сайтах — крупные видимые <img>. До 8 штук, ближние к центру экрана первыми.
  function collectPageImages() {
    const seen = new Set(), out = [];
    const midY = window.innerHeight / 2;
    const cand = [];
    for (const im of document.querySelectorAll('img')) {
      const r = im.getBoundingClientRect();
      if (r.width < 120 || r.height < 120 || r.bottom < 0 || r.top > window.innerHeight) continue;   // мелочь (аватарки/смайлы) и вне экрана
      const src = im.currentSrc || im.src || '';
      if (!/^https?:/.test(src) || /\.svg(\?|$)/i.test(src)) continue;
      cand.push({ src, mid: (r.top + r.bottom) / 2 });
    }
    cand.sort((a, b) => Math.abs(a.mid - midY) - Math.abs(b.mid - midY));
    for (const c of cand) {
      let u = c.src;
      if (/pbs\.twimg\.com\/media\//.test(u)) { try { const x = new URL(u); x.searchParams.set('name', 'orig'); u = x.toString(); } catch (_) {} }   // X отдаёт оригинал по name=orig
      else if (isTwitter) continue;                       // на X берём только фото твитов (не аватарки/баннеры)
      if (seen.has(u)) continue;
      seen.add(u); out.push(u);
      if (out.length >= 8) break;
    }
    return out;
  }
  function imageFilename(u, i) {
    let ext = 'jpg';
    try { const x = new URL(u); const f = x.searchParams.get('format'); const m = x.pathname.match(/\.(jpe?g|png|webp|gif)(\?|$)/i); ext = ((f || (m && m[1]) || 'jpg') + '').toLowerCase(); } catch (_) {}
    return 'yasya_img_' + Date.now() + '_' + (i + 1) + '.' + ext;
  }
  async function doDownloadImages(btn) {
    const status = dlgVideo.querySelector('#twtr-dlg-status');
    const setStatus = (cls, txt) => { if (status) { status.className = 'twtr-dlg-status ' + cls; status.textContent = txt; } };
    const T = tr();
    if (Yasia.flags && !Yasia.flags.enabled('mediaDownload')) { setStatus('err', T.stDlOff); return; }
    const urls = collectPageImages();
    if (!urls.length) { setStatus('err', T.stNoImgs); return; }
    if (Yasia.guard && Yasia.guard.needDownloadConfirm()) {   // СТРАЖ: как у видео — частые скачивания/safe-режим требуют явного «да»
      const ok = await Yasia.guard.confirm({ text: T.gdDlMany, yes: T.gdYes, no: T.gdNo });
      if (!ok) { setStatus('', ''); return; }
    }
    if (Yasia.guard) Yasia.guard.noteDownload();
    btn.disabled = true; setStatus('', T.stImgsDl + urls.length + '…');
    let okN = 0;
    for (let i = 0; i < urls.length; i++) {
      try { const r = await chrome.runtime.sendMessage({ type: 'YASIA_DOWNLOAD', url: urls[i], filename: imageFilename(urls[i], i) }); if (r && r.ok) okN++; } catch (_) {}
    }
    btn.disabled = false;
    if (okN) { setStatus('ok', T.stImgsOk + okN); say(tr().sCatch, 1800); }
    else setStatus('err', T.stFail + 'images');
  }

  // ---------- скил «Забота»: 7 действий + строка состояния ----------
  function careStatusText() {
    const t = tr(), h = currentHunger(), e = currentEnergy(), b = currentBond();
    const parts = [
      h >= HUNGER_STARVING ? t.sStarving : (h >= HUNGER_HUNGRY ? t.sHungry : t.sFed),
      e <= ENERGY_LOW ? t.sSleepy : (e < ENERGY_TIRED ? t.sTired : t.sEnergetic),
      b >= BOND_BESTIE ? t.sBestie : (b >= BOND_FRIEND ? t.sFriend : t.sShy),
    ];
    if (sickAt) parts.unshift(t.sSickNow);   // болезнь — первой строкой (важнее всего)
    return t.careNow + ': ' + parts.join(', ');
  }
  function renderCareStatus() { const el = root.querySelector('#twtr-care-stat'); if (el) el.textContent = careStatusText(); }
  function buildCareSection() {
    if (!dlgCare) return;
    const t = tr();
    const acts = [
      ['feed', '🍖', t.aFeed], ['pet', '✋', t.aPet], ['play', '🎾', t.aPlay], ['call', '📣', t.aCall],
      ['help', '🆘', t.aHelp], ['hide', '🙈', t.aHide], ['wake', '⏰', t.aWake], ['heal', '💊', t.aHeal],
    ];
    dlgCare.innerHTML = acts.map(([k, ic, lb]) => `<button class="twtr-care-btn" data-act="${k}" type="button"><span class="twtr-care-ic">${ic}</span><span>${lb}</span></button>`).join('') + `<div class="twtr-care-stat" id="twtr-care-stat"></div>`;
    dlgCare.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); careAction(b.getAttribute('data-act')); }));
    renderCareStatus();
  }

  async function doDownload(btn) {
    if (Yasia.flags && !Yasia.flags.enabled('mediaDownload')) {   // фича выключена/сломана -> вежливый отказ, без огня
      const status = dlgVideo.querySelector('#twtr-dlg-status');
      if (status) { status.className = 'twtr-dlg-status err'; status.textContent = tr().stDlOff; }
      return;
    }
    startDownloading(); const dlStart = now();   // огненная форма на всё время скачивания (YT-склейка идёт минуты)
    try {
      return await doDownloadInner(btn);
    } finally {
      stopDownloadingSoon(dlStart);              // вернуть в обычное состояние (с минимальной выдержкой формы)
    }
  }
  async function doDownloadInner(btn) {
    const status = dlgVideo.querySelector('#twtr-dlg-status');
    const setStatus = (cls, txt) => { if (status) { status.className = 'twtr-dlg-status ' + cls; status.textContent = txt; } };
    const T = tr();
    btn.disabled = true; setStatus('', T.stSearching);
    const plat0 = detectPlatform();
    let media = null, explicit = false;
    // 1) если в буфере/поле — ссылка на ролик (TikTok/IG/X), берём ИМЕННО его. Ссылка АВТОРИТЕТНА:
    //    либо это видео, либо честный отказ — НИКОГДА не откатываемся в угадывание ленты (было «качает рандом»).
    try { const t = await explicitLinkTarget(); if (t) { explicit = true; setStatus('', T.stByLink + (t.id || t.code || 'ok') + '…'); media = await resolveExplicit(t); } } catch (_) {}
    if (explicit && (!media || !media.url)) { setStatus('err', T.stByLinkFail); btn.disabled = false; return; }
    // 2) ссылки нет — определяем видео по странице (без рандома: если не опознали однозначно, будет «не найдено»)
    if (!media) { try { media = await resolveCurrentVideo(); } catch (_) {} }
    // YouTube HD: файл уже склеен и сохранён прямо в странице (mp4box -> Blob -> download)
    if (media && media.ok && media.hd) { setStatus('ok', T.stDownloadedTo + media.quality + (media.throttled ? T.stThrottleN : '')); say(tr().sCatch, 1800); btn.disabled = false; return; }
    if (media && media.error) { setStatus('err', media.error); if (media.needBuffer) say(pick(YT_BUFFER_CALLS), 7000); btn.disabled = false; return; }   // плеер ещё не отдал поток -> Яся вслух просит дать ролику поиграть (ру+англ)
    if (!media || !media.url) {
      const tip = (plat0 === 'tiktok' || plat0 === 'instagram') ? T.stNoClip : T.stNoVideo;
      setStatus('err', tip); btn.disabled = false; return;
    }
    // СТРАЖ: много скачиваний подряд (или безопасный режим) -> явное подтверждение пользователя
    if (Yasia.guard && Yasia.guard.needDownloadConfirm()) {
      const ok = await Yasia.guard.confirm({ text: tr().gdDlMany, yes: tr().gdYes, no: tr().gdNo });
      if (!ok) { setStatus('', ''); btn.disabled = false; return; }
    }
    if (Yasia.guard) Yasia.guard.noteDownload();
    setStatus('', T.stDownloading);
    try {
      // validate: прогнать через fetch+проверку content-type (YouTube/обычные сайты могут отдать html/текст -> иначе сохранится .txt)
      const plat = detectPlatform();
      const validate = !media.referer && (plat === 'youtube' || plat === 'generic');
      const res = await chrome.runtime.sendMessage({ type: 'YASIA_DOWNLOAD', url: media.url, filename: media.filename, referer: media.referer || null, validate });
      if (res && res.ok) { setStatus('ok', media.throttled ? T.stDlThrottle : T.stDlOk); say(tr().sCatch, 1800); }
      else if (plat === 'youtube' && /\b403\b/.test((res && res.error) || '')) setStatus('err', T.st403);
      else setStatus('err', T.stFail + ((res && res.error) || 'error'));
    } catch (err) { setStatus('err', T.stErr + String((err && err.message) || err)); }
    btn.disabled = false;
  }

  // --- заметки --- вынесены в src/systems/notes.js (флаг notes). Общение через шину:
  const renderNotes = () => Yasia.events.emit('notes:render');   // обновить список (no-op, если система выключена/упала)
  const addNote = () => Yasia.events.emit('notes:add');          // добавить из поля ввода

  function openDialog() {
    try { window.postMessage({ __yasiaCollect: true }, '*'); } catch (_) {}
    const ask = root.querySelector('#twtr-dlg-ask'); if (ask) ask.value = '';
    const ai = root.querySelector('#twtr-dlg-ai'); if (ai) ai.hidden = true;
    const rw = root.querySelector('#twtr-skill-reply-wrap');   // автореплаер виден только при включённом флаге (по умолчанию выключен)
    if (rw) rw.hidden = !(Yasia.flags && Yasia.flags.enabled('replier') && Yasia.replier);
    closeAllSkills(); renderDlgLang(); renderNotes(); filterCaps('');
    dialog.classList.add('show'); positionDialog();
  }
  function closeDialog() { dialog.classList.remove('show'); }
  root.querySelector('#twtr-dlg-x').addEventListener('click', (e) => { e.stopPropagation(); closeDialog(); });
  root.querySelector('#twtr-dlg-backdrop').addEventListener('click', (e) => { e.stopPropagation(); closeDialog(); });
  root.querySelector('#twtr-dlg-save').addEventListener('click', (e) => { e.stopPropagation(); addNote(); });
  root.querySelector('#twtr-dlg-lang').addEventListener('click', (e) => { e.stopPropagation(); dlgLang = dlgLang === 'ru' ? 'en' : 'ru'; try { Yasia.storage.syncSet({ dlgLang }); } catch (_) {} renderDlgLang(); });
  root.querySelector('#twtr-cap-ai').addEventListener('click', (e) => { e.stopPropagation(); toggleSkill('ai'); });
  root.querySelector('#twtr-cap-care').addEventListener('click', (e) => { e.stopPropagation(); toggleSkill('care'); });
  root.querySelector('#twtr-cap-dl').addEventListener('click', (e) => { e.stopPropagation(); toggleSkill('dl'); });
  root.querySelector('#twtr-cap-games').addEventListener('click', (e) => { e.stopPropagation(); toggleSkill('games'); });
  root.querySelector('#twtr-cap-notes').addEventListener('click', (e) => { e.stopPropagation(); toggleSkill('notes'); });
  root.querySelector('#twtr-cap-reply').addEventListener('click', (e) => { e.stopPropagation(); toggleSkill('reply'); });
  // «мозг» (ai.js) распознал намерение в поле «спроси» -> открываем нужный навык прямо в окне Яси (маршрутизация запроса к её инструментам)
  try { Yasia.events.on('cap:open', (p) => {
    const which = p && p.which; if (!which) return;
    if (!dialog.classList.contains('show')) openDialog();
    const wrap = root.querySelector('.twtr-skill[data-skill="' + which + '"]');
    if (wrap && !wrap.classList.contains('open')) toggleSkill(which);   // toggleSkill — переключатель: открываем только если ещё закрыт
  }); } catch (_) {}
  // режимы поведения (страж): кнопки в настройках; подсветка активного + тултип с названием
  function renderModeRow() {
    const t = tr(); const names = { normal: t.mNormal, calm: t.mCalm };
    const cur = Yasia.guard ? Yasia.guard.mode() : 'normal';
    root.querySelectorAll('.twtr-mode-btn').forEach((b) => {
      const m = b.getAttribute('data-mode');
      b.classList.toggle('on', m === cur);
      if (names[m]) b.title = names[m];
    });
    const lbl = root.querySelector('#twtr-l-mode'); if (lbl && t.setMode) lbl.textContent = t.setMode + (names[cur] ? ' · ' + names[cur] : '');
  }
  root.querySelectorAll('.twtr-mode-btn').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (Yasia.guard) Yasia.guard.setMode(b.getAttribute('data-mode'));
    renderModeRow();
  }));
  try { if (Yasia.guard) Yasia.guard.onMode(() => renderModeRow()); } catch (_) {}   // смена из другой вкладки -> подсветка вживую
  renderModeRow();

  // сработала напоминалка (фон, chrome.alarms) -> Яся произносит её прямо на странице
  function showReminder(text) {
    const tx = String(text || '').slice(0, 200).trim(); if (!tx) return false;
    setMode('happy'); happyKind = 'wave'; happyUntil = now() + 1800;
    say('⏰ ' + tx, 6500); playEmote('happy', 1800);
    return true;
  }
  try { chrome.runtime.onMessage.addListener((m, _s, sendResponse) => {
    if (!m || m.type !== 'YASIA_REMIND_FIRE') return;
    const ok = showReminder(m.text);
    try { sendResponse({ ok }); } catch (_) {}   // подтверждение доставки: фон удалит напоминалку только после него
  }); } catch (_) {}
  // при загрузке страницы забираем пропущенные напоминалки (браузер был закрыт/не было вкладок) — показываем по очереди
  try { setTimeout(() => {
    chrome.runtime.sendMessage({ type: 'YASIA_REMIND_PULL' }, (r) => {
      if (chrome.runtime.lastError || !r || !r.ok || !Array.isArray(r.due)) return;
      r.due.slice(0, 5).forEach((d, i) => setTimeout(() => showReminder(d.text), i * 7500));
    });
  }, 4000); } catch (_) {}
  const askEl = root.querySelector('#twtr-dlg-ask');
  if (askEl) {
    askEl.addEventListener('input', (e) => { e.stopPropagation(); filterCaps(askEl.value); });           // печатаешь -> фильтр возможностей сверху
    askEl.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); askAI(askEl.value); } });   // Enter -> к ИИ (заглушка)
  }
  root.querySelector('#twtr-dlg-asksend').addEventListener('click', (e) => { e.stopPropagation(); askAI(askEl ? askEl.value : ''); });
  { const shotBtn = root.querySelector('#twtr-dlg-askshot'); if (shotBtn) shotBtn.addEventListener('click', (e) => { e.stopPropagation(); askAI(askEl ? askEl.value : '', { shot: true }); }); }   // 📸 -> вопрос + скрин страницы в GPT
  try { Yasia.storage.syncGet({ dlgLang: 'ru' }, (s) => { dlgLang = (s && s.dlgLang === 'en') ? 'en' : 'ru'; renderDlgLang(); }); } catch (_) {}
  // язык сменили в попапе/другой вкладке -> подхватываем вживую (единый переключатель на всё)
  try { Yasia.storage.onChanged((ch, area) => {
    if (area !== 'sync' || !ch || !ch.dlgLang) return;
    const nl = ch.dlgLang.newValue === 'en' ? 'en' : 'ru';
    if (nl === dlgLang) return;
    dlgLang = nl; renderDlgLang();
    try { toggle.title = enabled ? tr().ttHide : tr().ttShow; } catch (_) {}
  }); } catch (_) {}
  dlgText.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); addNote(); } });
  dialog.addEventListener('mousedown', (e) => e.stopPropagation());   // работаем в окне, не таскаем Ясю
  dialog.addEventListener('click', (e) => e.stopPropagation());

  // ---------- клик по питомцу ----------
  pet.addEventListener('click', (e) => {
    e.stopPropagation();
    if (didDrag) { didDrag = false; return; }   // это было перетаскивание, не клик
    if (gameActive) { try { Yasia.events.emit('game:petclick'); } catch (_) {} return; }   // идёт игра -> клик уходит игре (а не открывает окно)
    if (hiding) { unhide(); return; }            // вылезает из укрытия по клику
    setMode('happy'); happyUntil = now() + 1200;   // гладят — машет ручкой
    openDialog();                                   // и открываем окошко (забота + скачать видео + заметки)
  });

  // ---------- платформер: жизнь по структуре страницы ----------
  function petW() { return PET_W * sizeMul * userScale; }   // эффективная ширина с учётом размера = ХИТБОКС (растёт/уменьшается)
  // ДВИЖОК ПЛАТФОРМЕРА вынесен в core/platformer.js: полки/прыжок/падение/свободное лазание.
  // S — мост к локальным переменным (pet.js остаётся их хозяином: drag, игры, отрисовка работают как раньше).
  const S = {
    get px() { return px; }, set px(v) { px = v; },
    get py() { return py; }, set py(v) { py = v; },
    get vx() { return vx; }, set vx(v) { vx = v; },
    get vy() { return vy; }, set vy(v) { vy = v; },
    get face() { return face; }, set face(v) { face = v; },
    get jumping() { return jumping; }, set jumping(v) { jumping = v; },
    get falling() { return falling; }, set falling(v) { falling = v; },
    get thrown() { return thrown; }, set thrown(v) { thrown = v; },
    get climbing() { return climbing; }, set climbing(v) { climbing = v; },
    get standLedge() { return standLedge; }, set standLedge(v) { standLedge = v; },
    get walkTargetX() { return walkTargetX; }, set walkTargetX(v) { walkTargetX = v; },
    get nextJumpDecide() { return nextJumpDecide; }, set nextJumpDecide(v) { nextJumpDecide = v; },
    get lastLeftEl() { return lastLeftEl; }, set lastLeftEl(v) { lastLeftEl = v; },
  };
  const engine = Yasia.platformer.createEngine(S, {
    params: () => ({ W: PET_W, H: PET_H, dx: PLAT_JUMP_DX, up: PLAT_JUMP_UP, gravity: PLAT_GRAVITY, jumpMs: PLAT_JUMP_MS, floorPad: PLAT_FLOOR, scaleK: sizeMul * userScale }),
    petW,
    rootContains: (el) => root.contains(el),
    goalClimbing: () => (watchClimbing || gameClimb),
    onJumpStart: () => pet.classList.add('is-jump'),
    onJumpEnd: () => pet.classList.remove('is-jump'),
    sayJump: () => say(pick(SP('jump')), 1100),
    sayTop: () => say(pick(SP('top')), 1600),
  });
  // делегаты с прежними именами — все вызовы по файлу (watch/игры/petApi/тесты) работают без правок
  function startJump(L, tgtCenterX, t) { engine.startJump(L, tgtCenterX, t); }
  function updateJump(t) { engine.updateJump(t); }
  function tryClimb(t) { engine.tryClimb(t); }
  function walkAlong(t) {
    if (resting) { running = false; return; }            // спит/без сил — стоит на месте
    if (t < forceRunUntil) { running = true; }           // превью «Бег»: держим бег, не трогая общие таймеры авто-решений
    else {
      if (t > nextRunDecide) {
        nextRunDecide = t + 3500 + Math.random() * 4000;
        const canRun = currentEnergy() >= ENERGY_TIRED && currentMood() > MOOD_BAD;   // бегает только бодрая и в норм. настроении
        const chance = ambient === 'playful' ? 0.34 : (canRun ? 0.12 : 0);
        running = Math.random() < chance;
        runUntil = running ? t + 900 + Math.random() * 1200 : 0;
      }
      if (running && t > runUntil) running = false;
    }
    const sp = SPEED * speedMul * userSpeed * (running ? RUN_MUL : 1);
    const dx = walkTargetX - px;
    if (Math.abs(dx) <= sp) {
      px = walkTargetX;
      if (comeUntil) { comeUntil = 0; running = false; setMode('happy'); happyKind = 'wave'; happyUntil = now() + 1000; }   // прибежала на зов -> машет «привет»
    } else { px += Math.sign(dx) * sp; face = dx > 0 ? 1 : -1; }
    px = clamp(px, 0, window.innerWidth - PET_W);   // по краю экрана; за край ОПОРЫ выходить можно -> упадёт
  }
  // достижим ли прыжок с полки A на полку B — чистая функция вынесена в core/physics.js (там же юнит-тесты, tests/physics.test.js)
  function ledgeJumpable(A, B) { return Yasia.physics.ledgeJumpable(A, B, { W: PET_W, dx: PLAT_JUMP_DX, up: PLAT_JUMP_UP }); }
  function watchClimbDecide(t) {   // ПОИСК ПУТИ к видео (BFS по полкам): прыгает вверх/вбок/вниз через разрывы; идёт по кратчайшему маршруту к ближайшей к видео достижимой полке; если лучше не добраться -> watchStuck (просит подсадить)
    if (!standLedge) return;
    const W = PET_W, cx = px + W / 2, goalCx = watchClimbCx, goalY = watchClimbY;
    const minLedgeY = PET_H * Math.max(1, sizeMul * userScale);             // полки за верхом экрана — игнор
    const nearCx = (L) => clamp(goalCx, L.x1 + W / 2, L.x2 - W / 2);        // точка на L, ближайшая к центру видео
    const wd = (L) => Math.abs(L.y - goalY) + Math.abs(nearCx(L) - goalCx) * 0.8;   // «насколько эта полка близка к видео» (высота + горизонт)
    const start = standLedge;
    const nodes = [];                                                       // достижимые-для-стояния полки текущего снимка
    for (const L of ledges) { if ((L.x2 - L.x1) >= W && L.y >= minLedgeY && !(L.el && start.el && L.el === start.el)) nodes.push(L); }
    // BFS от текущей полки: кратчайший (по числу прыжков) маршрут; среди ВСЕХ достижимых берём самую близкую к видео
    const prev = new Map(), seen = new Set([start]); let queue = [start], head = 0;
    let bestNode = null, bestD = wd(start) - 2;                             // цель должна быть СТРОГО ближе к видео (-2 -> без дрожи)
    while (head < queue.length) {
      const curN = queue[head++];
      for (const nb of nodes) {
        if (seen.has(nb) || !ledgeJumpable(curN, nb)) continue;
        seen.add(nb); prev.set(nb, curN); queue.push(nb);
        const d = wd(nb); if (d < bestD) { bestD = d; bestNode = nb; }
      }
    }
    if (!bestNode) { if (!watchStuck) watchStuckT = t; watchStuck = true; return; }   // никуда ближе к видео не добраться -> отсюда просит подсадить (запоминаем момент первого застревания для дебаунса)
    let step = bestNode; while (prev.get(step) && prev.get(step) !== start) step = prev.get(step);   // первый прыжок маршрута (сосед текущей полки)
    watchStuck = false; watchStuckT = 0;
    if (step !== bestNode && step.el && watchFromEl && step.el === watchFromEl) {   // АНТИ-ПИНГ-ПОНГ: не прыгать ОБРАТНО на только что покинутую полку как «крюк» (дальняя цель мерцает в снимке)
      if (!watchPingT) watchPingT = t;
      if (t - watchPingT > 900) { watchFromEl = null; watchPingT = 0; }     // заблокировано надолго -> снять анти-крюк: значит это НАСТОЯЩИЙ обратный путь (не зависаем; иначе дальше beg)
      else { walkTargetX = px; nextJumpDecide = t + 140; return; }          // короткое мерцание -> переждать и перепланировать
    }
    const sMin = start.x1 + W / 2, sMax = start.x2 - W / 2, pMin = step.x1 + W / 2, pMax = step.x2 - W / 2;
    const offC = clamp(clamp((sMin + sMax) / 2, pMin, pMax), sMin, sMax);   // точка ОТРЫВА на текущей полке (ближе всего к следующей)
    if (Math.abs(cx - offC) > 6) { walkTargetX = clamp(offC - W / 2, start.x1, start.x2 - W); nextJumpDecide = t + 80; return; }   // ещё идём к точке отрыва -> прыгнем, дойдя
    const landC = clamp(goalCx, Math.max(pMin, offC - PLAT_JUMP_DX), Math.min(pMax, offC + PLAT_JUMP_DX));   // приземление на следующую полку, как можно ближе к видео в пределах прыжка
    watchFromEl = start.el; watchPingT = 0;                                 // запоминаем покинутую полку (анти-крюк) и сбрасываем его таймер на успешном прыжке
    startJump(step, landC, t);                                              // прыжок к следующей полке маршрута (вверх/вбок/вниз)
  }
  function rideStandLedge() {   // едем вместе с прокруткой, пока стоим на элементе; сдвиг полки СКРОЛЛОМ — не её ходьба (prevPy), иначе updateHop мигает walk/idle
    if (!(standLedge && standLedge.el)) return;
    const r = standLedge.el.getBoundingClientRect();
    if (!r || r.width < 30 || r.top < 0 || r.top > window.innerHeight) { standLedge = null; return; }
    prevPy += r.top - standLedge.y;
    standLedge.y = r.top; standLedge.x1 = Math.max(4, r.left); standLedge.x2 = Math.min(window.innerWidth - 4, r.right);
  }
  function platformerTick(t, dt) {
    if (t - lastLedgeScan > 140) { lastLedgeScan = t; ledges = engine.scan(); engine.reacquireFloor(); drawLedgeDebug(); }   // снимок полок ведёт движок; ledges — та же ссылка (маршруты к видео/игре читают её)
    rideStandLedge();
    if (jumping) { falling = false; thrown = false; updateJump(t); return; }
    if (standLedge) {
      falling = false; thrown = false;
      py = standLedge.y - PET_H;
      if (watchHelp) { running = false; }   // просит подсадить -> не бежит; КУДА идти (под видео) задаёт watching-ветка, не фиксируем на месте (иначе зависает где попало)
      else if (watchClimbing) { running = false; }            // лезет к видео -> walkTargetX задаёт поиск пути (watchClimbDecide), не перетираем тут
      else if (gameClimb) { running = false; }                // лезет к игровой цели -> walkTargetX задаёт gameClimbDecide
      else if (goEdgeUntil && t < goEdgeUntil) {              // идёт к краю блока, чтобы сесть (sit_edge): ведём к краю, прыжки подавлены
        running = false; walkTargetX = clamp(goEdgeX, standLedge.x1, standLedge.x2 - PET_W); nextJumpDecide = Math.max(nextJumpDecide, t + 500);
        if (Math.abs(px - walkTargetX) < 6) {                 // дошла до края -> садится, ноги свисают наружу
          goEdgeUntil = 0; face = (px <= standLedge.x1 + 12) ? -1 : 1; playEmote('sit_edge', 3600);
        }
      } else if (goEdgeUntil && t >= goEdgeUntil) { goEdgeUntil = 0; }   // не дошла за окно -> отменяем намерение
      walkAlong(t);
      if (watchClimbing) { if (t > nextJumpDecide) { nextJumpDecide = t + 320; watchClimbDecide(t); } }   // поиск пути к видео: прыжок к следующей полке маршрута (или watchStuck)
      else if (gameClimb) { if (t > nextJumpDecide) { nextJumpDecide = t + 300; gameClimbDecide(t); } }   // лазание к игровой цели: жадный прыжок вверх к точке
      else if (!watchHelp && t > nextJumpDecide && t >= forceRunUntil) { nextJumpDecide = t + 1000 + Math.random() * 1800; if (!resting) tryClimb(t); }   // живой темп прыжков по блокам; во время превью «Бег» (forceRunUntil) — без авто-прыжков; resting -> не скачет
      const cxf = px + PET_W / 2;
      if (cxf < standLedge.x1 - 2 || cxf > standLedge.x2 + 2) standLedge = null;   // сошла с края опоры -> падает
    } else {                                            // падаем/летим: инерция броска + гравитация + ловля полки — в движке (core/platformer.js fallStep)
      engine.fallStep(t, dt);
    }
    py = clamp(py, PET_H * Math.max(0, sizeMul * userScale - 1), window.innerHeight - PET_H);   // держим в пределах экрана
  }

  // ---------- дебаг-оверлей полок (РЕЖИМ РАЗРАБОТЧИКА, тумблер в попапе): как Яся видит страницу ----------
  let ledgeDebug = false, ledgeDebugBox = null;
  function drawLedgeDebug() {
    if (!ledgeDebug) return;
    if (!ledgeDebugBox) { ledgeDebugBox = document.createElement('div'); ledgeDebugBox.className = 'twtr-ledges-dbg'; root.appendChild(ledgeDebugBox); }
    const ls = engine.ledges(), cx = px + PET_W / 2;
    const candSet = new Set();   // зелёное: куда допрыгнет С ТЕКУЩЕЙ позиции (та же физика, что в tryClimb)
    if (standLedge) for (const c of Yasia.physics.climbCandidates(ls, standLedge, cx, { W: PET_W, dx: PLAT_JUMP_DX, up: PLAT_JUMP_UP, minY: PET_H * Math.max(1, sizeMul * userScale), lastLeftEl: null })) candSet.add(c.L);
    ledgeDebugBox.innerHTML = ls.map((L) => {
      let cls = 'no';
      if (L === standLedge) cls = 'on';
      else if (candSet.has(L)) cls = 'ok';
      else if (standLedge && L.y >= PET_H * Math.max(1, sizeMul * userScale) && ledgeJumpable(standLedge, L)) cls = 'plan';   // жёлтое: допрыгнет, если ДОЙДЁТ до точки отрыва на краю — так маршрутизирует планировщик похода к видео (BFS полка->полка)
      else if (L.floor) cls = 'floor';
      return '<i class="' + cls + '" style="left:' + L.x1 + 'px;top:' + L.y + 'px;width:' + Math.max(0, L.x2 - L.x1) + 'px"></i>';
    }).join('');
  }
  function setLedgeDebug(on) {
    ledgeDebug = !!on;
    if (!ledgeDebug) { if (ledgeDebugBox) { try { ledgeDebugBox.remove(); } catch (_) {} ledgeDebugBox = null; } return; }
    engine.scan(); drawLedgeDebug();   // показать сразу, даже если гуляние выключено и тиков скана нет
  }
  // тумблер живёт в попапе (storage.sync 'devLedges') — подхватываем при старте и вживую
  try { Yasia.storage.syncGet({ devLedges: false }, (s) => setLedgeDebug(s && s.devLedges)); } catch (_) {}
  try { Yasia.storage.onChanged((ch, area) => { if (area === 'sync' && ch && ch.devLedges) setLedgeDebug(ch.devLedges.newValue); }); } catch (_) {}

  // ---------- ручная проверка действий (кнопки в настройках) ----------
  function startTest(kind) {
    testDir = (kind === 'left') ? -1 : 1;
    if (kind === 'emo:run') {                    // «Бег» — настоящий бег С ФИЗИКОЙ: бежит к дальнему краю, сбежав с края блока — ПАДАЕТ, приземляется, бежит дальше
      testKind = 'run'; testUntil = now() + 3600; forceRunUntil = testUntil; running = true;
      setMode('idle'); climbing = false; jumping = false;
      testDir = (px > (window.innerWidth - PET_W) / 2) ? -1 : 1;
      walkTargetX = testDir > 0 ? window.innerWidth - PET_W : 0;   // цель — дальний край (физику ведёт platformerTick)
      const re = EMOTIONS.find((x) => x.key === 'run'); say(re ? re.emo + ' ' + re.name : '🏃 Бег', 1500);
      return;
    }
    if (kind.indexOf('emo:') === 0) {            // тест эмоции: проигрываем её кадры на месте
      const st = kind.slice(4);
      if (st === 'pounce' && CAT_SETS.pounce) {  // наскок — НЕ поза: и из тест-сетки запускаем настоящий рывок вперёд
        startPounce();
        const pe = EMOTIONS.find((x) => x.key === 'pounce'); say(pe ? pe.emo + ' ' + pe.name : 'pounce', 1600);
        return;
      }
      if (st === 'sit_edge' && CAT_SETS.sit_edge) {   // «сидит на краю» привязана к краю опоры: и из тест-сетки сперва ИДЁТ к краю (на полу край = край экрана)
        if (goSitEdge(now())) { const se = EMOTIONS.find((x) => x.key === 'sit_edge'); say(se ? se.emo + ' ' + se.name : 'sit_edge', 1600); return; }
        // в воздухе — обычной позой на месте (упадёт и покажет)
      }
      if (st === 'eat' && CAT_SETS.eat) {             // еда и из тест-сетки — полный цикл с костью в конце (кость всегда завершает анимацию)
        playEatCycle();
        const ee = EMOTIONS.find((x) => x.key === 'eat'); say(ee ? ee.emo + ' ' + ee.name : 'eat', 1600);
        return;
      }
      playEmote(st, 3400);                       // через playEmote: в полёте эмоция ОТЛОЖИТСЯ до приземления (иначе поза зависает в воздухе)
      const e = EMOTIONS.find((x) => x.key === st); say(e ? e.emo + ' ' + e.name : st, 1600);
      return;
    }
    if (kind === 'fire') {                       // тест ОГНЕННОЙ формы (как при скачивании): стоит и горит ~3.4с
      startDownloading();
      if (dlHoldT) clearTimeout(dlHoldT);
      dlHoldT = setTimeout(() => { dlHoldT = null; setDownloading(false); }, 3400);
      say(tr().sFire, 1800); return;
    }
    if (kind === 'watch') {                      // тест «смотрит видео»: идёт в низ-центр, садится, смотрит ~5с (как при реальном видео)
      watchTestUntil = now() + 5000; watchDismissed = false; setWatching(true);
      setTimeout(refreshWatching, 5060);         // по истечении окна вернёмся к реальному состоянию (играет ли видео)
      say(tr().sCinema, 1800); return;
    }
    if (kind === 'jump') {                       // прыжок на месте
      if (!engine.jumpUp(now())) engine.testHop(now(), 95);   // как в живом платформере: на достижимую полку ВЫШЕ; некуда -> подпрыг на месте
      testKind = 'jump'; testUntil = now() + PLAT_JUMP_MS + 60; return;
    }
    testKind = kind; testUntil = now() + 2600;
    if (kind === 'wave') { setMode('happy'); happyUntil = testUntil; say(pick(SP('idle')), 1600); }
    else if (kind === 'climb') { climbing = true; say(pick(SP('climb')), 1600); }
    else if (kind === 'idle') { setMode('idle'); }
    else { say(testDir < 0 ? tr().sGoLeft : tr().sGoRight, 1400); }
  }
  function runTest(t, dt) {
    if (testKind === 'emo') {                     // эмоция-поза: НИКАКОГО движения, но едем за своей полкой при прокрутке (иначе поза отрывается от блока)
      rideStandLedge();
      if (standLedge) py = standLedge.y - PET_H;
      return;
    }
    if (testKind === 'jump') { updateJump(t); return; }
    if (testKind === 'run') {                     // настоящий бег: forceRunUntil держит бег, platformerTick роняет с края блока и приземляет
      if (standLedge) {                            // на опоре: цель — дальний край по направлению (после приземления бежит дальше), разворот только у края экрана
        if (px <= 2) testDir = 1; else if (px >= window.innerWidth - PET_W - 2) testDir = -1;
        walkTargetX = testDir > 0 ? window.innerWidth - PET_W : 0;
      }
      platformerTick(t, dt);
      return;
    }
    if (testKind === 'pounce') {                    // наскок вперёд: рывок по горизонтали в пределах текущей полки (или экрана), разворот у края
      const sp = SPEED * userSpeed * RUN_MUL;
      const lo = standLedge ? standLedge.x1 : 0, hi = (standLedge ? standLedge.x2 : window.innerWidth) - PET_W;
      px += testDir * sp;
      if (px <= lo) { px = lo; testDir = 1; } else if (px >= hi) { px = hi; testDir = -1; }
      face = testDir;
      return;
    }
    if (testKind === 'left' || testKind === 'right') {
      face = testDir; px = clamp(px + testDir * SPEED * userSpeed * 1.3, 0, window.innerWidth - PET_W);
    } else if (testKind === 'climb') {
      climbing = true; py = clamp(py - 0.9, 0, window.innerHeight - PET_H);
    }
    // wave/idle — поза держится через mode/anim, двигаться не нужно
  }

  // ---------- главный цикл ----------
  function tick() {
    if (!Yasia.storage.alive()) { cleanup(); return; }
    requestAnimationFrame(tick);
    if (!enabled) return;
    if (document.hidden) return;

    const t = now();
    const dt = lastTick ? Math.min(t - lastTick, 64) : 16; lastTick = t;

    if (sayUntil && t > sayUntil) { bubble.classList.remove('show', 'talk'); sayUntil = 0; }
    if (busy) { render(); return; }

    if (location.href !== lastHref) { lastHref = location.href; if (gameActive) { try { Yasia.events.emit('game:stop'); } catch (_) {} } resetToWander(); }

    runMul = running ? RUN_MUL : 1;
    if (testKind && t >= testUntil && !jumping) { testKind = null; climbing = false; running = false; forceRunUntil = 0; walkTargetX = px; }   // конец теста: сбрасываем бег и флаг превью, встаём на месте (общие таймеры не трогали)

    if (dragging) {
      px = clamp(mouseX - dragOffX, 0, window.innerWidth - PET_W);
      py = clamp(mouseY - dragOffY, 0, window.innerHeight - PET_H);
      if (Math.hypot(px - grabPx, py - grabPy) > 5) { didDrag = true; if (hiding) unhide(); if (watching && watchArrived) { watchDismissed = true; setWatching(false); addMoodBias(-15); saveCare(); pendingMad = true; } }   // потащили: спрятанную -> вылезает; СИДЯЩУЮ от кино -> падает настроение, больше не подходит, и ЗЛИТСЯ на отпускании (pendingMad). Просящую подсадить — тащим к видео (помощь, не прогон)
      const fdt = Math.max(dt, 1) / 16;                  // нормируем к кадру 16мс
      const ivx = (px - lastDragX) / fdt, ivy = (py - lastDragY) / fdt;
      dragVx = dragVx * 0.4 + ivx * 0.6;                 // отзывчивее — ловим даже быстрый лёгкий флик
      dragVy = dragVy * 0.4 + ivy * 0.6;
      peakVx = Math.abs(ivx) > Math.abs(peakVx) ? ivx : peakVx * 0.85;   // пик скорости кисти (чтобы лёгкий толчок не терялся в сглаживании)
      peakVy = Math.abs(ivy) > Math.abs(peakVy) ? ivy : peakVy * 0.85;
      lastDragX = px; lastDragY = py;
    } else if (paused) {                                 // ⏸ пауза: стоит на месте; перетаскивание и явные клики работают, автодействия спят
      if (mode === 'happy' && t > happyUntil) setMode('idle');
    } else if (gameActive) {                             // идёт мини-игра -> ведём питомца к игровой цели и шлём 'game:tick' (логика в systems/games.js)
      gameTick(t, dt);
    } else if (downloading) {                            // качается видео -> стоит на месте и горит (огненная форма)
      if (mode === 'happy' && t > happyUntil) setMode('idle');
    } else if (watching && watchAnim() && !thrown && !(testKind === 'emo' && t < testUntil) && !dialog.classList.contains('show')) {     // играет видео -> идёт/лезет под него и смотрит; застряв — просит подсадить. РЕАЛЬНЫЙ бросок (thrown) не перехватываем; ЭМОЦИЯ доигрывает СТОЯ; открытый ДИАЛОГ важнее кино (иначе облачко уезжает за ней — текст не почитать)
      thrown = false; vx = 0;                            // (страховка) мягко поставленную у видео не отшвыриваем вбок
      if (mode === 'happy' && t > happyUntil) setMode('idle');   // сброс радости-приветствия и в походе к видео: иначе wave (выше ходьбы в кадрах) залипает — «машет и едет»
      const wasClimbing = watchClimbing;                 // детект ВХОДА в режим лазания (сброс ниже стирает флаг каждый кадр)
      watchClimbing = false;                             // включается только в ветке лазания ниже (иначе обычный платформер не лезет целенаправленно)
      const v = playingVideo();
      const isTest = t < watchTestUntil;                 // ручной тест без реального видео
      let tX = 0, tY = 0, vcx = 0, vBottom = 0, hasVid = false, reachable = true;
      if (v) {
        const r = v.getBoundingClientRect(); hasVid = true; vcx = r.left + r.width / 2; vBottom = r.bottom;
        if (v !== watchVid) { watchVid = v; watchArrived = false; watchHelp = false; watchHelpSayT = 0; watchStuck = false; watchStuckT = 0; watchClimbing = false; }   // сменилось целевое видео -> заново оценить достижимость (не телепортироваться к новому со старым «дошла»)
        tX = clamp(vcx - PET_W / 2, 0, window.innerWidth - PET_W);
        tY = clamp(r.bottom - PET_H, 0, window.innerHeight - PET_H);
        const floorPy = window.innerHeight - PLAT_FLOOR - PET_H;
        const standPy = (standLedge && !falling) ? standLedge.y - PET_H : py;   // мой текущий уровень ног (полка под ногами, иначе ТЕКУЩЕЕ положение — не пол: иначе reachable дёргается покадрово, когда reachable-ветка зануляет standLedge -> спин)
        reachable = tY >= Math.min(standPy, floorPy) - PLAT_JUMP_UP * 1.3;   // низ видео в пределах прыжка от ПОЛА или от ТЕКУЩЕЙ полки -> подходит вбок и допрыгивает (уже на высоте видео -> не лезет дальше и не просит подсадить); высоко над головой -> лезет по полкам вверх
      } else if (isTest) { tX = clamp((window.innerWidth - PET_W) / 2, 0, window.innerWidth - PET_W); tY = window.innerHeight - PET_H - 6; }   // тест без видео -> низ-центр экрана
      const sp = SPEED * userSpeed * 2.6;
      if (watchArrived) {                                // села под видео -> держимся под ним (едем за скроллом)
        watchHelp = false;
        if (hasVid) { px = tX; py = tY; }                // ре-пин только когда видео есть; во время буфера/паузы держим позицию, не телепортируемся к центру
        face = 1; running = false; standLedge = null; falling = false; jumping = false; vy = 0;
        if (mode === 'happy' && t > happyUntil) setMode('idle');
        if (t > watchMoodT) { watchMoodT = t + 2500; addMoodBias(2); }   // смотрит фильм -> настроение потихоньку растёт
      } else if (!hasVid && !isTest) {                    // видео на миг пропало (буфер/пауза/виртуализация ленты) -> держим позицию, не бежим к центру
        walkTargetX = px; nextJumpDecide = Math.max(nextJumpDecide, t + 800);   // замри на месте: не блуждать и не лезть, пока видео не вернётся
        platformerTick(t, dt);                            // стоит на опоре/падает на пол; гистерезис 1400мс сам выключит, если видео встало
      } else if (!reachable) {                            // не достать с пола -> ЛЕЗЕТ к видео по полкам ВВЕРХ (ходьба/прыжки с полки на полку/лазание/падение — всё по физике и дистанции)
        watchClimbCx = hasVid ? vcx : (window.innerWidth / 2);
        watchClimbY = hasVid ? vBottom : (window.innerHeight - PLAT_FLOOR);   // целевой уровень ног = ИСТИННЫЙ нижний край видео (не клампленный)
        if (!wasClimbing) { walkTargetX = px; nextJumpDecide = 0; watchFromEl = null; watchPingT = 0; }   // ВХОД в лазание: первый поиск пути сразу, чистый маршрут
        watchClimbing = true;
        platformerTick(t, dt);                            // целенаправленно идёт/перепрыгивает с полки на полку вверх к видео (watchClimbDecide, BFS) + физика
        const cx2 = px + PET_W / 2, foot2 = py + PET_H;
        if (!jumping && hasVid && Math.abs(cx2 - vcx) <= Math.max(PET_W * 0.6, 70) && Math.abs(foot2 - vBottom) <= Math.max(PET_H * 0.5, 80)) {
          watchArrived = true; watchStuck = false; watchHelp = false;   // долезла под видео (или её поднесли рукой) -> садится (попкорн)
        } else if (watchStuck && standLedge && !jumping && watchStuckT && t - watchStuckT > 900) {
          watchHelp = true;                               // долезла на САМУЮ БЛИЖНЮЮ достижимую полку и застряла НАДОЛГО (дебаунс 900мс отсекает мерцание снимка полок по пути) -> ПРОСИТ подсадить
          if (hasVid) walkTargetX = clamp(vcx - PET_W / 2, standLedge.x1, standLedge.x2 - PET_W);   // сперва дойти НОГАМИ (walk) под видео по своей полке, просить уже оттуда (а не застывать где попало)
          if (hasVid) face = vcx < cx2 ? -1 : 1;          // смотрит в сторону видео
          if (t > watchHelpSayT) { watchHelpSayT = t + 6000; say(pick(SP('lift')), 2200); }   // изредка просит подсадить (троттл)
        } else {
          watchHelp = false;                              // ещё идёт/прыгает по полкам -> поза ходьбы/прыжка, НЕ просит
        }
      } else {                                            // достижимо -> идёт под видео (ходьба) + ДОПРЫГИВАЕТ дугой/падает, БЕЗ всплытия вверх
        watchHelp = false;
        if (jumping) { updateJump(t); }                   // завершает дугу «допрыгивания» к нижнему краю видео
        else {
          const adx = tX - px;
          if (Math.abs(adx) > 4) { px += clamp(adx, -sp, sp); face = adx < 0 ? -1 : 1; }   // идёт по горизонтали под видео
          if (py < tY - 2) { vy = Math.min(vy + PLAT_GRAVITY, 26); py = Math.min(py + vy, tY); falling = py < tY - 2; }   // выше цели -> падает вниз (гравитация)
          else if (py > tY + 2 && Math.abs(adx) <= PLAT_JUMP_DX) { startJump({ el: null, x1: tX, x2: tX + PET_W, y: tY + PET_H }, vcx, t); }   // ниже цели в пределах прыжка -> ДОПРЫГИВАЕТ (дуга прыжка), не всплывает
          else { vy = 0; falling = false; }
          standLedge = null;
          if (Math.abs(adx) <= 4 && Math.abs(py - tY) <= 3) watchArrived = true;   // дошла/допрыгнула под видео -> садится
        }
      }
    } else if (dialog.classList.contains('show')) {      // окно открыто -> Яся замерла, не ходит
      if (mode === 'happy' && t > happyUntil) setMode('idle');
    } else if (hiding && !thrown) {                      // «спрятана» — стоит, ждёт пока позовут/кликнут (но брошенную пускаем в физику)
      if (mode === 'happy' && t > happyUntil) setMode('idle');
    } else if (thrown) {
      platformerTick(t, dt);                             // летит по инерции и падает, пока не приземлится
    } else if (testKind && t < testUntil) {
      runTest(t, dt);
    } else if (!roam) {
      if (mode === 'happy' && t > happyUntil) setMode('idle');
      // стоит на месте (ходьба выключена в настройках); только перетаскивание
    } else if (mode === 'happy') {
      if (t > happyUntil) { bubble.textContent = '❤?'; bubble.classList.remove('show'); setMode('idle'); }
    } else {
      platformerTick(t, dt);            // живёт по структуре страницы: стоит на элементах, прыгает по полкам
      if (t > nextChatter) { nextChatter = t + 9000 + Math.random() * 12000; if (!Yasia.guard || Yasia.guard.allows('chatter')) say(Math.random() < 0.32 ? pick(SP('event')) : pick(SP('idle')), 2000); }   // болтовня — по режиму (страж)
    }

    if (!paused) {
      careTick(t, dt);    // статы: затухание/восстановление, амбиент, авто-сохранение, реплики по состоянию
      popcornTick(t);     // пока играет видео — поток зёрнышек попкорна (вылетают, падают, лежат ~2с, тают)
      heartTick(t);       // пока играет ласка/гордость — поток сердечек (всплывают, тают)
    }

    // голодный — иногда просит мяса
    if (!paused && !busy && mode !== 'happy' && currentHunger() > 78 && Math.random() < 0.003) {
      bubble.textContent = '🍖'; bubble.classList.add('show');
      setTimeout(() => { if (bubble.textContent === '🍖') bubble.classList.remove('show'); }, 1600);
    }

    // сквош-приземление: следим за пиком высоты полёта; глубокое падение -> короткий land (присед + пыль из манифеста)
    const airNow = thrown || falling || jumping;
    if (airNow) fellPeakY = (fellPeakY == null) ? py : Math.min(fellPeakY, py);
    else {
      if (fellPeakY != null) {
        const dropPx = py - fellPeakY;
        if (dropPx > 240 && CAT_SETS.land && !gameActive && !watching && !dragging && !busy && t > testUntil) playEmote('land', 640);
        fellPeakY = null;
      }
      if (pendingEmote && !dragging && !paused && t >= testUntil) {   // отложенная эмоция играет ТОЛЬКО на земле (и после сквоша land) — падение в приоритете
        const pe = pendingEmote; pendingEmote = null;
        if (pe.emo === 'sit_edge') goSitEdge(t);                      // «сидит на краю» и после приземления привязана к краю опоры, не к точке приземления
        else if (pe.emo === 'eat' && CAT_SETS.eat) playEatCycle();    // еда и после приземления играет полным циклом с костью в конце
        else playEmote(pe.emo, pe.ms);
        if (pe.line) say(pe.line, pe.sayMs || 1900);
      }
    }
    updateHop();
    if (isFramed() && dragging && CAT_SETS.drag) {   // несут «за шкирку» -> кадры болтающихся ног (иначе — прежний замерший idle)
      const dm = emoMs('drag') || 170;
      if (catAct !== 'drag') { catAct = 'drag'; catIdx = 0; catStep = 0; showFrame(CAT_SETS.drag[0]); lastFrameT = t; }
      else if (CAT_SETS.drag.length > 1 && t - lastFrameT > dm) { lastFrameT = t; catIdx = (catIdx + 1) % CAT_SETS.drag.length; showFrame(CAT_SETS.drag[catIdx]); }
    }
    if (isFramed() && !dragging) {        // переключаем слой-кадр по состоянию (без смены src -> без мерцания)
      const mv = pet.classList.contains('is-moving');
      let setName, ms;
      if (downloading) { const hasFire = !!CAT_SETS.fire; setName = hasFire ? 'fire' : 'angry'; ms = hasFire ? CAT_FIRE_MS : emoMs('angry'); }   // качается видео -> огненная форма у героя с fire в манифесте, иначе злость
      else if (testKind === 'pounce' && t < testUntil) { setName = 'pounce'; ms = emoMs('pounce') / userSpeed; }   // наскок в движении: кадры pounce, пока летит рывок вперёд
      else if (testKind === 'emo' && t < testUntil) { setName = testEmo; ms = emoMs(testEmo) / userSpeed; }   // тест/действие эмоции (скорость — общий ползунок)
      else if (watching && watchAnim() && watchArrived) { setName = watchAnim(); ms = emoMs(setName); }   // села под видео -> попкорн (выше mv: не мигает ходьбой при езде за скроллом)
      else if (thrown && CAT_SETS.tumble) { setName = 'tumble'; ms = emoMs('tumble'); }   // бросили -> кувырок в полёте (спрайт из манифеста)
      else if (jumping && engine.isPounce() && CAT_SETS.pounce) { setName = 'pounce'; ms = emoMs('pounce'); }   // наскок к высокой полке -> кадры pounce
      else if (jumping && !engine.isDrop()) { setName = 'jump'; ms = CAT_JUMP_MS; }   // дуга прыжка вверх/вбок (ВЫШЕ happy: иначе «помочь» не покажет прыжок)
      else if (falling || jumping) { setName = 'fall'; ms = CAT_FALL_MS; }     // падение ИЛИ спуск-дроп (jumpDrop): кадры падения. У Яси fall=1 кадр (поза climb) — НАМЕРЕННО, не «подключать» fall0-4
      else if (mode === 'happy') { setName = happyKind; ms = happyKind === 'wave' ? CAT_WAVE_MS : emoMs('happy'); }  // радость: подпрыг (happy) или приветствие (wave)
      else if (climbing && mv) { setName = 'climb'; ms = CAT_CLIMB_MS; }   // лезет вверх
      else if (mv) { setName = (running ? 'run' : 'walk'); ms = (running ? CAT_RUN_MS : CAT_WALK_MS) / userSpeed; }   // бег -> кадры бега; медленнее идёт -> медленнее кадры
      else if (watching && watchHelp) { setName = 'wave'; ms = CAT_WAVE_MS; }   // долезла на ближнюю полку, дальше прыжка к видео нет -> машет/просит подсадить (НИЖЕ ходьбы/прыжка/падения -> в движении не показывается)
      else if (ambientEmo) { setName = ambientEmo; ms = emoMs(ambientEmo); }   // стоит -> поза по состоянию (спит/голод/грусть/злость)
      else { setName = 'idle'; ms = CAT_IDLE_MS; }
      const frames = CAT_SETS[setName] || CAT_SETS.idle;   // фолбэк на idle, если манифест героя не содержит запрошенную анимацию (не падаем)
      if (frames) {
        sprite.classList.toggle('xf', !!EMO_XFADE[setName]);       // кросс-фейд кадров — только для эмоций-поз
        if (catAct !== setName) { catAct = setName; catIdx = 0; catStep = 0; showFrame(frames[0]); lastFrameT = t; }
        else if (setName === 'jump' && jumping && frames.length > 1) {        // прыжок: кадр привязан к ФАЗЕ дуги, а не к таймеру
          const jk = engine.jumpPhase(t);                                     // присед -> взлёт -> апекс -> спуск (фаза дуги — у движка)
          const ji = Math.min(frames.length - 1, jk < 0.18 ? 0 : jk < 0.5 ? 1 : jk < 0.82 ? 2 : 3);
          if (ji !== catIdx) { catIdx = ji; showFrame(frames[ji]); }
        }
        else if (frames.length > 1 && !STATIC_HOLD[setName] && t - lastFrameT > ms) {   // STATIC_HOLD (покой) -> держим кадр[0], не циклим: «одна картинка», живёт за счёт CSS-дыхания
          lastFrameT = t;
          if (PING_PONG[setName]) {                                           // туда-обратно: 0..n-1..1 -> бесшовный цикл «начало->пик->начало»
            const period = 2 * (frames.length - 1);
            catStep = (catStep + 1) % period;
            catIdx = catStep < frames.length ? catStep : period - catStep;
          } else catIdx = (catIdx + 1) % frames.length;
          showFrame(frames[catIdx]);
        }
      }
      // РАДОСТЬ — подпрыгивает на месте (пружинистый хоп поверх кадров happy; hopY рисуется в render). И в тесте, и в реальной happy-ветке.
      const happyHop = (testKind === 'emo' && testEmo === 'happy' && t < testUntil) || (mode === 'happy' && happyKind === 'happy' && !jumping && !falling);
      if (happyHop) hopY = -Math.abs(Math.sin(t * Math.PI / HAPPY_HOP_MS)) * HAPPY_HOP_PX;
    }
    pet.classList.toggle('is-run', running && pet.classList.contains('is-moving'));
    render();
    if (dialog.classList.contains('show')) positionDialog();   // окно-облачко держится над Ясей
    if (t - lastSave > 700) { lastSave = t; saveState(); }
  }

  // прыжки/«дыхание» — синхронно с движением
  function updateHop() {
    const moved = Math.hypot(px - prevPx, py - prevPy); prevPx = px; prevPy = py;
    const walking = !dragging && moved > 0.4;   // при перетаскивании не «идёт», а болтается
    pet.classList.toggle('is-moving', walking);
    if (isFramed()) { hopY = 0; }        // настоящий цикл ходьбы — процедурный подпрыг убираем (он давал рывки вверх-вниз)
    else if (walking) { hopPhase += moved * 0.35; hopY = -Math.abs(Math.sin(hopPhase)) * 5; }
    else { hopY *= 0.8; if (Math.abs(hopY) < 0.2) hopY = 0; }
  }

  function render() {
    pet.style.transform = `translate(${px.toFixed(2)}px, ${py.toFixed(2)}px)`;   // субпиксель -> без «ступенек» при нецелой скорости
    const s = sizeMul * userScale;
    inner.style.transform = `translateY(${hopY.toFixed(1)}px) scaleX(${(face * s).toFixed(3)}) scaleY(${s.toFixed(3)})`;
    // спрайт растёт вверх от низа — поднимаем облачко над реальной макушкой, чтобы не заслоняло
    bubble.style.marginBottom = (12 + PET_H * Math.max(0, s - 1)).toFixed(0) + 'px';
    if (sign && !sign.hidden) sign.style.marginBottom = (34 + PET_H * Math.max(0, s - 1)).toFixed(0) + 'px';
  }

  // ---------- табличка с кодом входа над Ясей (видна на ЛЮБОЙ странице, т.к. управляется storage; клик — копирует) ----------
  const sign = root.querySelector('#twtr-pet-sign');
  let signCode = '';
  const signL = () => ((tr().lang || 'ru') === 'en')
    ? { ttl: '🔑 Sign-in code', copy: 'click to copy', copied: '✓ copied' }
    : { ttl: '🔑 Код входа', copy: 'клик — копировать', copied: '✓ скопировано' };
  function renderSign(st) {
    const pending = !!(st && st.status === 'pending' && st.userCode && (now() - (st.startedAt || 0) < 15 * 60 * 1000 || !st.startedAt));
    if (pending) {
      const l = signL();
      if (signCode !== st.userCode || sign.hidden) {
        signCode = st.userCode;
        sign.innerHTML = '<span class="twtr-sign-ttl"></span><span class="twtr-sign-code"></span><span class="twtr-sign-hint"></span>';
        sign.querySelector('.twtr-sign-ttl').textContent = l.ttl;
        sign.querySelector('.twtr-sign-code').textContent = st.userCode;
        sign.querySelector('.twtr-sign-hint').textContent = l.copy;
      }
      sign.hidden = false;
    } else {
      if (signCode && st && st.status === 'ok') { bubble.textContent = '🟢'; bubble.classList.add('show'); setTimeout(() => { if (bubble.textContent === '🟢') bubble.classList.remove('show'); }, 1600); }
      signCode = ''; sign.hidden = true;
    }
  }
  if (sign) sign.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!signCode) return;
    const done = () => { const h = sign.querySelector('.twtr-sign-hint'); if (h) { h.textContent = signL().copied; setTimeout(() => { const h2 = sign.querySelector('.twtr-sign-hint'); if (h2) h2.textContent = signL().copy; }, 1500); } };
    try { navigator.clipboard.writeText(signCode).then(done, () => { try { const ta = document.createElement('textarea'); ta.value = signCode; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done(); } catch (_) {} }); }
    catch (_) { try { const ta = document.createElement('textarea'); ta.value = signCode; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done(); } catch (_) {} }
  });
  try { Yasia.storage.localGet({ _codexLogin: null }, (s) => renderSign(s && s._codexLogin)); } catch (_) {}
  try { chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch._codexLogin) renderSign(ch._codexLogin.newValue); }); } catch (_) {}

  // ---------- переход между вкладками ----------
  function saveState() { Yasia.storage.localSet({ [STATE_KEY]: { x: px, y: py, face } }); }
  function restoreState(done) {
    Yasia.storage.localGet({ [STATE_KEY]: null }, (s) => {
      const st = s[STATE_KEY];
      if (st && typeof st.x === 'number') { px = clamp(st.x, 0, window.innerWidth - PET_W - 8); py = clamp(st.y, 0, window.innerHeight - PET_H - 8); tx = px; ty = py; prevPx = px; prevPy = py; if (typeof st.face === 'number') face = st.face; }
      if (done) done();
    });
  }
  function arrive() { render(); if (!isFramed() || firstFrameReady) pet.style.opacity = '1'; else pendingReveal = true; setMode('happy'); happyKind = 'wave'; happyUntil = now() + 700; bubble.textContent = '🟩'; bubble.classList.add('show'); setTimeout(() => { if (bubble.textContent === '🟩') { bubble.classList.remove('show'); bubble.textContent = '❤?'; } }, 1200); }

  // ---------- настройки / игровое состояние ----------
  function applyEnabled() {
    pet.style.display = enabled ? '' : 'none';
    if (enabled) { if (!isFramed() || firstFrameReady) pet.style.opacity = '1'; else pendingReveal = true; }   // не показывать пустой квадрат до загрузки первого кадра
    toggle.classList.toggle('off', !enabled);
    toggle.title = enabled ? tr().ttHide : tr().ttShow;
  }
  toggle.addEventListener('click', (e) => { e.stopPropagation(); enabled = !enabled; applyEnabled(); Yasia.storage.syncSet({ enabled }); });
  applyEnabled();
  applyHero();
  applyRoam();

  const isTwitter = (() => { const h = location.hostname; return h === 'x.com' || h.endsWith('.x.com') || h === 'twitter.com' || h.endsWith('.twitter.com'); })();

  try {
    Yasia.storage.syncGet({ enabled: true, paused: false, hero: 'catgirl', scale: 1, roam: true, walkSpeed: 1, throwPower: 1, yasiaWildMul: 1, yasiaAnimOff: {} }, (s) => { enabled = s.enabled; paused = !!s.paused; hero = (s.hero === 'noema') ? 'catgirl' : s.hero; userScale = s.scale || 1; roam = s.roam; userSpeed = s.walkSpeed || 1; throwMul = (typeof s.throwPower === 'number') ? s.throwPower : 1; wildMul = (typeof s.yasiaWildMul === 'number') ? s.yasiaWildMul : 1; animOff = s.yasiaAnimOff || {}; applyEnabled(); applyHero(); applyScale(); applySpeed(); applyInertia(); applyRoam(); applyPaused(); });
    Yasia.storage.localGet({
      hunger: 0, hungerAt: Date.now(), xp: 0,
      energy: ENERGY_START, energyAt: Date.now(), energyResting: false, bond: BOND_START, bondAt: Date.now(), moodBias: 0, moodBiasAt: Date.now(),
      sick: 0, streak: null,
    }, (s) => {
      hungerBase = s.hunger; hungerAt = s.hungerAt; xp = s.xp;
      energyBase = s.energy; energyAt = s.energyAt; energyResting = !!s.energyResting; bondBase = s.bond; bondAt = s.bondAt; moodBiasBase = s.moodBias; moodBiasAt = s.moodBiasAt;
      sickAt = s.sick || 0;
      resting = energyResting;   // восстанавливаем флаг покоя -> гистерезис и setEnergyResting примирят знак корректно
      applyAbilities(); setAmbient(computeAmbient());
      // ежедневный стрик: первый визит дня -> «День N вместе» + XP-бонус (растёт со стриком до потолка)
      const day = new Date(); const dayStr = day.toISOString().slice(0, 10);
      const yest = new Date(day.getTime() - 86400000).toISOString().slice(0, 10);
      const st = s.streak || { count: 0, last: '' };
      if (st.last !== dayStr) {
        const count = st.last === yest ? st.count + 1 : 1;
        Yasia.storage.localSet({ streak: { count, last: dayStr } });
        if (count > 1 && STREAK) {
          gainXp(Math.min(STREAK.xpPerDay * count, STREAK.xpCap));
          setTimeout(() => {   // даём спрайту загрузиться, потом празднуем стрик
            playEmote(CAT_SETS.levelup ? 'levelup' : 'happy', 2400);
            say((tr().sStreak || '🔥 День {n} вместе!').replace('{n}', count), 2600);
          }, 4200);
        }
      }
    });
    Yasia.storage.onChanged((ch) => {
      if (ch.enabled) { enabled = ch.enabled.newValue; applyEnabled(); }
      if (ch.paused) { paused = !!ch.paused.newValue; applyPaused(); }
      if (ch.hero) { hero = (ch.hero.newValue === 'noema') ? 'catgirl' : ch.hero.newValue; applyHero(); }
      if (ch.scale) { userScale = ch.scale.newValue || 1; applyScale(); }
      if (ch.walkSpeed) { userSpeed = ch.walkSpeed.newValue || 1; applySpeed(); }
      if (ch.throwPower) { throwMul = (typeof ch.throwPower.newValue === 'number') ? ch.throwPower.newValue : 1; applyInertia(); }
      if (ch.roam) { roam = ch.roam.newValue; applyRoam(); }
      if (ch.xp) {
        const prev = level;
        xp = ch.xp.newValue; applyAbilities();
        if (level > prev) setTimeout(levelUp, ch.feedPing ? 1300 : 200); // после жевания, если кормили
      }
      if (ch.hunger) hungerBase = ch.hunger.newValue;
      if (ch.hungerAt) hungerAt = ch.hungerAt.newValue;
      if (ch.energy) energyBase = ch.energy.newValue;
      if (ch.energyAt) energyAt = ch.energyAt.newValue;
      if (ch.energyResting) energyResting = ch.energyResting.newValue;
      if (ch.bond) bondBase = ch.bond.newValue;
      if (ch.bondAt) bondAt = ch.bondAt.newValue;
      if (ch.moodBias) moodBiasBase = ch.moodBias.newValue;
      if (ch.moodBiasAt) moodBiasAt = ch.moodBiasAt.newValue;
      if (ch.sick) { sickAt = ch.sick.newValue || 0; nextAmbient = 0; }   // болезнь/лечение из другой вкладки/попапа
      if (ch.yasiaWildMul) wildMul = (typeof ch.yasiaWildMul.newValue === 'number') ? ch.yasiaWildMul.newValue : 1;   // ползунок вредности (попап)
      if (ch.yasiaAnimOff) animOff = ch.yasiaAnimOff.newValue || {};      // тумблеры анимаций (попап)
      if (ch.feedPing) feedEat();   // покормили из попапа (статы попап уже записал -> придут своими ключами выше)
      if (ch.yasiaCareSignal && ch.yasiaCareSignal.newValue) {            // сигнал заботы из попапа: {act:'pet'|'play'|'wake', ts}
        const sig = ch.yasiaCareSignal.newValue;                          // статы попап УЖЕ записал (придут ключами выше) -> здесь ТОЛЬКО реакция, без повторного ACT_*
        if (sig.act === 'pet') playEmote('pet_purr', 2200);
        else if (sig.act === 'play') {                                    // как в doPlay: наскок = рывок в движении; в воздухе — отложенная эмоция после приземления
          if (CAT_SETS.pounce && !thrown && !falling && !jumping) startPounce();
          else playEmote(CAT_SETS.pounce ? 'pounce' : 'like_proud', 2600);
        }
        else if (sig.act === 'wake') { awakeUntil = now() + 20000; nextAmbient = 0; playEmote('wake', 2400); }   // окно бодрости + мгновенный пересчёт ambient (снимает гистерезис сна)
      }
    });
  } catch (_) {}

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = now(); awayAt = Date.now(); saveState(); saveCare(); }
    else {
      if (hiddenAt) { const d = now() - hiddenAt; hiddenAt = 0; happyUntil += d; wanderUntil += d; }
      const away = awayAt ? Date.now() - awayAt : 0; awayAt = 0;
      pet.style.opacity = '0'; restoreState(arrive);
      setAmbient(computeAmbient());
      if (away > GREET_AWAY_MS && currentBond() >= BOND_FRIEND) {   // соскучилась — приветствует (только при доверии)
        setTimeout(() => { unhide(); setMode('happy'); happyKind = 'wave'; happyUntil = now() + 1600; say(pick(SP('greet')), 2400); }, 1400);
      }
    }
  });

  window.addEventListener('resize', () => { px = clamp(px, 0, window.innerWidth - PET_W - 8); py = clamp(py, 0, window.innerHeight - PET_H - 8); });

  window.addEventListener('mousemove', (e) => {
    mouseX = e.clientX; mouseY = e.clientY;
  });

  // ---------- системы-плагины (см. src/core/registry.js + src/systems/*) ----------
  // pet.js — оркестратор: раздаёт системам общий контекст и стартует те, чей флаг включён.
  // Добавить фичу = новый файл systems/* + флаг; сломанная система гасит свой флаг и НЕ роняет питомца.
  // API над питомцем для мини-игр (systems/games.js): только то, что играм можно трогать (без доступа к внутренностям)
  const petApi = {
    claim: gameClaim, release: gameRelease,                 // забрать/вернуть управление питомцем
    active: () => gameActive, id: () => gameId,
    walkTo: (x, run) => { gameClimb = false; gameTargetX = clamp(x, 0, window.innerWidth - PET_W); gameRun = !!run; },   // наземная ходьба к X
    climbTo: (x, y) => { gameClimb = true; gameClimbCx = x; gameClimbY = y; },   // лезть по полкам к точке (запрыгнуть к высокому курсору)
    stop: () => { gameClimb = false; gameTargetX = px; gameRun = false; },   // встать на месте
    hop: (x) => { if (jumping) return; const fy = window.innerHeight - PLAT_FLOOR; startJump({ el: null, floor: true, x1: 0, x2: window.innerWidth, y: fy }, clamp(x, 0, window.innerWidth), now()); },   // баллистический прыжок к X с возвратом на пол (стомп зомби)
    airborne: () => jumping || falling,                     // в прыжке/падении (окно для стомпа)
    ground: (on) => { gameFloor = on !== false; },          // false -> позицию ведёт игра вручную (прятки за элементами)
    place: (x, y) => { px = clamp(x, 0, window.innerWidth - PET_W); py = clamp(y, 0, window.innerHeight - PET_H); },   // поставить вручную (только при ground(false))
    appear: (on) => { pet.style.opacity = on ? '1' : '0'; pet.style.pointerEvents = on ? '' : 'none'; },   // спрятать/показать спрайт (прятки)
    pos: () => ({ x: px, y: py, w: PET_W, h: PET_H, cx: px + PET_W / 2, cy: py + PET_H / 2 }),
    cursor: () => ({ x: mouseX, y: mouseY }),
    face: (d) => { face = d < 0 ? -1 : 1; },
    say: (txt, ms) => say(txt, ms),
    emote: (emo, ms) => playEmote(emo, ms),
    happy: (ms) => { setMode('happy'); happyUntil = now() + (ms || 1000); },
    particles: (c, n) => spawnParticles(c, n),
    addXp: (n) => gainXp(n),                                // XP -> onChanged сам покажет левелап
    addMood: (d) => { addMoodBias(d); saveCare(); },
    addHunger: (d) => { addHunger(d); saveCare(); },
    stats: () => ({ level, xp, mood: currentMood(), hunger: currentHunger(), energy: currentEnergy() }),
    root, vw: () => window.innerWidth, vh: () => window.innerHeight,
  };
  const yasiaCtx = {
    root, storage: Yasia.storage, events: Yasia.events,
    config: (window.Yasia && Yasia.config) || {},
    tr, say, hero: () => hero, pet: petApi,
  };
  try {
    if (Yasia.systems) {
      Yasia.systems.watchFlags();   // вкл/выкл флага в рантайме -> старт/стоп системы
      if (Yasia.flags) Yasia.flags.load(() => Yasia.systems.boot(yasiaCtx));
      else Yasia.systems.boot(yasiaCtx);
    }
  } catch (_) {}

  pickWanderTarget();
  nextMischief = now() + 9000 + Math.random() * 8000;
  if (document.visibilityState === 'visible') { pet.style.opacity = '0'; restoreState(arrive); }
  requestAnimationFrame(tick);
})();
