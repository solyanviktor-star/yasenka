// Единый источник правды — core/config.js (подключён в popup.html перед этим скриптом).
// Берём значения оттуда; дефолты-фолбэк на случай, если конфиг не загрузился.
const CFG = (window.Yasia && window.Yasia.config) || {};
const num = (v, d) => (typeof v === 'number' ? v : d);
const HUNGER_PER_MIN = num(CFG.HUNGER_PER_MIN, 1.4);
const FEED_AMOUNT = num(CFG.FEED_AMOUNT, 34);
const FEED_XP = num(CFG.FEED_XP, 12);
const LEVEL_XP = CFG.LEVEL_XP || [0, 40, 120, 280, 550, 950, 1500, 2200, 3100, 4200];
const MAX_LEVEL = num(CFG.MAX_LEVEL, 10);
const ENERGY_REST_MIN = num(CFG.ENERGY_REST_MIN, 0.45), ENERGY_SLEEP_MIN = num(CFG.ENERGY_SLEEP_MIN, 30), BOND_DECAY_MIN = num(CFG.BOND_DECAY_MIN, 0.05);
const MOOD_BASE = num(CFG.MOOD_BASE, 55), MOOD_BIAS_DECAY_MIN = num(CFG.MOOD_BIAS_DECAY_MIN, 3.5), MOOD_HUNGER_K = num(CFG.MOOD_HUNGER_K, 0.6), MOOD_ENERGY_K = num(CFG.MOOD_ENERGY_K, 0.5), MOOD_BOND_K = num(CFG.MOOD_BOND_K, 0.15), MOOD_BIAS_MAX = num(CFG.MOOD_BIAS_MAX, 45);
const FEED_ENERGY = num(CFG.ACT_FEED && CFG.ACT_FEED.energy, 5), FEED_BOND = num(CFG.ACT_FEED && CFG.ACT_FEED.bond, 3), FEED_MOOD = num(CFG.ACT_FEED && CFG.ACT_FEED.mood, 10);
// пороги состояния — те же, по которым живёт pet.js (computeAmbient), чтобы бейдж в попапе не расходился со страницей
const HUNGER_HUNGRY = num(CFG.HUNGER_HUNGRY, 55), HUNGER_STARVING = num(CFG.HUNGER_STARVING, 82), MOOD_GOOD = num(CFG.MOOD_GOOD, 62), MOOD_BAD = num(CFG.MOOD_BAD, 38), ENERGY_WAKE = num(CFG.ENERGY_WAKE, 65);
// эффекты действий заботы — общие с pet.js (config ACT_*), чтобы попап и облачко «Забота» качали статы одинаково
const ACT = { pet: CFG.ACT_PET || { mood: 14, bond: 5, xp: 2 }, play: CFG.ACT_PLAY || { mood: 20, energy: -12, hunger: 6, bond: 7, xp: 6 }, wake: CFG.ACT_WAKE || { energy: 4 } };
const ACT_COOLDOWN_MS = num(CFG.ACT_COOLDOWN_MS, 1000);

const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const levelFromXp = (x) => { let lv = 1; for (let i = 0; i < LEVEL_XP.length; i++) if (x >= LEVEL_XP[i]) lv = i + 1; return lv; };

// ---------- локализация (единый язык с окном Яси: storage.sync 'dlgLang') ----------
const P = {
  ru: { title: '🟩 Твиттер-Питомец', enabled: 'Питомец включён', hero: 'Герой:', lvl: 'Ур.', maxAb: 'макс. способности ✨', abHint: '+скорость +размер', max: '(макс.)', xp: 'Опыт', hunger: 'Голод', mood: 'Настроение', energy: 'Энергия', bond: 'Привязанность', feed: 'Покормить мясом', hint: 'Голод растёт со временем. Заботься о питомце — корми, гладь, играй: он меняется от твоего отношения. Клик по питомцу открывает меню «Забота».', ai: 'ИИ-мозг', aiOn: 'Подключено', aiOff: 'Не настроен', connect: '⚙ Подключить ИИ', cfgUrl: 'Адрес API', cfgKey: 'API-ключ', cfgModel: 'Модель', test: 'Проверить связь', save: 'Сохранить', testing: 'Проверяю…', ok: '🟢 Связь есть', modelsLoaded: '🟢 Загружено моделей: {n}', fail: 'Не вышло', saved: '✓ Сохранено', hintHermes: 'Включи в Hermes канал «API server», задай API_SERVER_KEY, впиши адрес и ключ.', hintGpt: 'Прямое подключение к OpenAI: вставь ключ sk-…. Хранится локально, не синкается.', hintOther: 'Любой OpenAI-совместимый провайдер (OpenRouter, Groq, DeepSeek, Together, свой эндпоинт…). Выбери из списка или впиши адрес и ключ. Ключ хранится локально, не синкается.', provOther: 'Другой', lbPreset: 'Провайдер', pickModel: '— выбрать модель —', customModel: '✎ Своя модель…', getKey: '🔑 Где взять ключ ↗', langBtn: 'EN', dev: '🛠 Разработчик', devLedges: 'Подсветка полок', devLedgesHint: 'Показывает на странице, как Яся видит полки: оранжевая — стоит тут, зелёные — допрыгнет отсюда, жёлтые — допрыгнет с края полки (маршрут), красные — видит, но не достать, синяя — пол.', amSub: 'Подписка ChatGPT', amKey: 'API-ключ', signinBtn: 'Войти через ChatGPT', signedReauth: 'Войти заново', signedIn: '🟢 Вход выполнен', signinStart: 'Запрашиваю код…', signinCode: 'Открой страницу и введи код:', signinFail: 'Не вышло войти', signinTimeout: 'Время вышло — попробуй ещё раз', hintSub: 'Вход твоим аккаунтом ChatGPT (подписка). Откроется страница OpenAI — введи код. ⚠️ Неофициальный путь: возможен отказ Cloudflare и риск для аккаунта. Если не работает — через Hermes.', paused: 'Пауза (замереть на месте)', flags: '🧩 Способности', flagsHint: 'Действует сразу: выключенная способность останавливается прямо на странице. Сломанная фича гаснет сама.', flagNames: { tamagotchi: 'Тамагочи (голод/энергия)', mediaDownload: 'Скачивание медиа', notes: 'Заметки', aiAssistant: 'ИИ-помощник', skills: 'Навыки', memory: 'Память', games: 'Мини-игры', replier: 'Автореплаер (черновики ответов)' }, backup: '💾 Резервная копия', exportBtn: 'Экспорт', importBtn: 'Импорт', backupHint: 'JSON со статами, заметками, памятью и настройками. Ключи ИИ (yasiaAI) не выгружаются.', expOk: '✓ Файл сохранён', impOk: '✓ Импортировано', impBad: 'Это не файл резервной копии Яси' },
  en: { title: '🟩 Twitter-Pet', enabled: 'Pet enabled', hero: 'Character:', lvl: 'Lv.', maxAb: 'max abilities ✨', abHint: '+speed +size', max: '(max)', xp: 'XP', hunger: 'Hunger', mood: 'Mood', energy: 'Energy', bond: 'Bond', feed: 'Feed meat', hint: 'Hunger grows over time. Care for the pet — feed, pet, play: it changes with how you treat it. Click the pet to open the «Care» menu.', ai: 'AI brain', aiOn: 'Connected', aiOff: 'Not set up', connect: '⚙ Connect AI', cfgUrl: 'API address', cfgKey: 'API key', cfgModel: 'Model', test: 'Test connection', save: 'Save', testing: 'Testing…', ok: '🟢 Connection OK', modelsLoaded: '🟢 Loaded {n} models', fail: 'Failed', saved: '✓ Saved', hintHermes: 'In Hermes enable the «API server» channel, set API_SERVER_KEY, enter the address and key.', hintGpt: 'Direct OpenAI connection: paste sk-… key. Stored locally, never synced.', hintOther: 'Any OpenAI-compatible provider (OpenRouter, Groq, DeepSeek, Together, your own endpoint…). Pick one or type the address and key. The key is stored locally, never synced.', provOther: 'Other', lbPreset: 'Provider', pickModel: '— pick a model —', customModel: '✎ Custom model…', getKey: '🔑 Get a key ↗', langBtn: 'RU', dev: '🛠 Developer', devLedges: 'Ledge overlay', devLedgesHint: 'Shows how Yasya sees the page: orange — standing here, green — jumpable from her spot, yellow — jumpable from the ledge edge (route), red — visible but unreachable, blue — the floor.', amSub: 'ChatGPT subscription', amKey: 'API key', signinBtn: 'Sign in with ChatGPT', signedReauth: 'Sign in again', signedIn: '🟢 Signed in', signinStart: 'Requesting code…', signinCode: 'Open the page and enter the code:', signinFail: 'Sign-in failed', signinTimeout: 'Timed out — try again', hintSub: 'Sign in with your ChatGPT account (subscription). An OpenAI page opens — enter the code. ⚠️ Unofficial path: Cloudflare may refuse it and there is account risk. If it fails, use Hermes.', paused: 'Pause (freeze in place)', flags: '🧩 Features', flagsHint: 'Applies instantly: a feature you turn off stops right on the page. A broken feature turns itself off.', flagNames: { tamagotchi: 'Tamagotchi (hunger/energy)', mediaDownload: 'Media download', notes: 'Notes', aiAssistant: 'AI assistant', skills: 'Skills', memory: 'Memory', games: 'Mini-games', replier: 'Auto-replier (reply drafts)' }, backup: '💾 Backup', exportBtn: 'Export', importBtn: 'Import', backupHint: 'JSON with stats, notes, memory and settings. AI keys (yasiaAI) are never exported.', expOk: '✓ File saved', impOk: '✓ Imported', impBad: 'Not a Yasya backup file' },
};
// строки редизайна v1.1 (тамагочи-first) — доливаем поверх, чтобы не раздувать исходные словари
Object.assign(P.ru, {
  feed: 'Покормить',
  petName: 'Ясенька',
  state: { sleep: '😴 спит', starving: '🥺 очень голодна', hungry: '🍖 голодна', grumpy: '😾 не в духе', happy: '😺 довольна', ok: '🙂 в порядке' },
  carePet: 'Погладить', carePlay: 'Поиграть', careWake: 'Разбудить',
  mode: 'Режим поведения', modeNormal: '😺 Обычный', modeCalm: '😌 Спокойный',
  wild: 'Вредность', wildL: '😇 тихоня', wildR: '😈 прокудница',
  anims: 'Анимации', animsHint: 'Выключенные анимации не используются в автономной жизни питомца.',
});
Object.assign(P.en, {
  feed: 'Feed',
  petName: 'Yasya',
  state: { sleep: '😴 sleeping', starving: '🥺 starving', hungry: '🍖 hungry', grumpy: '😾 grumpy', happy: '😺 happy', ok: '🙂 fine' },
  carePet: 'Pet', carePlay: 'Play', careWake: 'Wake up',
  mode: 'Behavior mode', modeNormal: '😺 Normal', modeCalm: '😌 Calm',
  wild: 'Mischief', wildL: '😇 saint', wildR: '😈 trickster',
  anims: 'Animations', animsHint: 'Disabled animations are not used in the pet\'s autonomous life.',
});
let lang = 'ru';
const L2 = () => P[lang] || P.ru;

// ---------- конфиг ИИ-мозга (тот же storage.local 'yasiaAI', что читает src/systems/ai.js) ----------
const AICFG = (CFG && CFG.AI) || {};
const LOGOS = AICFG.logos || { hermes: '', gpt: '' };
const PROVIDERS = AICFG.providers || [];   // пресеты для вкладки «Другой» (OpenRouter/Groq/DeepSeek/…)
const PROV_DEF = {
  hermes: { baseUrl: (AICFG.hermes && AICFG.hermes.baseUrl) || 'http://127.0.0.1:8642', apiKey: '', model: (AICFG.hermes && AICFG.hermes.model) || 'hermes-agent' },
  gpt: { baseUrl: (AICFG.gpt && AICFG.gpt.baseUrl) || 'https://api.openai.com', apiKey: '', model: (AICFG.gpt && AICFG.gpt.model) || 'gpt-5.5', authMode: 'chatgpt', chatgpt: { accessToken: '', refreshToken: '', accountId: '' } },
  other: { baseUrl: '', apiKey: '', model: '', presetId: '' },   // «Другой»: любой OpenAI-совместимый (baseUrl+ключ+модель)
};
let aiCfg = { provider: AICFG.provider || 'hermes', sessionKey: AICFG.sessionKey || 'yasia:x', hermes: Object.assign({}, PROV_DEF.hermes), gpt: Object.assign({}, PROV_DEF.gpt), other: Object.assign({}, PROV_DEF.other) };
let aiProv = aiCfg.provider === 'hermes' ? 'gpt' : aiCfg.provider;   // Hermes-вкладки в UI нет -> правим GPT/Other (Hermes = пресет «Nous Portal»)
let aiMode = aiCfg.gpt.authMode || 'chatgpt';   // режим GPT-вкладки: 'chatgpt' (подписка) | 'key'
const liveModels = {};   // модели, реально доступные по ключу (GET /v1/models) — заполняются автозагрузкой/проверкой связи, per-провайдер
let signinTimer = 0;

let hunger = 0, hungerAt = Date.now(), xp = 0;
let energy = 100, energyAt = Date.now(), energyResting = false, bond = 0, bondAt = Date.now(), moodBias = 0, moodBiasAt = Date.now();

const cb = document.getElementById('enabled');
const levelEl = document.getElementById('level');
const abilitiesEl = document.getElementById('abilities');
const xpBar = document.getElementById('xpBar');
const xpText = document.getElementById('xpText');
const hungerBar = document.getElementById('hungerBar');
const hungerText = document.getElementById('hungerText');
const moodBar = document.getElementById('moodBar');
const moodText = document.getElementById('moodText');
const energyBar = document.getElementById('energyBar');
const energyText = document.getElementById('energyText');
const bondBar = document.getElementById('bondBar');
const bondText = document.getElementById('bondText');
const feedBtn = document.getElementById('feed');

const elapsedMin = (at) => (Date.now() - at) / 60000;
function currentHunger() {
  return clamp(hunger + elapsedMin(hungerAt) * HUNGER_PER_MIN, 0, 100);
}
function currentEnergy() { const rate = energyResting ? ENERGY_SLEEP_MIN : -ENERGY_REST_MIN; return clamp(energy + elapsedMin(energyAt) * rate, 0, 100); }
function currentBond() { return clamp(bond - elapsedMin(bondAt) * BOND_DECAY_MIN, 0, 100); }
function currentMoodBias() {
  const dec = elapsedMin(moodBiasAt) * MOOD_BIAS_DECAY_MIN;
  return moodBias > 0 ? Math.max(0, moodBias - dec) : Math.min(0, moodBias + dec);
}
function currentMood() {
  const h = currentHunger(), e = currentEnergy(), b = currentBond();
  let m = MOOD_BASE + currentMoodBias();
  if (h > 60) m -= (h - 60) * MOOD_HUNGER_K;
  if (e < 30) m -= (30 - e) * MOOD_ENERGY_K;
  m += b * MOOD_BOND_K;
  return clamp(m, 0, 100);
}

function render() {
  const lv = levelFromXp(xp);
  const t = L2();
  levelEl.textContent = t.lvl + ' ' + lv;
  abilitiesEl.textContent = lv >= MAX_LEVEL ? t.maxAb : t.abHint;

  if (lv >= MAX_LEVEL) { xpBar.style.width = '100%'; xpText.textContent = xp + ' ' + t.max; }
  else {
    const lo = LEVEL_XP[lv - 1], hi = LEVEL_XP[lv];
    xpBar.style.width = clamp((xp - lo) / (hi - lo) * 100, 0, 100) + '%';
    xpText.textContent = xp + ' / ' + hi;
  }

  const h = currentHunger();
  hungerBar.style.width = h + '%';
  hungerText.textContent = Math.round(h) + '%';

  const mood = currentMood(), en = currentEnergy(), bd = currentBond();
  moodBar.style.width = mood + '%'; moodText.textContent = Math.round(mood) + '%';
  energyBar.style.width = en + '%'; energyText.textContent = Math.round(en) + '%';
  bondBar.style.width = bd + '%'; bondText.textContent = Math.round(bd) + '%';

  // бейдж текущего состояния: приоритет сон > сильный голод > настроение > голод — ровно как computeAmbient в pet.js
  const sleeping = energyResting;
  const st = sleeping ? 'sleep' : h >= HUNGER_STARVING ? 'starving' : mood <= MOOD_BAD ? 'grumpy' : h >= HUNGER_HUNGRY ? 'hungry' : mood >= MOOD_GOOD ? 'happy' : 'ok';
  const sb = document.getElementById('stateBadge');
  if (sb) { sb.textContent = (t.state && t.state[st]) || ''; sb.dataset.st = st; }
  // честные disabled: спящую не погладить и с ней не поиграть, будить можно только спящую; на игру нужна энергия
  const bp = document.getElementById('care-pet'), bl = document.getElementById('care-play'), bw = document.getElementById('care-wake');
  if (bp) bp.disabled = sleeping;
  if (bl) bl.disabled = sleeping || en < 15;
  if (bw) bw.disabled = !sleeping;
}

// пикер героев строится из реестра CFG.HEROES (единый источник правды) — добавить персонажа = запись в config.js
const HEROES = (Array.isArray(CFG.HEROES) && CFG.HEROES.length) ? CFG.HEROES : [{ id: 'catgirl', name: 'Yasya' }];
const heroesBox = document.getElementById('heroes');
if (heroesBox) {
  heroesBox.innerHTML = HEROES.map((h) => `<button class="hero" data-hero="${h.id}"><img alt=""><span>${h.name}</span></button>`).join('');
  HEROES.forEach((h) => {   // миниатюра = idle-кадр из манифеста (через heroes.js); папочная конвенция как фолбэк
    const img = heroesBox.querySelector(`.hero[data-hero="${h.id}"] img`);
    if (!img) return;
    const setSrc = (rel) => { try { img.src = chrome.runtime.getURL('src/heroes/' + h.id + '/' + rel); } catch (_) { img.src = 'heroes/' + h.id + '/' + rel; } };
    setSrc('idle/idle0.png');   // показываем сразу (фолбэк-конвенция)
    if (window.Yasia && Yasia.heroes && Yasia.heroes.load) Yasia.heroes.load(h.id, (m) => {
      const f = m && m.animations && m.animations.idle && m.animations.idle.frames && m.animations.idle.frames[0];
      if (f) setSrc(f);   // путь из манифеста (выигрывает)
    });
  });
}
const heroBtns = [...document.querySelectorAll('.hero')];
let curHero = 'catgirl';
function markHero(hero) { curHero = hero; heroBtns.forEach((b) => b.classList.toggle('active', b.dataset.hero === hero)); setPetName(); }
// имя в карточке: для Яси — локализованное ласковое, для прочих героев — имя из реестра
function setPetName() { const e = document.getElementById('petName'); if (!e) return; const h = HEROES.find((x) => x.id === curHero); e.textContent = curHero === 'catgirl' ? L2().petName : ((h && h.name) || curHero); }

chrome.storage.sync.get({ enabled: true, paused: false, hero: 'catgirl', dlgLang: 'ru', devLedges: false }, (s) => { cb.checked = s.enabled; const pcb = document.getElementById('paused'); if (pcb) pcb.checked = !!s.paused; let h = (s.hero === 'noema' || !HEROES.some((x) => x.id === s.hero)) ? 'catgirl' : s.hero; if (h !== s.hero) chrome.storage.sync.set({ hero: h }); markHero(h); lang = (s && s.dlgLang === 'en') ? 'en' : 'ru'; const dv = document.getElementById('devLedges'); if (dv) dv.checked = !!s.devLedges; localize(); });
chrome.storage.local.get({
  hunger: 0, hungerAt: Date.now(), xp: 0,
  energy: 100, energyAt: Date.now(), energyResting: false, bond: 0, bondAt: Date.now(), moodBias: 0, moodBiasAt: Date.now(),
}, (s) => {
  hunger = s.hunger; hungerAt = s.hungerAt; xp = s.xp;
  energy = s.energy; energyAt = s.energyAt; energyResting = !!s.energyResting; bond = s.bond; bondAt = s.bondAt; moodBias = s.moodBias; moodBiasAt = s.moodBiasAt;
  render();
});
// живое обновление, если статы поменялись на странице (питомец «живёт» в активной вкладке)
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== 'local') return;
  if (ch.hunger) hunger = ch.hunger.newValue; if (ch.hungerAt) hungerAt = ch.hungerAt.newValue;
  if (ch.xp) xp = ch.xp.newValue;
  if (ch.energy) energy = ch.energy.newValue; if (ch.energyAt) energyAt = ch.energyAt.newValue; if (ch.energyResting) energyResting = ch.energyResting.newValue;
  if (ch.bond) bond = ch.bond.newValue; if (ch.bondAt) bondAt = ch.bondAt.newValue;
  if (ch.moodBias) moodBias = ch.moodBias.newValue; if (ch.moodBiasAt) moodBiasAt = ch.moodBiasAt.newValue;
  render();
});

cb.addEventListener('change', () => chrome.storage.sync.set({ enabled: cb.checked }));
{ const pcb = document.getElementById('paused'); if (pcb) pcb.addEventListener('change', () => chrome.storage.sync.set({ paused: pcb.checked })); }   // ⏸ пауза: страница подхватит вживую (storage.onChanged)
{ const dv = document.getElementById('devLedges'); if (dv) dv.addEventListener('change', () => chrome.storage.sync.set({ devLedges: dv.checked })); }   // дебаг-оверлей полок: страница подхватит вживую (storage.onChanged)
heroBtns.forEach((b) => b.addEventListener('click', () => { chrome.storage.sync.set({ hero: b.dataset.hero }); markHero(b.dataset.hero); }));

feedBtn.addEventListener('click', () => {
  const now = Date.now();
  const XPB = CFG.XP || {};
  const h = currentHunger();
  if (h < (XPB.feedMinHunger || 22)) { render(); return; }   // сытая отказывается (та же экономика, что в pet.js): еда/XP не начисляются
  hunger = clamp(h - FEED_AMOUNT, 0, 100); hungerAt = now;
  xp = xp + (h >= HUNGER_HUNGRY ? FEED_XP * (XPB.needyMul || 2) : FEED_XP);   // выручил голодную — вдвое ценнее
  energy = clamp(currentEnergy() + FEED_ENERGY, 0, 100); energyAt = now;
  bond = clamp(currentBond() + FEED_BOND, 0, 100); bondAt = now;
  moodBias = clamp(currentMoodBias() + FEED_MOOD, -MOOD_BIAS_MAX, MOOD_BIAS_MAX); moodBiasAt = now;
  chrome.storage.local.set({ hunger, hungerAt, xp, energy, energyAt, bond, bondAt, moodBias, moodBiasAt, feedPing: now });
  render();
});

// ---------- забота из попапа: тот же канал, что кормёжка (storage.local) ----------
// Статы качаем сами по общим формулам ACT_* — pet.js подхватит их через onChanged своими ключами.
// yasiaCareSignal {act, ts} — сигнал странице сыграть реакцию (pet_purr / like_proud / wake);
// слушатель в pet.js подключает другой разработчик, без него статы всё равно применяются.
let nextActAt = 0;   // антиспам как в pet.js (ACT_COOLDOWN_MS), чтобы кликер не накручивал статы
function careAct(act) {
  const now = Date.now();
  if (now < nextActAt) return; nextActAt = now + ACT_COOLDOWN_MS;
  const a = ACT[act] || {};
  if (a.hunger) { hunger = clamp(currentHunger() + a.hunger, 0, 100); hungerAt = now; }
  energy = clamp(currentEnergy() + (a.energy || 0), 0, 100); energyAt = now;
  // Будим по-настоящему: у pet.js гистерезис сна (computeAmbient) — спящая встаёт только при энергии >= ENERGY_WAKE,
  // а окно awakeUntil из попапа не выставить. Один лишь energyResting=false кошку не будит, но ломает ставку
  // (+30/мин сна -> −0.45/мин), делая сон вечным. Поэтому добуживаем энергией чуть выше порога — тик pet.js
  // сам пересчитает ambient, снимет resting и вызовет setEnergyResting(false) штатным путём.
  if (act === 'wake') { energyResting = false; energy = Math.max(energy, ENERGY_WAKE + 2); }
  if (a.bond) { bond = clamp(currentBond() + a.bond, 0, 100); bondAt = now; }
  if (a.mood) { moodBias = clamp(currentMoodBias() + a.mood, -MOOD_BIAS_MAX, MOOD_BIAS_MAX); moodBiasAt = now; }
  if (a.xp) xp += a.xp;
  chrome.storage.local.set({ hunger, hungerAt, xp, energy, energyAt, energyResting, bond, bondAt, moodBias, moodBiasAt, yasiaCareSignal: { act, ts: now } });
  render();
}
[['care-pet', 'pet'], ['care-play', 'play'], ['care-wake', 'wake']].forEach(([id, act]) => {
  const b = document.getElementById(id);
  if (b) b.addEventListener('click', () => careAct(act));
});

// ---------- режим поведения стража: sync yasiaMode ('normal'|'calm'), guard.js на странице подхватит вживую ----------
function markMode(m) {
  [['bm-normal', 'normal'], ['bm-calm', 'calm']].forEach(([id, v]) => { const b = document.getElementById(id); if (b) b.classList.toggle('on', v === m); });
}
chrome.storage.sync.get({ yasiaMode: 'normal' }, (s) => markMode(s.yasiaMode === 'calm' ? 'calm' : 'normal'));
[['bm-normal', 'normal'], ['bm-calm', 'calm']].forEach(([id, v]) => {
  const b = document.getElementById(id);
  if (b) b.addEventListener('click', () => { chrome.storage.sync.set({ yasiaMode: v }); markMode(v); });
});

// ---------- ползунок вредности: sync yasiaWildMul 0..2 (множитель шкалы дикости; движок подключается в behavior.js) ----------
{
  const w = document.getElementById('wild'), wv = document.getElementById('wildVal');
  const showWild = () => { if (wv) wv.textContent = '×' + parseFloat(w.value).toFixed(1); };
  if (w) {
    chrome.storage.sync.get({ yasiaWildMul: 1 }, (s) => { const v = typeof s.yasiaWildMul === 'number' ? s.yasiaWildMul : 1; w.value = clamp(v, 0, 2); showWild(); });
    w.addEventListener('input', showWild);   // подпись — вживую, запись — по отпусканию (бережём квоту sync)
    w.addEventListener('change', () => chrome.storage.sync.set({ yasiaWildMul: parseFloat(w.value) }));
  }
}

// ---------- фиче-флаги: тумблеры способностей (core/flags.js; storage.sync yasiaFlags) ----------
// Страница слушает yasiaFlags через flags.watch() -> системы стартуют/стопаются вживую.
function buildFlags() {
  const box = document.getElementById('flags');
  if (!box || !(window.Yasia && Yasia.flags)) return;
  const t = L2(), names = Object.keys(Yasia.flags.DEFAULTS).filter((n) => t.flagNames[n]);   // zombies/bowGame (план) не показываем
  box.innerHTML = names.map((n) => `<label class="row"><span>${t.flagNames[n]}</span><input type="checkbox" data-flag="${n}"></label>`).join('');
  Yasia.flags.load(() => {
    box.querySelectorAll('[data-flag]').forEach((fcb) => {
      fcb.checked = Yasia.flags.enabled(fcb.dataset.flag);
      fcb.addEventListener('change', () => Yasia.flags.set(fcb.dataset.flag, fcb.checked));
    });
  });
}

// ---------- тумблеры анимаций (dev): манифест героя -> чекбокс на каждую; выключенные копятся в sync yasiaAnimOff ----------
// Движок (pet.js) читает yasiaAnimOff и не берёт выключенные в автономную жизнь — подключает другой разработчик.
let animManifest = null, animOff = {};
function buildAnims() {
  const box = document.getElementById('anims');
  if (!box || !animManifest) return;
  const anims = animManifest.animations || {};
  box.innerHTML = Object.keys(anims).map((n) => {
    const a = anims[n] || {};
    const label = (a.icon ? a.icon + ' ' : '') + (lang === 'ru' && a.label ? a.label : n);   // label в манифесте русский; для EN — техимя
    return `<label class="row"><span>${label}</span><input type="checkbox" data-anim="${n}"></label>`;
  }).join('');
  box.querySelectorAll('[data-anim]').forEach((c) => {
    c.checked = !animOff[c.dataset.anim];
    c.addEventListener('change', () => {
      if (c.checked) delete animOff[c.dataset.anim]; else animOff[c.dataset.anim] = true;
      chrome.storage.sync.set({ yasiaAnimOff: animOff });
    });
  });
}
try {
  fetch(chrome.runtime.getURL('src/heroes/catgirl/manifest.json')).then((r) => r.json()).then((m) => {
    animManifest = m;
    chrome.storage.sync.get({ yasiaAnimOff: {} }, (s) => { animOff = (s.yasiaAnimOff && typeof s.yasiaAnimOff === 'object') ? s.yasiaAnimOff : {}; buildAnims(); });
  }).catch(() => {});
} catch (_) {}

// ---------- экспорт/импорт состояния ----------
// Белые списки = всё состояние Яси, КРОМЕ yasiaAI (там apiKey и токены — секреты не покидают устройство).
const EXPORT_SYNC = ['enabled', 'paused', 'hero', 'dlgLang', 'devLedges', 'yasiaFlags', 'yasiaMode', 'yasiaWildMul', 'yasiaAnimOff', 'roam', 'scale', 'walkSpeed', 'throwPower'];
const EXPORT_LOCAL = ['hunger', 'hungerAt', 'xp', 'energy', 'energyAt', 'energyResting', 'bond', 'bondAt', 'moodBias', 'moodBiasAt', 'yasiaNotes', 'yasiaReminders', 'yasiaSkills', 'yasiaMemory', 'yasiaPlaces', 'yasiaAiHosts', 'yasiaHermesSkills'];
function filterKeys(obj, allow) { const out = {}; if (obj && typeof obj === 'object') for (const k of allow) if (k in obj && obj[k] !== undefined) out[k] = obj[k]; return out; }
function backupMsg(cls, txt) { const m = document.getElementById('backup-msg'); if (m) { m.className = 'ai-msg ' + cls; m.textContent = txt; } }
function doExport() {
  chrome.storage.sync.get(EXPORT_SYNC, (sv) => chrome.storage.local.get(EXPORT_LOCAL, (lv) => {
    let ver = ''; try { ver = chrome.runtime.getManifest().version; } catch (_) {}
    const data = { app: 'yasenka', kind: 'state', version: ver, exportedAt: new Date().toISOString(), sync: filterKeys(sv, EXPORT_SYNC), local: filterKeys(lv, EXPORT_LOCAL) };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'yasya-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    backupMsg('ok', L2().expOk);
  }));
}
function doImport(file) {
  file.text().then((txt) => {
    let data = null;
    try { data = JSON.parse(txt); } catch (_) {}
    if (!data || data.app !== 'yasenka' || (typeof data.sync !== 'object' && typeof data.local !== 'object')) { backupMsg('err', L2().impBad); return; }
    const sv = filterKeys(data.sync, EXPORT_SYNC), lv = filterKeys(data.local, EXPORT_LOCAL);
    chrome.storage.sync.set(sv, () => chrome.storage.local.set(lv, () => {
      backupMsg('ok', L2().impOk);
      setTimeout(() => location.reload(), 600);   // перечитать всё из storage (статы, герой, флаги)
    }));
  }).catch(() => backupMsg('err', L2().impBad));
}
{
  const eb = document.getElementById('exportBtn'); if (eb) eb.addEventListener('click', doExport);
  const ib = document.getElementById('importBtn'), inf = document.getElementById('importFile');
  if (ib && inf) {
    ib.addEventListener('click', () => inf.click());
    inf.addEventListener('change', () => { if (inf.files && inf.files[0]) doImport(inf.files[0]); inf.value = ''; });
  }
}

// живое обновление шкалы голода, пока попап открыт
setInterval(render, 1000);

// ---------- локализация всех статичных подписей попапа ----------
function localize() {
  const t = L2();
  const set = (id, tx) => { const e = document.getElementById(id); if (e) e.textContent = tx; };
  set('t-title', t.title); set('t-enabled', t.enabled); set('t-hero', t.hero);
  set('t-xp', t.xp); set('t-hunger', t.hunger); set('t-mood', t.mood); set('t-energy', t.energy); set('t-bond', t.bond);
  set('t-feed', t.feed); set('t-hint', t.hint); set('t-dev', t.dev); set('t-devledges', t.devLedges); set('t-devledges-hint', t.devLedgesHint); set('t-ai', '🤖 ' + t.ai); set('ai-toggle', t.connect);
  set('t-paused', t.paused); set('t-flags', t.flags); set('t-flags-hint', t.flagsHint);
  set('t-backup', t.backup); set('exportBtn', t.exportBtn); set('importBtn', t.importBtn); set('t-backup-hint', t.backupHint);
  set('t-care-pet', t.carePet); set('t-care-play', t.carePlay); set('t-care-wake', t.careWake);
  set('t-mode', t.mode); set('bm-normal', t.modeNormal); set('bm-calm', t.modeCalm);
  set('t-wild', t.wild); set('wildL', t.wildL); set('wildR', t.wildR);
  set('t-anims', t.anims); set('t-anims-hint', t.animsHint);
  setPetName(); buildAnims();
  buildFlags();
  set('t-cfg-url', t.cfgUrl); set('t-cfg-key', t.cfgKey); set('t-cfg-model', t.cfgModel);
  set('t-prov-other', t.provOther); set('t-cfg-preset', t.lbPreset);
  set('cfg-test', t.test); set('cfg-save', t.save);
  const lb = document.getElementById('lang'); if (lb) lb.textContent = t.langBtn;
  try { document.documentElement.lang = lang; } catch (_) {}
  updateAiStatus(); fillProvHint(); render();
  const cfgBox = document.getElementById('ai-cfg'); if (cfgBox && !cfgBox.hidden) fillAi();
}

// ---------- ИИ-мозг: статус, логотипы, форма подключения ----------
function gptSub() { return aiCfg.provider === 'gpt' && (aiCfg.gpt.authMode || 'chatgpt') === 'chatgpt'; }
function aiConfigured() {
  if (gptSub()) return !!(aiCfg.gpt.chatgpt && aiCfg.gpt.chatgpt.accessToken);
  const a = aiCfg[aiCfg.provider] || {}; return !!(a.baseUrl && a.apiKey);
}
function injectLogos() {
  const h = document.getElementById('ai-logo'); if (h) h.innerHTML = LOGOS[aiCfg.provider] || LOGOS.other || '';
  const pg = document.querySelector('#prov-gpt .ai-logo'); if (pg) pg.innerHTML = LOGOS.gpt || '';
  const po = document.querySelector('#prov-other .ai-logo'); if (po) po.innerHTML = LOGOS.other || '';
}
function otherPreset() { return PROVIDERS.find((p) => p.id === aiCfg.other.presetId) || null; }   // выбранный пресет во вкладке «Другой»
// «эффективный» конфиг активного провайдера для СТАТУСА/подсказок (у Other модели/keysUrl берём из пресета)
function provInfo(prov) {
  if (prov === 'other') { const pr = otherPreset(); return { models: (pr && pr.models) || [], keysUrl: (pr && pr.keysUrl) || '' }; }
  return AICFG[prov] || {};
}
function updateAiStatus() {
  const el = document.getElementById('ai-status'); if (!el) return;
  const t = L2();
  const provName = aiCfg.provider === 'gpt' ? 'GPT' : (aiCfg.provider === 'other' ? ((otherPreset() || {}).name || t.provOther) : 'Hermes');
  el.textContent = aiConfigured() ? (t.aiOn + ' · ' + provName) : t.aiOff;
  el.classList.toggle('ok', aiConfigured());
  const h = document.getElementById('ai-logo'); if (h) h.innerHTML = LOGOS[aiCfg.provider] || LOGOS.other || '';
}
function fillProvHint() {
  const e = document.getElementById('cfg-hint'); if (!e) return;
  e.textContent = (aiProv === 'gpt' && aiMode === 'chatgpt') ? L2().hintSub : (aiProv === 'gpt' ? L2().hintGpt : L2().hintOther);
}
function fillAi() {
  const t = L2();
  const isSub = (aiProv === 'gpt' && aiMode === 'chatgpt');
  const p = aiCfg[aiProv] || {};
  const info = provInfo(aiProv);
  const url = document.getElementById('cfg-url'), key = document.getElementById('cfg-key');
  if (url) url.value = p.baseUrl || ((aiProv === 'other' && otherPreset()) ? otherPreset().baseUrl : '');
  if (key) key.value = p.apiKey || '';
  const bg = document.getElementById('prov-gpt'), bo = document.getElementById('prov-other');
  if (bg) bg.classList.toggle('on', aiProv === 'gpt'); if (bo) bo.classList.toggle('on', aiProv === 'other');
  // вкладки режима (только для GPT)
  const modeBox = document.getElementById('ai-mode'); if (modeBox) modeBox.hidden = (aiProv !== 'gpt');
  const ms = document.getElementById('mode-sub'), mk = document.getElementById('mode-key');
  if (ms) { ms.textContent = t.amSub; ms.classList.toggle('on', aiMode === 'chatgpt'); }
  if (mk) { mk.textContent = t.amKey; mk.classList.toggle('on', aiMode === 'key'); }
  // пресет-провайдер (только «Другой»)
  const presetF = document.getElementById('cfg-preset-f'); if (presetF) presetF.hidden = (aiProv !== 'other');
  const preSel = document.getElementById('cfg-preset');
  if (preSel && aiProv === 'other') {
    preSel.innerHTML = '<option value="">—</option>' + PROVIDERS.map((pr) => '<option value="' + pr.id + '"' + (pr.id === aiCfg.other.presetId ? ' selected' : '') + '>' + pr.name + '</option>').join('');
  }
  // поля ключа vs блок входа
  const kf = document.getElementById('ai-keyfields'); if (kf) kf.hidden = isSub;
  const si = document.getElementById('ai-signin'); if (si) si.hidden = !isSub;
  if (isSub) {
    const signed = !!(aiCfg.gpt.chatgpt && aiCfg.gpt.chatgpt.accessToken);
    const sb = document.getElementById('signin-btn'); if (sb) sb.textContent = signed ? t.signedReauth : t.signinBtn;
    const st = document.getElementById('signin-st'); if (st && !signinTimer) { st.className = 'ai-signin-st' + (signed ? ' ok' : ''); st.textContent = signed ? t.signedIn : ''; }
  }
  // модель = текстовый ввод + datalist: печатаешь -> список сужается по названию (список бывает огромный); можно вписать и свою
  const min = document.getElementById('cfg-modelin'), dl = document.getElementById('cfg-modellist');
  const models = (liveModels[aiProv] && liveModels[aiProv].length) ? liveModels[aiProv] : (info.models || []);   // живые модели с эндпоинта важнее захардкоженного пресета
  const cur = p.model || '';
  if (dl) dl.innerHTML = models.map((m) => '<option value="' + m + '"></option>').join('');
  if (min) { min.value = cur; min.placeholder = cur || (aiProv === 'gpt' ? 'gpt-5.5' : 'model-name'); }
  const gk = document.getElementById('cfg-getkey'), kurl = info.keysUrl;
  if (gk) { if (kurl) { gk.href = kurl; gk.textContent = t.getKey; gk.style.display = ''; } else gk.style.display = 'none'; }   // ссылка «где взять ключ»
  fillProvHint();
}
function collectAi() {
  const model = (((document.getElementById('cfg-modelin') || {}).value) || '').trim();   // модель напрямую из текстового поля (datalist)
  return {
    baseUrl: ((document.getElementById('cfg-url') || {}).value || '').trim(),
    apiKey: ((document.getElementById('cfg-key') || {}).value || '').trim(),
    model: model,
  };
}

injectLogos();
chrome.storage.local.get({ yasiaAI: null }, (s) => {
  const v = s && s.yasiaAI;
  if (v && typeof v === 'object') {
    if (v.provider === 'gpt' || v.provider === 'hermes' || v.provider === 'other') aiCfg.provider = v.provider;
    if (v.sessionKey) aiCfg.sessionKey = v.sessionKey;
    if (v.hermes && typeof v.hermes === 'object') aiCfg.hermes = Object.assign(aiCfg.hermes, v.hermes);
    if (v.gpt && typeof v.gpt === 'object') aiCfg.gpt = Object.assign(aiCfg.gpt, v.gpt);
    if (v.other && typeof v.other === 'object') aiCfg.other = Object.assign(aiCfg.other, v.other);
  }
  aiProv = aiCfg.provider === 'hermes' ? 'gpt' : aiCfg.provider; aiMode = aiCfg.gpt.authMode || 'chatgpt'; fillAi(); updateAiStatus();
});

document.getElementById('ai-toggle').addEventListener('click', () => {
  const box = document.getElementById('ai-cfg'); box.hidden = !box.hidden; if (!box.hidden) fillAi();
});
[['prov-gpt', 'gpt'], ['prov-other', 'other']].forEach(([id, p]) => {
  const b = document.getElementById(id);
  if (b) b.addEventListener('click', () => { aiCfg[aiProv] = Object.assign({}, aiCfg[aiProv], collectAi()); aiProv = p; fillAi(); });
});
// пресет провайдера (вкладка «Другой») -> подставить адрес/модели/ссылку
const preSelEl = document.getElementById('cfg-preset');
if (preSelEl) preSelEl.addEventListener('change', () => {
  aiCfg.other = Object.assign({}, aiCfg.other, collectAi());
  aiCfg.other.presetId = preSelEl.value;
  const pr = PROVIDERS.find((x) => x.id === preSelEl.value);
  if (pr) { if (pr.baseUrl) aiCfg.other.baseUrl = pr.baseUrl; if ((pr.models || []).indexOf(aiCfg.other.model) < 0) aiCfg.other.model = ''; }
  fillAi();
});
[['mode-sub', 'chatgpt'], ['mode-key', 'key']].forEach(([id, m]) => {
  const b = document.getElementById(id);
  if (b) b.addEventListener('click', () => { aiCfg.gpt = Object.assign({}, aiCfg.gpt, collectAi()); aiMode = m; aiCfg.gpt.authMode = m; fillAi(); });
});
// вход через ChatGPT (device-code) — опрос идёт в ФОНЕ; popup лишь стартует и показывает статус
const stopSignin = () => { if (signinTimer) { clearInterval(signinTimer); signinTimer = 0; } };
const signinBtn = document.getElementById('signin-btn');
if (signinBtn) signinBtn.addEventListener('click', () => {
  const st = document.getElementById('signin-st'); const t = L2();
  stopSignin(); st.className = 'ai-signin-st'; st.textContent = t.signinStart;
  try {
    chrome.runtime.sendMessage({ type: 'YASIA_CODEX_LOGIN' }, (r) => {
      if (chrome.runtime.lastError || !r || !r.ok) { st.className = 'ai-signin-st err'; st.textContent = t.signinFail + ': ' + ((chrome.runtime.lastError && chrome.runtime.lastError.message) || (r && r.error) || ''); return; }
      try { window.open(r.verifyUrl, '_blank'); } catch (_) {}
      st.innerHTML = t.signinCode + ' <b>' + (r.userCode || '') + '</b><br><span class="ai-signin-sub">' + (r.verifyUrl || '') + '</span>';
      signinTimer = setInterval(() => {
        chrome.runtime.sendMessage({ type: 'YASIA_CODEX_LOGIN_STATUS' }, (s) => {
          if (chrome.runtime.lastError || !s || !s.state) return;
          const stt = s.state.status;
          if (stt === 'ok') {
            stopSignin();
            chrome.storage.local.get({ yasiaAI: null }, (g) => { const v = g && g.yasiaAI; if (v && v.gpt) { aiCfg.gpt = Object.assign(aiCfg.gpt, v.gpt); aiCfg.provider = 'gpt'; } aiProv = 'gpt'; aiMode = 'chatgpt'; updateAiStatus(); fillAi(); const e = document.getElementById('signin-st'); e.className = 'ai-signin-st ok'; e.textContent = L2().signedIn; });
          } else if (stt === 'error' || stt === 'timeout') {
            stopSignin(); const e = document.getElementById('signin-st'); e.className = 'ai-signin-st err'; e.textContent = (stt === 'timeout' ? L2().signinTimeout : L2().signinFail + ': ' + (s.state.error || ''));
          }
        });
      }, 2500);
    });
  } catch (e) { st.className = 'ai-signin-st err'; st.textContent = t.signinFail; }
});
// подтянуть РЕАЛЬНЫЕ модели с эндпоинта (GET /v1/models) и показать все — как Hermes
function loadModels(silent) {
  const c = collectAi(), msg = document.getElementById('cfg-msg');
  if (!c.baseUrl || !c.apiKey) return;
  if (!silent) { msg.className = 'ai-msg'; msg.textContent = L2().testing; }
  try {
    chrome.runtime.sendMessage({ type: 'YASIA_AI_PING', baseUrl: c.baseUrl, apiKey: c.apiKey }, (r) => {
      if (chrome.runtime.lastError) { if (!silent) { msg.className = 'ai-msg err'; msg.textContent = L2().fail + ': ' + chrome.runtime.lastError.message; } return; }
      if (r && r.ok && r.models && r.models.length) {
        liveModels[aiProv] = r.models;
        aiCfg[aiProv] = Object.assign({}, aiCfg[aiProv], c);   // сохранить введённое перед перерисовкой
        fillAi();
        msg.className = 'ai-msg ok'; msg.textContent = (L2().modelsLoaded || (L2().ok + ' ({n})')).replace('{n}', r.models.length);
      } else if (!silent) { msg.className = 'ai-msg err'; msg.textContent = L2().fail + ': ' + ((r && r.error) || 'error'); }
    });
  } catch (e) { if (!silent) { msg.className = 'ai-msg err'; msg.textContent = L2().fail; } }
}
document.getElementById('cfg-test').addEventListener('click', () => loadModels(false));   // «Проверить связь» = проверка + подтянуть все модели
const keyInEl = document.getElementById('cfg-key');   // ввёл ключ -> автозагрузка доступных моделей (тихо)
if (keyInEl) keyInEl.addEventListener('blur', () => { if ((keyInEl.value || '').trim()) loadModels(true); });
document.getElementById('cfg-save').addEventListener('click', () => {
  aiCfg[aiProv] = Object.assign({}, aiCfg[aiProv], collectAi()); aiCfg.provider = aiProv;
  if (aiProv === 'gpt') aiCfg.gpt.authMode = aiMode;   // сохранить выбранный режим (подписка/ключ)
  try { chrome.storage.local.set({ yasiaAI: aiCfg }); } catch (_) {}
  const msg = document.getElementById('cfg-msg'); msg.className = 'ai-msg ok'; msg.textContent = L2().saved;
  updateAiStatus();
});
document.getElementById('lang').addEventListener('click', () => {
  lang = lang === 'ru' ? 'en' : 'ru';
  try { chrome.storage.sync.set({ dlgLang: lang }); } catch (_) {}
  localize();
});
