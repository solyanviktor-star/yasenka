(() => {
  'use strict';

  // Только верхнее окно
  if (window.top !== window) return;

  const ROOT_ID = 'twtr-pet-root';
  if (document.getElementById(ROOT_ID)) return; // защита от повторной инъекции

  console.log('%c🟩 Browser Pet (Yasia) запущен', 'color:#5cba47;font-weight:bold', location.href);

  // ---------- параметры ----------
  // значения вынесены в src/core/config.js (window.Yasia.config) — грузится перед pet.js
  const {
    SPEED, RUN_MUL,
    PLAT_GRAVITY, PLAT_JUMP_UP, PLAT_JUMP_DX, PLAT_JUMP_MS, PLAT_FLOOR,
    ARRIVE, STAND_GAP, NEAR, SCAN_MS, BEG_TIMEOUT,
    HAPPY_MS, SNUB_MS, STABLE_FRAMES, VIEW_PAD_TOP, VIEW_PAD_BOTTOM,
    PET_W, PET_H, HOVER_R, FUSE_MS,
    HUNGER_PER_MIN, FEED_AMOUNT, FEED_XP, LIKE_XP, LEVEL_XP, MAX_LEVEL,
  } = (window.Yasia && window.Yasia.config) || {};

  // ---------- состояние ----------
  let enabled = true;
  let mode = 'idle';          // idle | wander | approach | beg | happy
  let busy = false;           // занят анимацией (пакость/еда/взрыв)
  let targetId = null;
  let px = 80, py = 0, tx = 80, ty = 0, face = 1;
  let lastScan = 0, begUntil = 0, happyUntil = 0, wanderUntil = 0;
  let lastBtnTop = 0, stableFrames = 0, hiddenAt = 0, lastHref = location.href;
  let lastSave = 0, lastTick = 0;
  let nextMischief = 0;
  let hopPhase = 0, hopY = 0, prevPx = 80, prevPy = 0;
  let fuseMs = 0, explodeCooldown = 0;
  let boomActive = false, debris = [], boomHidden = [];
  let flung = false, flungUntil = 0, fakeX = 0, fakeY = 0, cornerIdx = 0;
  let mouseX = 0, mouseY = 0;
  let roam = true;            // ходит/бегает сама (всегда включено)
  let running = true, runUntil = 0, nextRunDecide = 0, runMul = 1;   // бег по умолчанию
  let dragging = false, dragOffX = 0, dragOffY = 0, grabPx = 0, grabPy = 0, didDrag = false;
  let thrown = false, dragVx = 0, dragVy = 0, lastDragX = 0, lastDragY = 0, peakVx = 0, peakVy = 0;   // бросок по инерции (+ пик скорости кисти)
  // платформер
  let ledges = [], standLedge = null, lastLedgeScan = 0, vy = 0, vx = 0;
  let jumping = false, jumpT = 0, jumpFromX = 0, jumpFromY = 0, jumpToX = 0, jumpToY = 0, jumpPeak = 0, jumpDest = null;
  let walkTargetX = 0, nextJumpDecide = 0, sayUntil = 0, nextChatter = 0, climbing = false, falling = false;
  // игровые параметры
  let hungerBase = 0, hungerAt = Date.now(), xp = 0, level = 1;
  let speedMul = 1, sizeMul = 1, userScale = 1.8;   // userScale — размер (единственная настройка), по умолчанию 180%
  const userSpeed = 0.7, throwMul = 0.4;   // скорость 70% и инерция 40% — зафиксированы
  const snubbed = new Map();
  const STATE_KEY = 'petState';

  // ---------- DOM ----------
  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.innerHTML = `
    <button class="twtr-pet-toggle" id="twtr-pet-toggle" type="button">🐾</button>
    <button class="twtr-pet-settings-btn" id="twtr-settings-btn" type="button">⚙</button>
    <div class="twtr-pet-settings" id="twtr-settings">
      <div class="twtr-set-title">Pet settings</div>
      <div class="twtr-set-row">
        <span id="twtr-set-size-label">Size</span>
        <span class="twtr-set-stepper">
          <button class="twtr-set-mini" data-act="dec" type="button">−</button>
          <span class="twtr-set-val" id="twtr-scale-val">180%</span>
          <button class="twtr-set-mini" data-act="inc" type="button">+</button>
        </span>
      </div>
    </div>
    <div class="twtr-pet-dialog" id="twtr-dialog">
      <div class="twtr-dlg-backdrop" id="twtr-dlg-backdrop"></div>
      <div class="twtr-dlg-card">
        <div class="twtr-dlg-head">
          <span class="twtr-dlg-title">🐱 Yasia</span>
          <span class="twtr-dlg-head-r">
            <button class="twtr-dlg-lang" id="twtr-dlg-lang" type="button">EN</button>
            <button class="twtr-dlg-x" id="twtr-dlg-x" type="button">✕</button>
          </span>
        </div>
        <div class="twtr-dlg-scroll" id="twtr-dlg-scroll">
        <div class="twtr-dlg-greet" id="twtr-dlg-greet"></div>
        <div class="twtr-dlg-ask">
          <input class="twtr-dlg-askin" id="twtr-dlg-ask" type="text">
          <button class="twtr-dlg-asksend" id="twtr-dlg-asksend" type="button">→</button>
        </div>
        <div class="twtr-dlg-ai" id="twtr-dlg-ai" hidden></div>
        <div class="twtr-dlg-caps" id="twtr-dlg-caps">
          <div class="twtr-skill" data-skill="dl">
            <button class="twtr-dlg-cap" id="twtr-cap-dl" type="button"><span class="twtr-cap-ic">📥</span><span class="twtr-cap-tx" id="twtr-cap-dl-tx"></span><span class="twtr-cap-arr">›</span></button>
            <div class="twtr-skill-body" id="twtr-skill-dl" hidden>
              <div class="twtr-dlg-video" id="twtr-dlg-video"></div>
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
    <div class="twtr-fakecursor" id="twtr-fakecursor"><svg viewBox="0 0 24 24" width="22" height="22">
      <path d="M3 2 L3 20 L8 15 L11 22 L14 21 L11 14 L18 14 Z" fill="#fff" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/></svg></div>
    <div class="twtr-pet is-walking" id="twtr-pet">
      <div class="twtr-pet__bubble" id="twtr-pet-bubble">❤?</div>
      <div class="twtr-pet__inner">
        <div class="twtr-pet__char">
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
  const dialog = root.querySelector('#twtr-dialog');
  const dlgText = root.querySelector('#twtr-dlg-text');
  const dlgList = root.querySelector('#twtr-dlg-list');
  const dlgVideo = root.querySelector('#twtr-dlg-video');
  const fakeCursor = root.querySelector('#twtr-fakecursor');
  const sprite = root.querySelector('#twtr-sprite');
  const frameEls = {};                                   // все кадры лежат слоями-картинками, переключаем видимость (без мерцания от смены src)
  // (заполняется ниже из CAT_SETS — по одному <img> на кадр)
  let curFrameEl = null;
  function showFrame(name) {
    const el = frameEls[name];
    if (!el || el === curFrameEl) return;
    if (curFrameEl) curFrameEl.classList.remove('on');
    el.classList.add('on'); curFrameEl = el;
  }

  // ---------- герой ----------
  let hero = 'catgirl';   // 'catgirl' = Yasia (единственный герой)
  // кошка — кадры по состояниям. data-driven: число кадров -> CAT_SETS/CAT_DIR + сами <img> строим из этого.
  const CAT_IDLE_MS = 280, CAT_WALK_MS = 110, CAT_RUN_MS = 70, CAT_JUMP_MS = 70, CAT_CLIMB_MS = 170, CAT_EMO_MS = 150;
  const HAPPY_HOP_PX = 18, HAPPY_HOP_MS = 340;   // радость — высота и частота подпрыгивания
  const CAT_FRAMES = {           // state -> сколько кадров (1 = одиночный спрайт <state>.png в папке <state>/)
    idle: 1, walk: 6, jump: 1, climb: 1, wave: 1,                                   // были раньше
    happy: 4, sad: 4, angry: 4, dizzy: 4, hungry: 4, sleep: 4, fall: 5, run: 6,     // новые эмоции/состояния
  };
  // эмоции, где кадры = разные позы (не motion-арк) -> включаем кросс-фейд, чтобы сгладить скачки. Ходьбу/бег НЕ трогаем.
  const EMO_XFADE = { happy: 1, sad: 1, angry: 1, dizzy: 1, hungry: 1, sleep: 1, fall: 1 };
  const CAT_SETS = {}, CAT_DIR = {};
  for (const st in CAT_FRAMES) {
    const n = CAT_FRAMES[st];
    CAT_SETS[st] = n === 1 ? [st] : Array.from({ length: n }, (_, i) => st + i);    // idle->['idle'], walk->['walk0'..'walk5']
    for (const f of CAT_SETS[st]) CAT_DIR[f] = st;                                   // walk3->'walk', angry0->'angry'
  }
  for (const st in CAT_SETS) for (const f of CAT_SETS[st]) {                         // строим слои-картинки (по одному <img> на кадр)
    const im = document.createElement('img'); im.setAttribute('data-f', f); im.alt = ''; sprite.appendChild(im); frameEls[f] = im;
  }
  let catIdx = 0, lastFrameT = 0, catAct = null;
  function buildCatFrames() {
    const url = (k) => { try { return chrome.runtime.getURL('src/heroes/catgirl/' + (CAT_DIR[k] || k) + '/' + k + '.png'); } catch (_) { return ''; } };
    for (const k in frameEls) { const u = url(k); if (u) frameEls[k].src = u; }   // каждое движение в своей папке
  }
  function applyHero() {
    buildCatFrames(); catIdx = 0; catAct = null; showFrame('idle');
  }

  py = ty = prevPy = window.innerHeight - PET_H - 40;
  mouseX = window.innerWidth / 2; mouseY = window.innerHeight / 2;

  // ---------- утилиты ----------
  const now = () => performance.now();
  const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

  // ---------- речь питомца (зависит от языка dlgLang; по умолчанию EN) ----------
  const SAY = {
    en: {
      idle:  ['Hi! 🐾', 'Whatcha up to?', 'Meow~', 'Pet me!', 'I live here 😺', 'Bored...'],
      jump:  ['Whee!', 'Hop!', 'Nya!', 'Jump!', 'Flying! ✨'],
      top:   ["I'm on top! 🏔️", 'Great view from here!', 'King of the hill 👑'],
      event: ["Don't forget the events! 🎉", 'Events are waiting!', 'Filling in the events board! 📋'],
    },
    ru: {
      idle:  ['Привет! 🐾', 'Чем занят?', 'Мяу~', 'Погладь меня!', 'Я тут живу 😺', 'Скучно...'],
      jump:  ['Опа!', 'Хоп!', 'Ня!', 'Прыг!', 'Лечу! ✨'],
      top:   ['Я на вершине! 🏔️', 'Отсюда всё видно!', 'Король горы 👑'],
      event: ['Не забудь про ивенты! 🎉', 'Ивенты ждут!', 'Заполняем табличку ивентов! 📋'],
    },
  };
  const says = (k) => (SAY[dlgLang] || SAY.en)[k];
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

  // ---------- селекторы X ----------
  function getStatusId(article) {
    const links = article.querySelectorAll('a[href*="/status/"]');
    for (const a of links) { if (!a.querySelector('time')) continue; const m = a.getAttribute('href').match(/\/status\/(\d+)/); if (m) return m[1]; }
    for (const a of links) { const m = a.getAttribute('href').match(/\/status\/(\d+)/); if (m) return m[1]; }
    return null;
  }
  function articleById(id) {
    if (!id) return null;
    for (const art of document.querySelectorAll('article[data-testid="tweet"]')) if (getStatusId(art) === id) return art;
    return null;
  }
  function likeBtnById(id) { const art = articleById(id); return art ? art.querySelector('[data-testid="like"]') : null; }
  function rectOf(btn) {
    if (!btn || !btn.isConnected) return null;
    const r = btn.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    if (r.top < VIEW_PAD_TOP || r.bottom > window.innerHeight - VIEW_PAD_BOTTOM) return null;
    return r;
  }
  function pruneSnub(t) { for (const [id, exp] of snubbed) if (t >= exp) snubbed.delete(id); }
  function findTarget() {
    if (dialogOpen()) return null;
    const t = now(); let best = null, bestD = Infinity;
    const cx = px + PET_W / 2, cy = py + PET_H / 2;
    for (const art of document.querySelectorAll('article[data-testid="tweet"]')) {
      const btn = art.querySelector('[data-testid="like"]'); if (!btn) continue;
      const id = getStatusId(art); if (!id) continue;
      const exp = snubbed.get(id); if (exp && t < exp) continue;
      const r = rectOf(btn); if (!r) continue;
      const d = Math.hypot(r.left - cx, r.top - cy);
      if (d < bestD) { bestD = d; best = id; }
    }
    return best;
  }

  // ---------- движение ----------
  function pickWanderTarget() {
    const m = 60;
    tx = m + Math.random() * (window.innerWidth - m * 2 - PET_W);
    ty = window.innerHeight * 0.55 + Math.random() * (window.innerHeight * 0.38 - PET_H);
    wanderUntil = now() + 1800 + Math.random() * 2800;
  }
  function moveToward(gx, gy) {
    const dx = gx - px, dy = gy - py, d = Math.hypot(dx, dy);
    const sp = SPEED * speedMul * runMul;
    if (d <= sp) { px = gx; py = gy; return 0; }
    px += (dx / d) * sp; py += (dy / d) * sp;
    if (Math.abs(dx) > 1) face = dx > 0 ? 1 : -1;
    return d;
  }
  function petNear(r) {
    const cx = px + PET_W / 2, cy = py + PET_H / 2;
    return Math.hypot(cx - (r.left + r.width / 2), cy - (r.top + r.height / 2)) < NEAR;
  }

  function setMode(m) {
    if (mode === m) return;
    mode = m;
    pet.classList.toggle('is-walking', m === 'approach' || m === 'wander');
    pet.classList.toggle('is-begging', m === 'beg');
    pet.classList.toggle('is-happy', m === 'happy');
    bubble.classList.toggle('show', m === 'beg' || m === 'happy');
  }
  function dropTarget(snub) {
    if (snub && targetId) snubbed.set(targetId, now() + SNUB_MS);
    targetId = null; stableFrames = 0; setMode('wander'); pickWanderTarget();
  }
  function resetToWander() { targetId = null; stableFrames = 0; fuseMs = 0; pet.classList.remove('is-fuse'); setMode('wander'); pickWanderTarget(); }

  // ---------- лайк ----------
  function confirmLike(id) {
    let tries = 0;
    const check = () => {
      const art = articleById(id);
      if (art && art.querySelector('[data-testid="unlike"]')) {
        bubble.textContent = '❤!';
        gainXp(LIKE_XP);               // опыт за лайк
        return;
      }
      if (++tries < 6) setTimeout(check, 90); else bubble.textContent = '🙀';
    };
    setTimeout(check, 90);
  }

  // ---------- опыт ----------
  function gainXp(amount) {
    xp += amount;
    Yasia.storage.localSet({ xp });   // левелап покажет onChanged (единый путь)
  }
  function levelUp() {
    bubble.textContent = '⭐ ' + tr().lvl + level;
    bubble.classList.add('show');
    setMode('happy'); happyUntil = now() + 1200;
    spawnParticles('#ffd34d', 14);
    Yasia.events.emit('levelup', { level });   // шина событий: подписчики появятся при выносе систем
  }

  // ---------- пакости (визуальные) ----------
  function maybeMischief(t) {
    if (busy || t < nextMischief || isTyping() || dialogOpen()) return;
    nextMischief = t + 13000 + Math.random() * 15000;
    if (isTwitter && Math.random() < 0.5) stealLetter(); else glassCrack();
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
  function pickTextNode(el) {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (nd) => /\S/.test(nd.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT });
    const nodes = []; let nd; while ((nd = w.nextNode())) nodes.push(nd);
    return nodes.length ? nodes[Math.floor(Math.random() * nodes.length)] : null;
  }
  function stealLetter() {
    const texts = [...document.querySelectorAll('article[data-testid="tweet"] [data-testid="tweetText"]')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.top > VIEW_PAD_TOP && r.bottom < window.innerHeight - VIEW_PAD_BOTTOM; });
    if (!texts.length) return;
    const el = texts[Math.floor(Math.random() * texts.length)], node = pickTextNode(el); if (!node) return;
    const s = node.nodeValue; let idx = -1; const start = Math.floor(Math.random() * s.length);
    for (let k = 0; k < s.length; k++) { const i = (start + k) % s.length; if (/\S/.test(s[i])) { idx = i; break; } }
    if (idx < 0) return;
    const range = document.createRange(); range.setStart(node, idx); range.setEnd(node, idx + 1);
    const r = range.getBoundingClientRect(); if (!r || r.width === 0) return;
    busy = true;
    const cs = getComputedStyle(el), ch = document.createElement('div');
    ch.className = 'twtr-pet-letter'; ch.textContent = s[idx];
    ch.style.left = r.left + 'px'; ch.style.top = r.top + 'px';
    ch.style.fontFamily = cs.fontFamily; ch.style.fontSize = cs.fontSize; ch.style.fontWeight = cs.fontWeight; ch.style.lineHeight = cs.lineHeight; ch.style.color = cs.color;
    root.appendChild(ch);
    const petX = px + PET_W * 0.3, petY = py + 6;
    requestAnimationFrame(() => { ch.style.transform = `translate(${petX - r.left}px, ${petY - r.top}px) rotate(360deg) scale(1.5)`; });
    setTimeout(() => { setMode('happy'); happyUntil = now() + 700; }, 350);
    setTimeout(() => { ch.style.transform = 'translate(0,0) rotate(0deg) scale(1)'; }, 1500);
    setTimeout(() => { ch.remove(); busy = false; setMode('wander'); }, 2200);
  }

  // ---------- кормление ----------
  function feedEat() {
    busy = true;
    // мясо прилетает снизу к питомцу
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

  // ---------- ВЗРЫВ по наведению ----------
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
  // питомца разносит на пиксельные блоки во все стороны (остаются до взмаха мышью)
  function spawnBlocks(cx, cy) {
    const colors = ['#6cba43', '#4f9b34', '#3c7a2c', '#7bd16a', '#14110f'];
    for (let i = 0; i < 26; i++) {
      const b = document.createElement('div'); b.className = 'twtr-block';
      const sz = 5 + Math.random() * 8;
      b.style.width = sz + 'px'; b.style.height = sz + 'px';
      b.style.background = colors[Math.floor(Math.random() * colors.length)];
      b.style.left = cx + 'px'; b.style.top = cy + 'px';
      root.appendChild(b);
      const ang = Math.random() * Math.PI * 2, dist = 30 + Math.random() * 130;
      const dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist * 0.7 + 30 + Math.random() * 70;
      const rot = Math.random() * 720 - 360;
      requestAnimationFrame(() => { b.style.transform = `translate(${dx.toFixed(0)}px, ${dy.toFixed(0)}px) rotate(${rot.toFixed(0)}deg)`; });
      debris.push(b);
    }
  }

  // буквы рядом с эпицентром РАЗЛЕТАЮТСЯ: оригинал прячем (обратимо), летят копии
  function scatterLetters(cx, cy) {
    let count = 0;
    const els = new Set();
    for (let i = 0; i < 16; i++) {
      const ax = cx + (Math.random() * 2 - 1) * 200, ay = cy + (Math.random() * 2 - 1) * 200;
      const el = document.elementFromPoint(ax, ay);
      if (el && el.nodeType === 1 && el !== pet && !root.contains(el) && el.textContent && el.textContent.trim()) els.add(el);
    }
    for (const el of els) {
      if (count >= 90) break;
      const er = el.getBoundingClientRect();
      if (er.height > 160 || el.querySelector('img,svg,video,canvas')) continue; // только текстовые run-ы, не контейнеры
      const cs = getComputedStyle(el);
      const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => /\S/.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT });
      let node, made = false;
      while ((node = tw.nextNode()) && count < 90) {
        const s = node.nodeValue;
        for (let i = 0; i < s.length && count < 90; i++) {
          if (!/\S/.test(s[i])) continue;
          const range = document.createRange(); range.setStart(node, i); range.setEnd(node, i + 1);
          const r = range.getBoundingClientRect();
          if (!r.width) continue;
          const lx = r.left + r.width / 2, ly = r.top + r.height / 2, d = Math.hypot(lx - cx, ly - cy);
          if (d > 330) continue;
          const ch = document.createElement('div'); ch.className = 'twtr-block-letter'; ch.textContent = s[i];
          ch.style.left = r.left + 'px'; ch.style.top = r.top + 'px';
          ch.style.fontFamily = cs.fontFamily; ch.style.fontSize = cs.fontSize; ch.style.fontWeight = cs.fontWeight; ch.style.color = cs.color;
          root.appendChild(ch);
          const ang = Math.atan2(ly - cy, lx - cx) + (Math.random() - 0.5) * 0.8;
          const force = Math.max(45, 240 - d * 0.7) + Math.random() * 60;   // ближе к центру — дальше летит
          const dx = Math.cos(ang) * force, dy = Math.sin(ang) * force + 30, rot = Math.random() * 720 - 360;
          requestAnimationFrame(() => { ch.style.transform = `translate(${dx.toFixed(0)}px, ${dy.toFixed(0)}px) rotate(${rot.toFixed(0)}deg)`; });
          debris.push(ch); count++; made = true;
        }
      }
      if (made) { boomHidden.push({ el, v: el.style.visibility }); el.style.visibility = 'hidden'; } // прячем оригинал
    }
  }

  function explode() {
    fuseMs = 0; pet.classList.remove('is-fuse');
    explodeCooldown = now() + 9000;
    busy = true; boomActive = true;
    const cx = px + PET_W / 2, cy = py + PET_H / 2;
    pet.classList.add('is-boom');
    scatterLetters(cx, cy);   // сначала буквы (пока блоки не перекрыли точки), потом блоки
    spawnBlocks(cx, cy);
    setTimeout(() => { pet.style.visibility = 'hidden'; pet.classList.remove('is-boom'); }, 320);
    startFling();   // курсор улетает по углам; всё застывает до взмаха мышью
  }

  // взмахнул мышью -> убираем весь разлетевшийся мусор, возвращаем курсор и питомца
  function clearBoom() {
    if (!boomActive) return;
    boomActive = false;
    endFling();
    for (const el of debris) { el.style.transition = 'opacity .3s, transform .3s'; el.style.opacity = '0'; const e = el; setTimeout(() => e.remove(), 320); }
    debris = [];
    for (const h of boomHidden) { try { h.el.style.visibility = h.v; } catch (_) {} }   // вернуть оригинальные буквы
    boomHidden = [];
    px = 40 + Math.random() * (window.innerWidth - 80 - PET_W);
    py = window.innerHeight - PET_H - 40; tx = px; ty = py; prevPx = px; prevPy = py;
    pet.style.visibility = '';
    busy = false; setMode('happy'); happyUntil = now() + 600;
  }

  // ---------- курсор «улетает по углам» ----------
  let noCursorStyle = null;
  function injectNoCursor() {
    if (noCursorStyle) return;
    noCursorStyle = document.createElement('style');
    noCursorStyle.textContent = '*{cursor:none !important}';
    document.documentElement.appendChild(noCursorStyle);
  }
  function removeNoCursor() { if (noCursorStyle) { noCursorStyle.remove(); noCursorStyle = null; } }
  function startFling() {
    flung = true; flungUntil = now() + 8000;
    injectNoCursor();
    fakeX = mouseX; fakeY = mouseY; cornerIdx = 0;
    fakeCursor.style.opacity = '1'; fakeCursor.style.display = 'block';
  }
  function updateFling() {
    if (now() > flungUntil) { clearBoom(); return; }   // страховка: само развеется
    const m = 26;
    const corners = [{ x: m, y: m }, { x: window.innerWidth - m, y: m }, { x: window.innerWidth - m, y: window.innerHeight - m }, { x: m, y: window.innerHeight - m }];
    const c = corners[cornerIdx];
    fakeX += (c.x - fakeX) * 0.14; fakeY += (c.y - fakeY) * 0.14;
    if (Math.hypot(c.x - fakeX, c.y - fakeY) < 28) cornerIdx = (cornerIdx + 1) % 4;
    fakeCursor.style.transform = `translate(${fakeX}px, ${fakeY}px)`;
  }
  function endFling() {
    flung = false;
    fakeCursor.style.transform = `translate(${mouseX}px, ${mouseY}px)`;
    fakeCursor.style.opacity = '0';
    setTimeout(() => { fakeCursor.style.display = 'none'; }, 220);
    removeNoCursor();
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
    if (hero === 'catgirl') showFrame('idle');  // замираем на кадре
    e.preventDefault(); e.stopPropagation();
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false; pet.classList.remove('is-grabbed'); jumping = false;
    standLedge = null;                                   // оторвали от опоры — летит/падает
    const power = throwMul;                              // 0..2 (ползунок «Инерция» 0..200%)
    const gain = power <= 1 ? power : 1 + (power - 1) * 9;   // нелинейно: 0%->0, 100%->×1, 200%->×10 (на максе лёгкий толчок отшвыривает)
    const vmax = 34 + 58 * power;                        // ПОТОЛОК скорости растёт с инерцией (34..150); раньше фикс ±38 «съедал» разницу
    const bvx = Math.abs(peakVx) > Math.abs(dragVx) ? peakVx : dragVx;   // берём пик «кисти», а не сглаженный хвост
    const bvy = Math.abs(peakVy) > Math.abs(dragVy) ? peakVy : dragVy;
    vx = clamp(bvx * gain, -vmax, vmax);                 // инерция броска: горизонталь
    vy = clamp(bvy * gain, -vmax, 24 + 28 * power);      // вертикаль (вверх можно сильно подкинуть)
    thrown = true;                                       // дальше physics доводит до приземления (учитывая инерцию)
    saveState();
  });

  // ---------- меню настроек (только размер) ----------
  function applyScale() { if (scaleVal) scaleVal.textContent = Math.round(userScale * 100) + '%'; render(); }
  settingsBtn.addEventListener('click', (e) => { e.stopPropagation(); settingsPanel.classList.toggle('show'); });
  settingsPanel.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return; e.stopPropagation();
    if (b.dataset.act === 'inc') userScale = Math.min(4.8, +(userScale + 0.2).toFixed(2));   // до 2× от прежнего максимума
    if (b.dataset.act === 'dec') userScale = Math.max(0.6, +(userScale - 0.2).toFixed(2));
    applyScale();
    Yasia.storage.syncSet({ scale: userScale });
  });

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
    const t = tr();
    let txt;
    if (d.phase === 'prepare') txt = t.ytPrepare;
    else if (d.phase === 'mux') txt = t.ytMux;
    else if (d.phase === 'buffer') { const pct = d.total ? Math.round(d.loaded / d.total * 100) : 0; txt = t.ytBuffer + pct + t.ytBufferTail; }
    else { const pct = d.total ? Math.round(d.loaded / d.total * 100) : 0; txt = (d.phase === 'video' ? t.ytVideo : t.ytAudio) + pct + '%'; }
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
  const L = {
    en: {
      name: 'Yasia',
      greet: "Hi! I'm Yasia — I live on your feed, walk around the page, you can pet and feed me. Here's what I can do:",
      dl: 'Download video from the page', notes: 'Notes & links', back: 'Back',
      save: 'Save', ph: 'Paste any text or link…', empty: 'No notes yet',
      novideo: "I don't see a video on this page. Open a clip (TikTok / Instagram / YouTube / X) and check again.",
      onpage: 'video on this page', dlbtn: '⬇ Download', wmTt: ' (no watermark)', wmYt: ' (experimental)',
      linkPh: 'Or paste a video link here…',
      hintShare: 'To grab the exact clip: «Share → Copy link», then «Download». Didn\'t work — paste the link in the field above and «Download» again.',
      hintYt: 'Quality = what the player loaded. Want 1080p — set it in the player (⚙), let it play a couple seconds, then «Download».',
      askPh: 'Ask me or find a feature…', aiStub: '🤖 AI chat coming soon. For now I can: download videos and keep notes.', capsEmpty: 'Nothing found for that.',
      other: 'RU',
      // UI вне диалога
      setTitle: 'Pet settings', size: 'Size', show: 'Show pet', hide: 'Hide pet', lvl: 'Lv.', del: 'Delete', video: 'Video', catchVideo: 'Here, catch the video!',
      // статусы скачивания
      stFinding: 'Looking for the video…', stByLink: 'Fetching by link: ', stByLinkFail: "Couldn't fetch the video by link. Open the clip itself (not the feed) and try again.",
      stSaved: '✓ Saved in ', stThrottled: ' (n not sped up — may have been slow)', stDownloading: 'Downloading…',
      stDownOkThrottled: '✓ Downloading (YouTube is throttling — may be slow)', stDownOk: '✓ Downloading!',
      st403: 'YouTube rejected the link (403). Some clips are protected (PO-token) and can\'t be downloaded in the browser without a server — try another clip.',
      stFail: "Failed: ", stErr: 'Error: ',
      tipShare: 'Not sure which clip. Hit «Share → Copy link» (or paste a link in the field below), then «Download».',
      tipNoVideo: 'Video not found. Open the video\'s own page (not the feed) and refresh.',
      ytPrepare: 'Preparing HD…', ytMux: 'Muxing video + audio…', ytBuffer: 'Capturing from player ', ytBufferTail: "% (don't switch this video)", ytVideo: 'Downloading video ', ytAudio: 'Downloading audio ',
    },
    ru: {
      name: 'Яся',
      greet: 'Привет! Я Яся — живу у тебя на ленте, гуляю по странице, можно меня погладить и покормить. Вот что я умею:',
      dl: 'Скачать видео со страницы', notes: 'Заметки и ссылки', back: 'Назад',
      save: 'Сохранить', ph: 'Вставь любой текст или ссылку…', empty: 'Заметок пока нет',
      novideo: 'На этой странице видео не вижу. Открой ролик (TikTok / Instagram / YouTube / X) и загляни снова.',
      onpage: 'видео на странице', dlbtn: '⬇ Скачать', wmTt: ' (без вотермарки)', wmYt: ' (эксперим.)',
      linkPh: 'Или вставь сюда ссылку на ролик…',
      hintShare: 'Чтобы скачать именно нужный ролик: «Поделиться → Копировать ссылку», потом «Скачать». Не сработало — вставь ссылку в поле выше и снова «Скачать».',
      hintYt: 'Качество = то, что загрузил плеер. Нужен 1080p — выставь его в плеере (⚙) и дай доиграться пару секунд, потом «Скачать».',
      askPh: 'Спроси меня или найди функцию…', aiStub: '🤖 Чат с ИИ скоро подключим. Пока я умею: скачивать видео и вести заметки.', capsEmpty: 'Ничего не нашла по запросу.',
      other: 'EN',
      // UI вне диалога
      setTitle: 'Настройки питомца', size: 'Размер', show: 'Показать питомца', hide: 'Спрятать питомца', lvl: 'Ур.', del: 'Удалить', video: 'Видео', catchVideo: 'Лови видео!',
      // статусы скачивания
      stFinding: 'Ищу видео…', stByLink: 'Беру по ссылке: ', stByLinkFail: 'Не достал видео по ссылке. Открой сам ролик (не ленту) и попробуй снова.',
      stSaved: '✓ Скачано в ', stThrottled: ' (n не ускорен — могло быть медленно)', stDownloading: 'Качаю…',
      stDownOkThrottled: '✓ Скачивается (YouTube троттлит — может медленно)', stDownOk: '✓ Скачивается!',
      st403: 'YouTube отклонил ссылку (403). Часть роликов защищена (PO-token) и в браузере без сервера не качается — попробуй другой ролик.',
      stFail: 'Не вышло: ', stErr: 'Ошибка: ',
      tipShare: 'Не понял, какой ролик. Нажми «Поделиться → Копировать ссылку» (или вставь ссылку в поле ниже), потом «Скачать».',
      tipNoVideo: 'Видео не найдено. Открой страницу самого видео (не ленту) и обнови.',
      ytPrepare: 'Готовлю HD…', ytMux: 'Склеиваю видео + звук…', ytBuffer: 'Захватываю из плеера ', ytBufferTail: '% (не переключай это видео)', ytVideo: 'Качаю видео ', ytAudio: 'Качаю звук ',
    },
  };
  let dlgLang = 'en';
  const tr = () => L[dlgLang] || L.en;
  const setTxt = (sel, txt) => { const el = root.querySelector(sel); if (el) el.textContent = txt; };
  function renderDlgLang() {
    const t = tr();
    setTxt('#twtr-dlg-greet', t.greet);
    setTxt('#twtr-cap-dl-tx', t.dl);
    setTxt('#twtr-cap-notes-tx', t.notes);
    setTxt('#twtr-dlg-save', t.save);
    setTxt('#twtr-dlg-lang', t.other);
    if (dlgText) dlgText.placeholder = t.ph;
    const ask = root.querySelector('#twtr-dlg-ask'); if (ask) ask.placeholder = t.askPh;
    const ai = root.querySelector('#twtr-dlg-ai'); if (ai && !ai.hidden) ai.textContent = t.aiStub;
    const ce = root.querySelector('#twtr-dlg-capsempty'); if (ce && !ce.hidden) ce.textContent = t.capsEmpty;
    renderNotes();
    const dlBody = root.querySelector('#twtr-skill-dl');
    if (dlBody && !dlBody.hidden) buildVideoSection();   // скил видео открыт -> перерисовать на новом языке
    applyLang();   // язык остального UI (заголовок окна, панель настроек, тултипы)
  }
  // язык статичного UI вне диалога: заголовок облачка, панель настроек, кнопка показать/спрятать
  function applyLang() {
    const t = tr();
    setTxt('.twtr-dlg-title', '🐱 ' + t.name);
    setTxt('.twtr-set-title', t.setTitle);
    setTxt('#twtr-set-size-label', t.size);
    if (typeof applyEnabled === 'function') applyEnabled();   // тултип кнопки 🐾 на нужном языке
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
  // обращение к ИИ (вторая функция поля) — ЗАГЛУШКА до подключения LLM
  function askAI(q) {
    if (!(q || '').trim()) return;
    const ai = root.querySelector('#twtr-dlg-ai'); if (!ai) return;
    ai.hidden = false; ai.textContent = tr().aiStub;   // TODO: сюда подключить ответ LLM
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
    if (which === 'dl') buildVideoSection();
    else { renderNotes(); try { dlgText.focus(); } catch (_) {} }
  }

  function buildVideoSection() {
    const t = tr();
    const p = detectPlatform();
    const known = (p === 'tiktok' || p === 'twitter' || p === 'instagram' || p === 'youtube');
    const hintStyle = 'font-size:11px;color:#536471;margin-top:6px;line-height:1.35;';
    if (!known && !extractGeneric()) { dlgVideo.innerHTML = `<div class="twtr-dlg-hint" style="${hintStyle}">${t.novideo}</div>`; return; }
    const name = { tiktok: 'TikTok', twitter: 'Twitter / X', instagram: 'Instagram', youtube: 'YouTube' }[p] || t.video;
    const wm = p === 'tiktok' ? t.wmTt : (p === 'youtube' ? t.wmYt : '');
    const hint = (p === 'tiktok' || p === 'instagram') ? `<div class="twtr-dlg-hint" style="${hintStyle}">${t.hintShare}</div>`
      : (p === 'youtube' ? `<div class="twtr-dlg-hint" style="${hintStyle}">${t.hintYt}</div>` : '');
    const linkField = (p === 'tiktok' || p === 'instagram' || p === 'twitter') ? `<input class="twtr-dlg-link" id="twtr-dlg-link" type="text" placeholder="${t.linkPh}">` : '';
    dlgVideo.innerHTML = `<span class="twtr-dlg-plat">🎬 ${name} — ${t.onpage}</span>${linkField}<button class="twtr-dlg-dl" id="twtr-dlg-dl" type="button">${t.dlbtn}${wm}</button><div class="twtr-dlg-status" id="twtr-dlg-status"></div>${hint}`;
    dlgVideo.querySelector('#twtr-dlg-dl').addEventListener('click', (e) => { e.stopPropagation(); doDownload(e.currentTarget); });
  }

  async function doDownload(btn) {
    const t = tr();
    const status = dlgVideo.querySelector('#twtr-dlg-status');
    const setStatus = (cls, txt) => { if (status) { status.className = 'twtr-dlg-status ' + cls; status.textContent = txt; } };
    btn.disabled = true; setStatus('', t.stFinding);
    const plat0 = detectPlatform();
    let media = null, explicit = false;
    // 1) если в буфере/поле — ссылка на ролик (TikTok/IG/X), берём ИМЕННО его. Ссылка АВТОРИТЕТНА:
    //    либо это видео, либо честный отказ — НИКОГДА не откатываемся в угадывание ленты (было «качает рандом»).
    try { const lt = await explicitLinkTarget(); if (lt) { explicit = true; setStatus('', t.stByLink + (lt.id || lt.code || 'ok') + '…'); media = await resolveExplicit(lt); } } catch (_) {}
    if (explicit && (!media || !media.url)) { setStatus('err', t.stByLinkFail); btn.disabled = false; return; }
    // 2) ссылки нет — определяем видео по странице (без рандома: если не опознали однозначно, будет «не найдено»)
    if (!media) { try { media = await resolveCurrentVideo(); } catch (_) {} }
    // YouTube HD: файл уже склеен и сохранён прямо в странице (mp4box -> Blob -> download)
    if (media && media.ok && media.hd) { setStatus('ok', t.stSaved + media.quality + (media.throttled ? t.stThrottled : '')); say(t.catchVideo, 1800); btn.disabled = false; return; }
    if (media && media.error) { setStatus('err', media.error); btn.disabled = false; return; }
    if (!media || !media.url) {
      const tip = (plat0 === 'tiktok' || plat0 === 'instagram') ? t.tipShare : t.tipNoVideo;
      setStatus('err', tip); btn.disabled = false; return;
    }
    setStatus('', t.stDownloading);
    try {
      // validate: прогнать через fetch+проверку content-type (YouTube/обычные сайты могут отдать html/текст -> иначе сохранится .txt)
      const plat = detectPlatform();
      const validate = !media.referer && (plat === 'youtube' || plat === 'generic');
      const res = await chrome.runtime.sendMessage({ type: 'YASIA_DOWNLOAD', url: media.url, filename: media.filename, referer: media.referer || null, validate });
      if (res && res.ok) { setStatus('ok', media.throttled ? t.stDownOkThrottled : t.stDownOk); say(t.catchVideo, 1800); }
      else if (plat === 'youtube' && /\b403\b/.test((res && res.error) || '')) setStatus('err', t.st403);
      else setStatus('err', t.stFail + ((res && res.error) || 'error'));
    } catch (err) { setStatus('err', t.stErr + String((err && err.message) || err)); }
    btn.disabled = false;
  }

  // --- заметки ---
  let notes = [];
  function escHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function linkify(s) { return escHtml(s).replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'); }
  function renderNotes() {
    if (!dlgList) return;
    if (!notes.length) { dlgList.innerHTML = `<div class="twtr-dlg-empty">${tr().empty}</div>`; return; }
    dlgList.innerHTML = notes.map((n) => `<div class="twtr-dlg-note"><span>${linkify(n.text)}</span><button class="twtr-dlg-note-del" data-del="${n.id}" type="button" title="${tr().del}">✕</button></div>`).join('');
    dlgList.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); const id = b.getAttribute('data-del'); notes = notes.filter((n) => n.id !== id); saveNotes(); renderNotes(); }));
  }
  function saveNotes() { Yasia.storage.localSet({ yasiaNotes: notes }); }
  function addNote() { const v = dlgText.value.trim(); if (!v) return; notes.unshift({ id: String(Date.now()) + Math.floor(Math.random() * 1000), text: v }); saveNotes(); renderNotes(); dlgText.value = ''; }
  Yasia.storage.localGet({ yasiaNotes: [] }, (s) => { notes = Array.isArray(s.yasiaNotes) ? s.yasiaNotes : []; renderNotes(); });

  function openDialog() {
    try { window.postMessage({ __yasiaCollect: true }, '*'); } catch (_) {}
    const ask = root.querySelector('#twtr-dlg-ask'); if (ask) ask.value = '';
    const ai = root.querySelector('#twtr-dlg-ai'); if (ai) ai.hidden = true;
    closeAllSkills(); renderDlgLang(); renderNotes(); filterCaps('');
    dialog.classList.add('show'); positionDialog();
  }
  function closeDialog() { dialog.classList.remove('show'); }
  root.querySelector('#twtr-dlg-x').addEventListener('click', (e) => { e.stopPropagation(); closeDialog(); });
  root.querySelector('#twtr-dlg-backdrop').addEventListener('click', (e) => { e.stopPropagation(); closeDialog(); });
  root.querySelector('#twtr-dlg-save').addEventListener('click', (e) => { e.stopPropagation(); addNote(); });
  root.querySelector('#twtr-dlg-lang').addEventListener('click', (e) => { e.stopPropagation(); dlgLang = dlgLang === 'ru' ? 'en' : 'ru'; try { Yasia.storage.syncSet({ dlgLang }); } catch (_) {} renderDlgLang(); });
  root.querySelector('#twtr-cap-dl').addEventListener('click', (e) => { e.stopPropagation(); toggleSkill('dl'); });
  root.querySelector('#twtr-cap-notes').addEventListener('click', (e) => { e.stopPropagation(); toggleSkill('notes'); });
  const askEl = root.querySelector('#twtr-dlg-ask');
  if (askEl) {
    askEl.addEventListener('input', (e) => { e.stopPropagation(); filterCaps(askEl.value); });           // печатаешь -> фильтр возможностей сверху
    askEl.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); askAI(askEl.value); } });   // Enter -> к ИИ (заглушка)
  }
  root.querySelector('#twtr-dlg-asksend').addEventListener('click', (e) => { e.stopPropagation(); askAI(askEl ? askEl.value : ''); });
  try { Yasia.storage.syncGet({ dlgLang: 'en' }, (s) => { dlgLang = (s && s.dlgLang === 'ru') ? 'ru' : 'en'; renderDlgLang(); }); } catch (_) {}
  dlgText.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); addNote(); } });
  dialog.addEventListener('mousedown', (e) => e.stopPropagation());   // работаем в окне, не таскаем Ясю
  dialog.addEventListener('click', (e) => e.stopPropagation());

  // ---------- клик по питомцу ----------
  pet.addEventListener('click', (e) => {
    e.stopPropagation();
    if (didDrag) { didDrag = false; return; }   // это было перетаскивание, не клик
    if ((mode === 'beg' || mode === 'approach') && targetId && !isTyping() && !dialogOpen()) {
      const btn = likeBtnById(targetId), r = rectOf(btn);
      if (r && stableFrames >= STABLE_FRAMES && petNear(r)) {
        btn.click();
        const id = targetId; targetId = null;
        bubble.textContent = '❤?'; setMode('happy'); happyUntil = now() + HAPPY_MS;
        confirmLike(id);
        return;
      }
    }
    setMode('happy'); happyUntil = now() + 1200;   // гладят — машет ручкой
    openDialog();                                   // и открываем окошко (заметки + скачать видео со страницы)
  });

  // ---------- платформер: жизнь по структуре страницы ----------
  function petW() { return PET_W * sizeMul * userScale; }   // эффективная ширина с учётом размера = ХИТБОКС (растёт/уменьшается)
  function collectLedges() {
    const vw = window.innerWidth, vh = window.innerHeight, out = [], seen = new Set();
    const els = document.querySelectorAll('article,[data-testid="tweet"],[data-testid="tweetText"],h1,h2,h3,[role="heading"],img,button,p,li');
    for (const el of els) {
      if (root.contains(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 44 || r.height < 14) continue;
      if (r.top < 6 || r.top > vh - 10) continue;
      const x1 = Math.max(4, r.left), x2 = Math.min(vw - 4, r.right);
      if (x2 - x1 < Math.max(40, petW() * 0.8)) continue;   // узкая для её ХИТБОКСА (растёт с размером) -> не встать/не запрыгнуть
      if (x2 - x1 > vw * 0.62) continue;          // слишком широкое — это контейнер/фон, а не «полка»
      const key = Math.round(r.top / 6) + ':' + Math.round(x1 / 24);
      if (seen.has(key)) continue; seen.add(key);
      out.push({ el, x1, x2, y: Math.round(r.top) });
      if (out.length > 70) break;
    }
    out.push({ el: null, floor: true, x1: 0, x2: vw, y: vh - PLAT_FLOOR });   // пол внизу: падает до него, если в её колонке нет элемента, потом запрыгивает наверх
    out.sort((a, b) => a.y - b.y);
    return out;
  }
  function reacquireFloor() {                          // после пересканирования вернуть опору без el (пол)
    if (!standLedge || standLedge.el) return;
    const cx = px + PET_W / 2, foot = py + PET_H;
    for (const L of ledges) if (cx >= L.x1 && cx <= L.x2 && Math.abs(L.y - foot) < 6) { standLedge = L; return; }
  }
  function startJump(L, tgtCenterX, t) {
    jumping = true; climbing = false; jumpT = t; jumpDest = L;
    jumpFromX = px; jumpFromY = py;
    jumpToX = clamp(tgtCenterX - PET_W / 2, L.x1, L.x2 - PET_W);
    jumpToY = L.y - PET_H;
    jumpPeak = Math.max(46, (jumpFromY - jumpToY) + 50);   // дуга всегда выше обеих точек
    if (jumpToX !== px) face = jumpToX > px ? 1 : -1;
    pet.classList.add('is-jump');
    if (Math.random() < 0.35) say(pick(says('jump')), 1100);
  }
  function updateJump(t) {
    const k = clamp((t - jumpT) / PLAT_JUMP_MS, 0, 1);
    px = jumpFromX + (jumpToX - jumpFromX) * k;
    py = (jumpFromY + (jumpToY - jumpFromY) * k) - Math.sin(Math.PI * k) * jumpPeak;
    const minTop = PET_H * Math.max(0, sizeMul * userScale - 1);
    if (py < minTop) py = minTop;                 // не выше верхнего края экрана
    if (k >= 1) {
      jumping = false; pet.classList.remove('is-jump');
      standLedge = jumpDest; px = jumpToX; py = jumpToY; vy = 0;
      walkTargetX = px; nextJumpDecide = t + 1600 + Math.random() * 2000;
    }
  }
  function tryClimb(t) {
    const cx = px + PET_W / 2;
    climbing = false;
    const minLedgeY = PET_H * Math.max(1, sizeMul * userScale);   // полки выше этого — за верхом экрана, игнор
    let best = null, anyUp = null;
    for (const L of ledges) {
      if (L === standLedge) continue;
      if (L.y < minLedgeY) continue;                  // не запрыгивать выше экрана
      const up = standLedge.y - L.y;                  // >0 — полка выше на экране
      if (up > 4 && up <= PLAT_JUMP_UP * 1.6 && (!anyUp || L.y < anyUp.y)) anyUp = L;   // только достижимое выше — иначе не тянется к далёкому (на Discord и т.п.)
      if (up <= 4 || up > PLAT_JUMP_UP) continue;
      const tgtX = clamp(cx, L.x1 + PET_W / 2, L.x2 - PET_W / 2);
      if (Math.abs(tgtX - cx) > PLAT_JUMP_DX) continue;
      const score = up - Math.abs(tgtX - cx) * 0.35;
      if (!best || score > best.score) best = { L, tgtX };
    }
    if (best) { startJump(best.L, best.tgtX, t); return; }
    if (anyUp) {                                       // выше есть, но далеко — подходим обычной ходьбой (без позы карабканья)
      walkTargetX = clamp((anyUp.x1 + anyUp.x2) / 2, standLedge.x1, standLedge.x2 - PET_W);
      return;
    }
    // добрался до самого верха — гуляет / иногда прыгает на случайную полку
    if (Math.random() < 0.4 && ledges.length > 2) {
      const L = ledges[Math.floor(Math.random() * ledges.length)];
      const tx2 = clamp(cx, L.x1 + PET_W / 2, L.x2 - PET_W / 2);
      if (L !== standLedge && L.y >= minLedgeY && Math.abs(tx2 - cx) <= PLAT_JUMP_DX && Math.abs(standLedge.y - L.y) <= PLAT_JUMP_UP) { startJump(L, tx2, t); return; }
    }
    const m = 45;   // иногда цель чуть за краем -> шагнёт с края и упадёт (платформер)
    walkTargetX = standLedge.x1 - m + Math.random() * (standLedge.x2 - standLedge.x1 + 2 * m);
    if (Math.random() < 0.15) say(pick(says('top')), 1600);
  }
  function walkAlong(t) {
    running = true;   // бег по умолчанию
    const sp = SPEED * speedMul * userSpeed * RUN_MUL;
    const dx = walkTargetX - px;
    if (Math.abs(dx) <= sp) px = walkTargetX;
    else { px += Math.sign(dx) * sp; face = dx > 0 ? 1 : -1; }
    px = clamp(px, 0, window.innerWidth - PET_W);   // по краю экрана; за край ОПОРЫ выходить можно -> упадёт
  }
  function platformerTick(t, dt) {
    if (t - lastLedgeScan > 140) { lastLedgeScan = t; ledges = collectLedges(); reacquireFloor(); }
    if (standLedge && standLedge.el) {                 // едем вместе с прокруткой, пока стоим на элементе
      const r = standLedge.el.getBoundingClientRect();
      if (!r || r.width < 30 || r.top < 0 || r.top > window.innerHeight) standLedge = null;
      else { standLedge.y = r.top; standLedge.x1 = Math.max(4, r.left); standLedge.x2 = Math.min(window.innerWidth - 4, r.right); }
    }
    if (jumping) { falling = false; thrown = false; updateJump(t); return; }
    if (standLedge) {
      falling = false; thrown = false;
      py = standLedge.y - PET_H;
      walkAlong(t);
      if (t > nextJumpDecide) { nextJumpDecide = t + 2200 + Math.random() * 2600; tryClimb(t); }
      const cxf = px + PET_W / 2;
      if (cxf < standLedge.x1 - 2 || cxf > standLedge.x2 + 2) standLedge = null;   // сошла с края опоры -> падает
    } else {                                            // падаем/летим, ловим ближайшую полку под ногами
      falling = true;                                   // -> показываем позу climb (руки вверх, «летит/цепляется»)
      const f = Math.min(dt / 16, 3);
      if (Math.abs(vx) > 0.05) {                         // ИНЕРЦИЯ броска: летит вбок, тормозит воздухом
        px += vx * f;
        vx *= Math.pow(0.90, f);                         // трение
        if (Math.abs(vx) > 1) face = vx < 0 ? -1 : 1;    // смотрит туда, куда летит
        if (px <= 0) { px = 0; vx = -vx * 0.35; }                                   // мягкий отскок от краёв
        else if (px >= window.innerWidth - PET_W) { px = window.innerWidth - PET_W; vx = -vx * 0.35; }
        if (Math.abs(vx) < 0.3) vx = 0;
      }
      vy = Math.min(vy + PLAT_GRAVITY * f, 26);
      const prevFoot = py + PET_H;
      py += vy * f;
      const foot = py + PET_H, cx = px + PET_W / 2;
      let landed = null;
      for (const L of ledges) {
        if (cx < L.x1 || cx > L.x2) continue;
        if (L.y >= prevFoot - 1 && L.y <= foot + 1) { if (!landed || L.y < landed.y) landed = L; }
      }
      if (landed) { falling = false; thrown = false; vx = 0; standLedge = landed; py = landed.y - PET_H; vy = 0; walkTargetX = px; nextJumpDecide = t + 1200; }
      // если в колонке ничего нет — продолжает лететь/падать до пола, потом сама запрыгнет наверх
    }
    py = clamp(py, PET_H * Math.max(0, sizeMul * userScale - 1), window.innerHeight - PET_H);   // держим в пределах экрана
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
    if (flung) updateFling();
    if (busy) { render(); return; }

    if (location.href !== lastHref) { lastHref = location.href; resetToWander(); }

    runMul = running ? RUN_MUL : 1;

    if (dragging) {
      px = clamp(mouseX - dragOffX, 0, window.innerWidth - PET_W);
      py = clamp(mouseY - dragOffY, 0, window.innerHeight - PET_H);
      if (Math.hypot(px - grabPx, py - grabPy) > 5) didDrag = true;
      const fdt = Math.max(dt, 1) / 16;                  // нормируем к кадру 16мс
      const ivx = (px - lastDragX) / fdt, ivy = (py - lastDragY) / fdt;
      dragVx = dragVx * 0.4 + ivx * 0.6;                 // отзывчивее — ловим даже быстрый лёгкий флик
      dragVy = dragVy * 0.4 + ivy * 0.6;
      peakVx = Math.abs(ivx) > Math.abs(peakVx) ? ivx : peakVx * 0.85;   // пик скорости кисти (чтобы лёгкий толчок не терялся в сглаживании)
      peakVy = Math.abs(ivy) > Math.abs(peakVy) ? ivy : peakVy * 0.85;
      lastDragX = px; lastDragY = py;
    } else if (dialog.classList.contains('show')) {      // окно открыто -> Яся замерла, не ходит
      if (mode === 'happy' && t > happyUntil) setMode('idle');
    } else if (thrown) {
      platformerTick(t, dt);                             // летит по инерции и падает, пока не приземлится
    } else if (mode === 'happy') {
      if (t > happyUntil) { bubble.textContent = '❤?'; bubble.classList.remove('show'); setMode('idle'); }
    } else {
      platformerTick(t, dt);            // живёт по структуре страницы: стоит на элементах, прыгает по полкам
      if (t > nextChatter) { nextChatter = t + 9000 + Math.random() * 12000; say(Math.random() < 0.32 ? pick(says('event')) : pick(says('idle')), 2000); }
    }

    // голодный — иногда просит мяса
    if (!busy && mode !== 'happy' && currentHunger() > 78 && Math.random() < 0.003) {
      bubble.textContent = '🍖'; bubble.classList.add('show');
      setTimeout(() => { if (bubble.textContent === '🍖') bubble.classList.remove('show'); }, 1600);
    }

    updateHop();
    if (hero === 'catgirl' && !dragging) {        // переключаем слой-кадр по состоянию (без смены src -> без мерцания)
      const mv = pet.classList.contains('is-moving');
      let setName, ms;
      if (mode === 'happy') { setName = 'wave'; ms = CAT_IDLE_MS; }  // гладят/здороваются — машет
      else if (jumping) { setName = 'jump'; ms = CAT_JUMP_MS; }
      else if (falling) { setName = 'climb'; ms = CAT_CLIMB_MS; }         // падает сверху — руки вверх (поза climb)
      else if (mv) { setName = 'walk'; ms = (running ? CAT_RUN_MS : CAT_WALK_MS) / userSpeed; }   // медленнее идёт -> медленнее кадры (ноги не скользят)
      else { setName = 'idle'; ms = CAT_IDLE_MS; }
      const frames = CAT_SETS[setName];
      sprite.classList.toggle('xf', !!EMO_XFADE[setName]);       // кросс-фейд кадров — только для эмоций-поз
      if (catAct !== setName) { catAct = setName; catIdx = 0; showFrame(frames[0]); lastFrameT = t; }
      else if (frames.length > 1 && t - lastFrameT > ms) { lastFrameT = t; catIdx = (catIdx + 1) % frames.length; showFrame(frames[catIdx]); }
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
    if (hero === 'catgirl') { hopY = 0; }        // у кошки настоящий цикл ходьбы — процедурный подпрыг убираем (он давал рывки вверх-вниз)
    else if (walking) { hopPhase += moved * 0.35; hopY = -Math.abs(Math.sin(hopPhase)) * 5; }
    else { hopY *= 0.8; if (Math.abs(hopY) < 0.2) hopY = 0; }
  }

  function render() {
    pet.style.transform = `translate(${px.toFixed(2)}px, ${py.toFixed(2)}px)`;   // субпиксель -> без «ступенек» при нецелой скорости
    const s = sizeMul * userScale;
    inner.style.transform = `translateY(${hopY.toFixed(1)}px) scaleX(${(face * s).toFixed(3)}) scaleY(${s.toFixed(3)})`;
    // спрайт растёт вверх от низа — поднимаем облачко над реальной макушкой, чтобы не заслоняло
    bubble.style.marginBottom = (12 + PET_H * Math.max(0, s - 1)).toFixed(0) + 'px';
  }

  // ---------- переход между вкладками ----------
  function saveState() { Yasia.storage.localSet({ [STATE_KEY]: { x: px, y: py, face } }); }
  function restoreState(done) {
    Yasia.storage.localGet({ [STATE_KEY]: null }, (s) => {
      const st = s[STATE_KEY];
      if (st && typeof st.x === 'number') { px = clamp(st.x, 0, window.innerWidth - PET_W - 8); py = clamp(st.y, 0, window.innerHeight - PET_H - 8); tx = px; ty = py; prevPx = px; prevPy = py; if (typeof st.face === 'number') face = st.face; }
      if (done) done();
    });
  }
  function arrive() { render(); pet.style.opacity = '1'; setMode('happy'); happyUntil = now() + 700; bubble.textContent = '🟩'; bubble.classList.add('show'); setTimeout(() => { if (bubble.textContent === '🟩') { bubble.classList.remove('show'); bubble.textContent = '❤?'; } }, 1200); }

  // ---------- настройки / игровое состояние ----------
  function applyEnabled() {
    pet.style.display = enabled ? '' : 'none';
    if (enabled) pet.style.opacity = '1';
    toggle.classList.toggle('off', !enabled);
    toggle.title = enabled ? tr().hide : tr().show;
  }
  toggle.addEventListener('click', (e) => { e.stopPropagation(); enabled = !enabled; applyEnabled(); Yasia.storage.syncSet({ enabled }); });
  applyEnabled();
  applyHero();

  const isTwitter = (() => { const h = location.hostname; return h === 'x.com' || h.endsWith('.x.com') || h === 'twitter.com' || h.endsWith('.twitter.com'); })();

  try {
    Yasia.storage.syncGet({ enabled: true, hero: 'catgirl', scale: 1.8 }, (s) => { enabled = s.enabled; hero = s.hero; userScale = s.scale || 1.8; applyEnabled(); applyHero(); applyScale(); });
    Yasia.storage.localGet({ hunger: 0, hungerAt: Date.now(), xp: 0 }, (s) => {
      hungerBase = s.hunger; hungerAt = s.hungerAt; xp = s.xp; applyAbilities();
    });
    Yasia.storage.onChanged((ch) => {
      if (ch.enabled) { enabled = ch.enabled.newValue; applyEnabled(); }
      if (ch.hero) { hero = ch.hero.newValue; applyHero(); }
      if (ch.scale) { userScale = ch.scale.newValue || 1; applyScale(); }
      if (ch.dlgLang) { dlgLang = ch.dlgLang.newValue === 'ru' ? 'ru' : 'en'; renderDlgLang(); }   // язык переключили из попапа
      if (ch.xp) {
        const prev = level;
        xp = ch.xp.newValue; applyAbilities();
        if (level > prev) setTimeout(levelUp, ch.feedPing ? 1300 : 200); // после жевания, если кормили
      }
      if (ch.hunger) hungerBase = ch.hunger.newValue;
      if (ch.hungerAt) hungerAt = ch.hungerAt.newValue;
      if (ch.feedPing) feedEat();   // покормили из попапа
    });
  } catch (_) {}

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = now(); saveState(); }
    else {
      if (hiddenAt) { const d = now() - hiddenAt; hiddenAt = 0; begUntil += d; happyUntil += d; wanderUntil += d; }
      pet.style.opacity = '0'; restoreState(arrive);
    }
  });

  window.addEventListener('resize', () => { px = clamp(px, 0, window.innerWidth - PET_W - 8); py = clamp(py, 0, window.innerHeight - PET_H - 8); });

  window.addEventListener('mousemove', (e) => {
    if (boomActive && Math.hypot(e.clientX - mouseX, e.clientY - mouseY) > 4) clearBoom(); // взмахнул — всё развеялось
    mouseX = e.clientX; mouseY = e.clientY;
  });

  pickWanderTarget();
  nextMischief = now() + 9000 + Math.random() * 8000;
  if (document.visibilityState === 'visible') { pet.style.opacity = '0'; restoreState(arrive); }
  requestAnimationFrame(tick);
})();
