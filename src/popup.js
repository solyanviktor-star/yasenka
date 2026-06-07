// Должно совпадать с pet.js
const HUNGER_PER_MIN = 1.4;
const FEED_AMOUNT = 34;
const FEED_XP = 12;
const LEVEL_XP = [0, 40, 100, 200, 350];
const MAX_LEVEL = 5;

// i18n: по умолчанию EN, RU включается кнопкой (общий ключ dlgLang с pet.js)
const P = {
  en: { title: '🟩 Browser Pet', enabled: 'Pet enabled', hero: 'Hero:', xp: 'XP', hunger: 'Hunger', feed: 'Feed meat',
    hint: 'Hunger grows over time. Feeding gives XP — with each level the pet is bigger and livelier. A like is only placed by your click on the pet.',
    lvl: 'Lv.', maxAb: 'max abilities ✨', ab: '+speed +size', maxTag: ' (max)', other: 'RU' },
  ru: { title: '🟩 Браузер-Питомец', enabled: 'Питомец включён', hero: 'Герой:', xp: 'Опыт', hunger: 'Голод', feed: 'Покормить мясом',
    hint: 'Голод растёт со временем. Кормёжка даёт опыт — с уровнем питомец крупнее и живее. Лайк ставится только твоим кликом по питомцу.',
    lvl: 'Ур.', maxAb: 'макс. способности ✨', ab: '+скорость +размер', maxTag: ' (макс.)', other: 'EN' },
};
let lang = 'en';
const t = () => P[lang] || P.en;
const setT = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
function applyLang() {
  const d = t();
  setT('title', d.title); setT('lbl-enabled', d.enabled); setT('lbl-hero', d.hero);
  setT('lbl-xp', d.xp); setT('lbl-hunger', d.hunger); setT('feed-tx', d.feed);
  setT('hint', d.hint); setT('lang', d.other);
  render();
}

const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const levelFromXp = (x) => { let lv = 1; for (let i = 0; i < LEVEL_XP.length; i++) if (x >= LEVEL_XP[i]) lv = i + 1; return lv; };

let hunger = 0, hungerAt = Date.now(), xp = 0;

const cb = document.getElementById('enabled');
const levelEl = document.getElementById('level');
const abilitiesEl = document.getElementById('abilities');
const xpBar = document.getElementById('xpBar');
const xpText = document.getElementById('xpText');
const hungerBar = document.getElementById('hungerBar');
const hungerText = document.getElementById('hungerText');
const feedBtn = document.getElementById('feed');

function currentHunger() {
  return clamp(hunger + (Date.now() - hungerAt) / 60000 * HUNGER_PER_MIN, 0, 100);
}

function render() {
  const lv = levelFromXp(xp);
  levelEl.textContent = t().lvl + ' ' + lv;
  abilitiesEl.textContent = lv >= MAX_LEVEL ? t().maxAb : t().ab;

  if (lv >= MAX_LEVEL) { xpBar.style.width = '100%'; xpText.textContent = xp + t().maxTag; }
  else {
    const lo = LEVEL_XP[lv - 1], hi = LEVEL_XP[lv];
    xpBar.style.width = clamp((xp - lo) / (hi - lo) * 100, 0, 100) + '%';
    xpText.textContent = xp + ' / ' + hi;
  }

  const h = currentHunger();
  hungerBar.style.width = h + '%';
  hungerText.textContent = Math.round(h) + '%';
}

const heroBtns = [...document.querySelectorAll('.hero')];
function markHero(hero) { heroBtns.forEach((b) => b.classList.toggle('active', b.dataset.hero === hero)); }

chrome.storage.sync.get({ enabled: true, hero: 'catgirl', dlgLang: 'en' }, (s) => { cb.checked = s.enabled; markHero(s.hero); lang = s.dlgLang === 'ru' ? 'ru' : 'en'; applyLang(); });

const langBtn = document.getElementById('lang');
langBtn.addEventListener('click', () => { lang = lang === 'ru' ? 'en' : 'ru'; chrome.storage.sync.set({ dlgLang: lang }); applyLang(); });
chrome.storage.local.get({ hunger: 0, hungerAt: Date.now(), xp: 0 }, (s) => {
  hunger = s.hunger; hungerAt = s.hungerAt; xp = s.xp; render();
});

cb.addEventListener('change', () => chrome.storage.sync.set({ enabled: cb.checked }));
heroBtns.forEach((b) => b.addEventListener('click', () => { chrome.storage.sync.set({ hero: b.dataset.hero }); markHero(b.dataset.hero); }));

feedBtn.addEventListener('click', () => {
  const cur = currentHunger();
  hunger = Math.max(0, cur - FEED_AMOUNT);
  hungerAt = Date.now();
  xp = xp + FEED_XP;
  chrome.storage.local.set({ hunger, hungerAt, xp, feedPing: Date.now() });
  render();
});

// живое обновление шкалы голода, пока попап открыт
setInterval(render, 1000);
