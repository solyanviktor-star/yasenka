// Единый источник правды — core/config.js (подключён в popup.html перед этим скриптом).
// Берём значения оттуда; дефолты-фолбэк на случай, если конфиг не загрузился.
const CFG = (window.Yasia && window.Yasia.config) || {};
const num = (v, d) => (typeof v === 'number' ? v : d);
const HUNGER_PER_MIN = num(CFG.HUNGER_PER_MIN, 1.4);
const FEED_AMOUNT = num(CFG.FEED_AMOUNT, 34);
const FEED_XP = num(CFG.FEED_XP, 12);
const LEVEL_XP = CFG.LEVEL_XP || [0, 40, 100, 200, 350];
const MAX_LEVEL = num(CFG.MAX_LEVEL, 5);
const ENERGY_REST_MIN = num(CFG.ENERGY_REST_MIN, 0.45), ENERGY_SLEEP_MIN = num(CFG.ENERGY_SLEEP_MIN, 30), BOND_DECAY_MIN = num(CFG.BOND_DECAY_MIN, 0.05);
const MOOD_BASE = num(CFG.MOOD_BASE, 55), MOOD_BIAS_DECAY_MIN = num(CFG.MOOD_BIAS_DECAY_MIN, 3.5), MOOD_HUNGER_K = num(CFG.MOOD_HUNGER_K, 0.6), MOOD_ENERGY_K = num(CFG.MOOD_ENERGY_K, 0.5), MOOD_BOND_K = num(CFG.MOOD_BOND_K, 0.15), MOOD_BIAS_MAX = num(CFG.MOOD_BIAS_MAX, 45);
const FEED_ENERGY = num(CFG.ACT_FEED && CFG.ACT_FEED.energy, 5), FEED_BOND = num(CFG.ACT_FEED && CFG.ACT_FEED.bond, 3), FEED_MOOD = num(CFG.ACT_FEED && CFG.ACT_FEED.mood, 10);

const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const levelFromXp = (x) => { let lv = 1; for (let i = 0; i < LEVEL_XP.length; i++) if (x >= LEVEL_XP[i]) lv = i + 1; return lv; };

// ---------- локализация (единый язык с окном Яси: storage.sync 'dlgLang') ----------
const P = {
  ru: { title: '🟩 Твиттер-Питомец', enabled: 'Питомец включён', hero: 'Герой:', lvl: 'Ур.', maxAb: 'макс. способности ✨', abHint: '+скорость +размер', max: '(макс.)', xp: 'Опыт', hunger: 'Голод', mood: 'Настроение', energy: 'Энергия', bond: 'Привязанность', feed: 'Покормить мясом', hint: 'Голод растёт со временем. Заботься о питомце — корми, гладь, играй: он меняется от твоего отношения. Клик по питомцу открывает меню «Забота».', ai: 'ИИ-мозг (Hermes / GPT)', aiOn: 'Подключено', aiOff: 'Не настроен', connect: '⚙ Подключить Hermes / GPT', cfgUrl: 'Адрес', cfgKey: 'Ключ', cfgModel: 'Модель', test: 'Проверить связь', save: 'Сохранить', testing: 'Проверяю…', ok: '🟢 Связь есть', fail: 'Не вышло', saved: '✓ Сохранено', hintHermes: 'Включи в Hermes канал «API server», задай API_SERVER_KEY, впиши адрес и ключ.', hintGpt: 'Прямое подключение к OpenAI: вставь ключ sk-…. Хранится локально, не синкается.', getKey: '🔑 Где взять ключ ↗', langBtn: 'EN', dev: '🛠 Разработчик', devLedges: 'Подсветка полок', devLedgesHint: 'Показывает на странице, как Яся видит полки: оранжевая — стоит тут, зелёные — допрыгнет отсюда, жёлтые — допрыгнет с края полки (маршрут), красные — видит, но не достать, синяя — пол.', amSub: 'Подписка ChatGPT', amKey: 'API-ключ', signinBtn: 'Войти через ChatGPT', signedReauth: 'Войти заново', signedIn: '🟢 Вход выполнен', signinStart: 'Запрашиваю код…', signinCode: 'Открой страницу и введи код:', signinFail: 'Не вышло войти', signinTimeout: 'Время вышло — попробуй ещё раз', hintSub: 'Вход твоим аккаунтом ChatGPT (подписка). Откроется страница OpenAI — введи код. ⚠️ Неофициальный путь: возможен отказ Cloudflare и риск для аккаунта. Если не работает — через Hermes.', paused: 'Пауза (замереть на месте)', flags: '🧩 Способности', flagsHint: 'Действует сразу: выключенная способность останавливается прямо на странице. Сломанная фича гаснет сама.', flagNames: { tamagotchi: 'Тамагочи (голод/энергия)', mediaDownload: 'Скачивание медиа', notes: 'Заметки', aiAssistant: 'ИИ-помощник', skills: 'Навыки', memory: 'Память', games: 'Мини-игры' }, backup: '💾 Резервная копия', exportBtn: 'Экспорт', importBtn: 'Импорт', backupHint: 'JSON со статами, заметками, памятью и настройками. Ключи ИИ (yasiaAI) не выгружаются.', expOk: '✓ Файл сохранён', impOk: '✓ Импортировано', impBad: 'Это не файл резервной копии Яси' },
  en: { title: '🟩 Twitter-Pet', enabled: 'Pet enabled', hero: 'Character:', lvl: 'Lv.', maxAb: 'max abilities ✨', abHint: '+speed +size', max: '(max)', xp: 'XP', hunger: 'Hunger', mood: 'Mood', energy: 'Energy', bond: 'Bond', feed: 'Feed meat', hint: 'Hunger grows over time. Care for the pet — feed, pet, play: it changes with how you treat it. Click the pet to open the «Care» menu.', ai: 'AI brain (Hermes / GPT)', aiOn: 'Connected', aiOff: 'Not set up', connect: '⚙ Connect Hermes / GPT', cfgUrl: 'Address', cfgKey: 'Key', cfgModel: 'Model', test: 'Test connection', save: 'Save', testing: 'Testing…', ok: '🟢 Connection OK', fail: 'Failed', saved: '✓ Saved', hintHermes: 'In Hermes enable the «API server» channel, set API_SERVER_KEY, enter the address and key.', hintGpt: 'Direct OpenAI connection: paste sk-… key. Stored locally, never synced.', getKey: '🔑 Get a key ↗', langBtn: 'RU', dev: '🛠 Developer', devLedges: 'Ledge overlay', devLedgesHint: 'Shows how Yasya sees the page: orange — standing here, green — jumpable from her spot, yellow — jumpable from the ledge edge (route), red — visible but unreachable, blue — the floor.', amSub: 'ChatGPT subscription', amKey: 'API key', signinBtn: 'Sign in with ChatGPT', signedReauth: 'Sign in again', signedIn: '🟢 Signed in', signinStart: 'Requesting code…', signinCode: 'Open the page and enter the code:', signinFail: 'Sign-in failed', signinTimeout: 'Timed out — try again', hintSub: 'Sign in with your ChatGPT account (subscription). An OpenAI page opens — enter the code. ⚠️ Unofficial path: Cloudflare may refuse it and there is account risk. If it fails, use Hermes.', paused: 'Pause (freeze in place)', flags: '🧩 Features', flagsHint: 'Applies instantly: a feature you turn off stops right on the page. A broken feature turns itself off.', flagNames: { tamagotchi: 'Tamagotchi (hunger/energy)', mediaDownload: 'Media download', notes: 'Notes', aiAssistant: 'AI assistant', skills: 'Skills', memory: 'Memory', games: 'Mini-games' }, backup: '💾 Backup', exportBtn: 'Export', importBtn: 'Import', backupHint: 'JSON with stats, notes, memory and settings. AI keys (yasiaAI) are never exported.', expOk: '✓ File saved', impOk: '✓ Imported', impBad: 'Not a Yasya backup file' },
};
let lang = 'ru';
const L2 = () => P[lang] || P.ru;

// ---------- конфиг ИИ-мозга (тот же storage.local 'yasiaAI', что читает src/systems/ai.js) ----------
const AICFG = (CFG && CFG.AI) || {};
const LOGOS = AICFG.logos || { hermes: '', gpt: '' };
const PROV_DEF = {
  hermes: { baseUrl: (AICFG.hermes && AICFG.hermes.baseUrl) || 'http://127.0.0.1:8642', apiKey: '', model: (AICFG.hermes && AICFG.hermes.model) || 'hermes-agent' },
  gpt: { baseUrl: (AICFG.gpt && AICFG.gpt.baseUrl) || 'https://api.openai.com', apiKey: '', model: (AICFG.gpt && AICFG.gpt.model) || 'gpt-5.5', authMode: 'chatgpt', chatgpt: { accessToken: '', refreshToken: '', accountId: '' } },
};
let aiCfg = { provider: AICFG.provider || 'hermes', sessionKey: AICFG.sessionKey || 'yasia:x', hermes: Object.assign({}, PROV_DEF.hermes), gpt: Object.assign({}, PROV_DEF.gpt) };
let aiProv = aiCfg.provider;   // какой провайдер сейчас редактируется в форме
let aiMode = aiCfg.gpt.authMode || 'chatgpt';   // режим GPT-вкладки: 'chatgpt' (подписка) | 'key'
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
function markHero(hero) { heroBtns.forEach((b) => b.classList.toggle('active', b.dataset.hero === hero)); }

chrome.storage.sync.get({ enabled: true, paused: false, hero: 'catgirl', dlgLang: 'ru', devLedges: false }, (s) => { cb.checked = s.enabled; const pcb = document.getElementById('paused'); if (pcb) pcb.checked = !!s.paused; markHero(s.hero); lang = (s && s.dlgLang === 'en') ? 'en' : 'ru'; const dv = document.getElementById('devLedges'); if (dv) dv.checked = !!s.devLedges; localize(); });
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
  hunger = clamp(currentHunger() - FEED_AMOUNT, 0, 100); hungerAt = now;
  xp = xp + FEED_XP;
  energy = clamp(currentEnergy() + FEED_ENERGY, 0, 100); energyAt = now;
  bond = clamp(currentBond() + FEED_BOND, 0, 100); bondAt = now;
  moodBias = clamp(currentMoodBias() + FEED_MOOD, -MOOD_BIAS_MAX, MOOD_BIAS_MAX); moodBiasAt = now;
  chrome.storage.local.set({ hunger, hungerAt, xp, energy, energyAt, bond, bondAt, moodBias, moodBiasAt, feedPing: now });
  render();
});

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

// ---------- экспорт/импорт состояния ----------
// Белые списки = всё состояние Яси, КРОМЕ yasiaAI (там apiKey и токены — секреты не покидают устройство).
const EXPORT_SYNC = ['enabled', 'paused', 'hero', 'dlgLang', 'devLedges', 'yasiaFlags', 'yasiaMode', 'roam', 'scale', 'walkSpeed', 'throwPower'];
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
  set('t-feed', t.feed); set('t-hint', t.hint); set('t-dev', t.dev); set('t-devledges', t.devLedges); set('t-devledges-hint', t.devLedgesHint); set('t-ai', t.ai); set('ai-toggle', t.connect);
  set('t-paused', t.paused); set('t-flags', t.flags); set('t-flags-hint', t.flagsHint);
  set('t-backup', t.backup); set('exportBtn', t.exportBtn); set('importBtn', t.importBtn); set('t-backup-hint', t.backupHint);
  buildFlags();
  set('t-cfg-url', t.cfgUrl); set('t-cfg-key', t.cfgKey); set('t-cfg-model', t.cfgModel);
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
  const h = document.getElementById('ai-logo'); if (h) h.innerHTML = LOGOS[aiCfg.provider] || '';
  const ph = document.querySelector('#prov-hermes .ai-logo'); if (ph) ph.innerHTML = LOGOS.hermes || '';
  const pg = document.querySelector('#prov-gpt .ai-logo'); if (pg) pg.innerHTML = LOGOS.gpt || '';
}
function updateAiStatus() {
  const el = document.getElementById('ai-status'); if (!el) return;
  const t = L2(), provName = aiCfg.provider === 'gpt' ? 'GPT' : 'Hermes';
  el.textContent = aiConfigured() ? (t.aiOn + ' · ' + provName) : t.aiOff;
  el.classList.toggle('ok', aiConfigured());
  const h = document.getElementById('ai-logo'); if (h) h.innerHTML = LOGOS[aiCfg.provider] || '';
}
function fillProvHint() {
  const e = document.getElementById('cfg-hint'); if (!e) return;
  e.textContent = (aiProv === 'gpt' && aiMode === 'chatgpt') ? L2().hintSub : (aiProv === 'gpt' ? L2().hintGpt : L2().hintHermes);
}
function fillAi() {
  const t = L2();
  const isSub = (aiProv === 'gpt' && aiMode === 'chatgpt');
  const p = aiCfg[aiProv] || {};
  const url = document.getElementById('cfg-url'), key = document.getElementById('cfg-key'), model = document.getElementById('cfg-model');
  if (url) url.value = p.baseUrl || ''; if (key) key.value = p.apiKey || ''; if (model) model.value = p.model || '';
  const bh = document.getElementById('prov-hermes'), bg = document.getElementById('prov-gpt');
  if (bh) bh.classList.toggle('on', aiProv === 'hermes'); if (bg) bg.classList.toggle('on', aiProv === 'gpt');
  // вкладки режима (только для GPT)
  const modeBox = document.getElementById('ai-mode'); if (modeBox) modeBox.hidden = (aiProv !== 'gpt');
  const ms = document.getElementById('mode-sub'), mk = document.getElementById('mode-key');
  if (ms) { ms.textContent = t.amSub; ms.classList.toggle('on', aiMode === 'chatgpt'); }
  if (mk) { mk.textContent = t.amKey; mk.classList.toggle('on', aiMode === 'key'); }
  // поля ключа vs блок входа
  const kf = document.getElementById('ai-keyfields'); if (kf) kf.hidden = isSub;
  const si = document.getElementById('ai-signin'); if (si) si.hidden = !isSub;
  if (isSub) {
    const signed = !!(aiCfg.gpt.chatgpt && aiCfg.gpt.chatgpt.accessToken);
    const sb = document.getElementById('signin-btn'); if (sb) sb.textContent = signed ? t.signedReauth : t.signinBtn;
    const st = document.getElementById('signin-st'); if (st && !signinTimer) { st.className = 'ai-signin-st' + (signed ? ' ok' : ''); st.textContent = signed ? t.signedIn : ''; }
  }
  const dl = document.getElementById('cfg-models');
  const models = (AICFG[aiProv] && AICFG[aiProv].models) || [];
  if (dl) dl.innerHTML = models.map((m) => '<option value="' + m + '"></option>').join('');   // список моделей провайдера (можно вписать любую)
  const gk = document.getElementById('cfg-getkey'), kurl = AICFG[aiProv] && AICFG[aiProv].keysUrl;
  if (gk) { if (kurl) { gk.href = kurl; gk.textContent = t.getKey; gk.style.display = ''; } else gk.style.display = 'none'; }   // ссылка «где взять ключ»
  fillProvHint();
}
function collectAi() {
  return {
    baseUrl: ((document.getElementById('cfg-url') || {}).value || '').trim(),
    apiKey: ((document.getElementById('cfg-key') || {}).value || '').trim(),
    model: ((document.getElementById('cfg-model') || {}).value || '').trim(),
  };
}

injectLogos();
chrome.storage.local.get({ yasiaAI: null }, (s) => {
  const v = s && s.yasiaAI;
  if (v && typeof v === 'object') {
    if (v.provider === 'gpt' || v.provider === 'hermes') aiCfg.provider = v.provider;
    if (v.sessionKey) aiCfg.sessionKey = v.sessionKey;
    if (v.hermes && typeof v.hermes === 'object') aiCfg.hermes = Object.assign(aiCfg.hermes, v.hermes);
    if (v.gpt && typeof v.gpt === 'object') aiCfg.gpt = Object.assign(aiCfg.gpt, v.gpt);
  }
  aiProv = aiCfg.provider; aiMode = aiCfg.gpt.authMode || 'chatgpt'; fillAi(); updateAiStatus();
});

document.getElementById('ai-toggle').addEventListener('click', () => {
  const box = document.getElementById('ai-cfg'); box.hidden = !box.hidden; if (!box.hidden) fillAi();
});
[['prov-hermes', 'hermes'], ['prov-gpt', 'gpt']].forEach(([id, p]) => {
  const b = document.getElementById(id);
  if (b) b.addEventListener('click', () => { aiCfg[aiProv] = Object.assign({}, aiCfg[aiProv], collectAi()); aiProv = p; fillAi(); });
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
document.getElementById('cfg-test').addEventListener('click', () => {
  const c = collectAi(), msg = document.getElementById('cfg-msg');
  msg.className = 'ai-msg'; msg.textContent = L2().testing;
  try {
    chrome.runtime.sendMessage({ type: 'YASIA_AI_PING', baseUrl: c.baseUrl, apiKey: c.apiKey }, (r) => {
      if (chrome.runtime.lastError) { msg.className = 'ai-msg err'; msg.textContent = L2().fail + ': ' + chrome.runtime.lastError.message; return; }
      if (r && r.ok) { msg.className = 'ai-msg ok'; msg.textContent = L2().ok + (r.models && r.models.length ? ' (' + r.models.slice(0, 3).join(', ') + ')' : ''); }
      else { msg.className = 'ai-msg err'; msg.textContent = L2().fail + ': ' + ((r && r.error) || 'error'); }
    });
  } catch (e) { msg.className = 'ai-msg err'; msg.textContent = L2().fail; }
});
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
