// Движок платформера — state-машина движения, вынесенная из pet.js (v0.1 роадмапа, шаг 3 после physics/i18n).
// Движок ВЛАДЕЕТ: снимком полок (ledges) и внутренним состоянием прыжка (откуда/куда/горб/фаза/дроп).
// Общее состояние питомца (позиция, скорости, флаги jumping/falling, опора standLedge, цель ходьбы) живёт
// в pet.js и приходит мостом S (объект с get/set — pet.js остаётся хозяином своих переменных, поведение 1:1).
// Оркестрация режимов (стояние/ходьба/поход к видео/игры/тесты) остаётся в pet.js — он зовёт методы движка.
// Чистая математика (дуга, фильтры полок, кандидаты) — в core/physics.js, она покрыта node-тестами.
(() => {
  'use strict';
  const Yasia = (window.Yasia = window.Yasia || {});
  const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

  // S  — мост к состоянию pet.js (get/set): px, py, vx, vy, face, jumping, falling, thrown, climbing,
  //      standLedge, walkTargetX, nextJumpDecide, lastLeftEl
  // env — параметры и колбэки pet.js:
  //      params() -> { W, H, dx, up, gravity, jumpMs, floorPad, scaleK }  (живые значения: размер героя меняется)
  //      petW() — хитбокс с учётом масштаба; rootContains(el) — наш UI не полка;
  //      goalClimbing() — лезет к видео/игровой цели (после приземления сразу перепланировать);
  //      onJumpStart()/onJumpEnd() — CSS-класс прыжка; sayJump()/sayTop() — реплики.
  function createEngine(S, env) {
    let ledges = [];
    let jumpT = 0, jumpFromX = 0, jumpFromY = 0, jumpToX = 0, jumpToY = 0, jumpPeak = 0, jumpDest = null, jumpDrop = false, jumpPounce = false;
    const POUNCE_UP = 1.9, POUNCE_DX = 1.45;   // НАСКОК дотягивается выше/дальше обычного прыжка (используется, когда обычным не достать)
    const SEL = 'article,[data-testid="tweet"],[data-testid="tweetText"],h1,h2,h3,[role="heading"],img,button,p,li';

    function scan() {   // пересобрать полки из DOM (фильтры — physics.ledgeFromRect) + пол внизу
      const vw = window.innerWidth, vh = window.innerHeight, out = [], seen = new Set();
      const p = env.params();
      const els = document.querySelectorAll(SEL);
      for (const el of els) {
        if (env.rootContains(el)) continue;
        const r = el.getBoundingClientRect();
        const lg = Yasia.physics.ledgeFromRect(r, vw, vh, env.petW(), () => !!el.querySelector(SEL));   // querySelector — лениво
        if (!lg) continue;
        const key = Math.round(lg.y / 6) + ':' + Math.round(lg.x1 / 24);
        if (seen.has(key)) continue; seen.add(key);
        out.push({ el, x1: lg.x1, x2: lg.x2, y: lg.y });
        if (out.length > 70) break;
      }
      out.push({ el: null, floor: true, x1: 0, x2: vw, y: vh - p.floorPad });   // пол: падает до него, если в колонке пусто
      out.sort((a, b) => a.y - b.y);
      ledges = out;
      return ledges;
    }
    function reacquireFloor() {   // после пересканирования вернуть опору без el (пол)
      if (!S.standLedge || S.standLedge.el) return;
      const p = env.params();
      const cx = S.px + p.W / 2, foot = S.py + p.H;
      for (const L of ledges) if (cx >= L.x1 && cx <= L.x2 && Math.abs(L.y - foot) < 6) { S.standLedge = L; return; }
    }

    function land(t) {   // приземление (общая часть дуги и дропа)
      S.jumping = false; jumpDrop = false; env.onJumpEnd();
      S.standLedge = jumpDest; S.px = jumpToX; S.py = jumpToY; S.vy = 0;
      S.walkTargetX = S.px;
      S.nextJumpDecide = env.goalClimbing() ? t : (t + 1600 + Math.random() * 2000);   // к цели -> сразу пере-проба; гуляние -> пауза
    }
    function startJump(L, tgtCenterX, t, opt) {
      const p = env.params();
      jumpPounce = !!(opt && opt.pounce);                             // наскок: тот же прыжок, но горб выше (долетает до высокой полки) + кадры pounce
      S.jumping = true; S.climbing = false; jumpT = t; jumpDest = L;
      jumpFromX = S.px; jumpFromY = S.py;
      jumpToX = clamp(tgtCenterX - p.W / 2, L.x1, L.x2 - p.W);
      jumpToY = L.y - p.H;
      jumpDrop = !jumpPounce && Yasia.physics.isDropJump(jumpFromY, jumpToY, p.up);   // блок заметно ниже -> спуск падением (наскок — всегда дуга вверх)
      if (jumpDrop) S.vy = 0;                                          // чистое падение от текущей высоты
      jumpPeak = Yasia.physics.jumpPeakFor(jumpFromY, jumpToY) + (jumpPounce ? 46 : 0);   // дуга всегда выше обеих точек; наскок — ещё выше
      if (jumpToX !== S.px) S.face = jumpToX > S.px ? 1 : -1;
      env.onJumpStart();
      if (Math.random() < 0.35) env.sayJump();
    }
    // кандидаты для НАСКОКА: полки СТРОГО выше обычного диапазона прыжка (обычным не достать), но в пределах наскока
    function pounceCandidates(cx, p) {
      return Yasia.physics.climbCandidates(ledges, S.standLedge, cx, {
        W: p.W, dx: p.dx * POUNCE_DX, up: p.up * POUNCE_UP,
        minY: p.H * Math.max(1, p.scaleK), lastLeftEl: S.lastLeftEl,
      }).filter((c) => c.L.y < S.standLedge.y - p.up - 4 && c.L.y >= S.standLedge.y - p.up * POUNCE_UP);   // только «недопрыгиваемое обычным», но достижимое наскоком
    }
    function updateJump(t) {
      const p = env.params();
      if (jumpDrop) {                                 // СПУСК НИЖЕ: толчок вбок к цели + гравитация (кадры fall)
        S.vy = Math.min(S.vy + p.gravity, 26);
        S.py += S.vy;
        const adx = jumpToX - S.px;
        if (Math.abs(adx) > 1) { S.px += clamp(adx, -7, 7); S.face = adx > 0 ? 1 : -1; }
        if (S.py >= jumpToY) land(t);                 // долетела до уровня блока -> приземление
        return;
      }
      const k = clamp((t - jumpT) / p.jumpMs, 0, 1);
      const ap = Yasia.physics.jumpArcPos(jumpFromX, jumpFromY, jumpToX, jumpToY, jumpPeak, k);
      S.px = ap.x; S.py = ap.y;
      const minTop = p.H * Math.max(0, p.scaleK - 1);
      if (S.py < minTop) S.py = minTop;               // не выше верхнего края экрана
      if (k >= 1) land(t);
    }
    function testHop(t, peak) {   // прыжок НА МЕСТЕ (кнопка теста в настройках): дуга без смены опоры и без реплики
      S.jumping = true; S.climbing = false; jumpT = t; jumpDest = S.standLedge;
      jumpFromX = S.px; jumpFromY = S.py; jumpToX = S.px; jumpToY = S.py; jumpPeak = peak || 95; jumpDrop = false;
      env.onJumpStart();
    }

    function jumpUp(t) {   // ручная кнопка «Прыжок»: запрыгнуть на ближайшую достижимую полку СТРОГО ВЫШЕ опоры; некуда -> false (вызывающий сделает подпрыг на месте)
      if (!S.standLedge) return false;
      scan();                                          // свежий снимок: кнопку жмут и при выключенном roam, когда тика-скана нет
      const p = env.params();
      const cx = S.px + p.W / 2;
      const cand = Yasia.physics.climbCandidates(ledges, S.standLedge, cx, {
        W: p.W, dx: p.dx, up: p.up, minY: p.H * Math.max(1, p.scaleK), lastLeftEl: null,   // анти-пинг-понг не мешает ручному прыжку
      }).filter((c) => c.L.y < S.standLedge.y - 4);    // только полки выше текущей
      if (!cand.length) {                                // обычным прыжком не достать -> пробуем НАСКОКОМ до полки выше
        const pc = pounceCandidates(cx, p);
        if (!pc.length) return false;
        let bp = pc[0]; for (const c of pc) if (c.w > bp.w) bp = c;
        startJump(bp.L, bp.tgtX, t, { pounce: true });
        return true;
      }
      let best = cand[0]; for (const c of cand) if (c.w > best.w) best = c;   // самая «удобная» (ближе по горизонтали)
      startJump(best.L, best.tgtX, t);
      return true;
    }

    function tryClimb(t) {   // СВОБОДНЫЙ ПЛАТФОРМЕР: живо перескакивает с блока на блок в любую сторону
      const p = env.params();
      const cx = S.px + p.W / 2;
      S.climbing = false;
      const cand = Yasia.physics.climbCandidates(ledges, S.standLedge, cx, {
        W: p.W, dx: p.dx, up: p.up,
        minY: p.H * Math.max(1, p.scaleK),            // полки выше — за верхом экрана, игнор
        lastLeftEl: S.lastLeftEl,                     // анти-пинг-понг
      });
      if (cand.length && Math.random() < 0.78) {      // чаще прыгает по блокам, иногда просто гуляет по текущему
        let sum = 0; for (const c of cand) sum += c.w;
        let r = Math.random() * sum, chosen = cand[cand.length - 1];
        for (const c of cand) { r -= c.w; if (r <= 0) { chosen = c; break; } }
        S.lastLeftEl = S.standLedge.el || null;       // запоминаем покинутый блок
        startJump(chosen.L, chosen.tgtX, t);
        return;
      }
      if (!cand.length && S.standLedge) {             // обычным прыжком некуда -> иногда достаёт высокую полку НАСКОКОМ (если не достаёт допрыгнуть)
        const pc = pounceCandidates(cx, p);
        if (pc.length && Math.random() < 0.55) {
          let bp = pc[0]; for (const c of pc) if (c.w > bp.w) bp = c;
          S.lastLeftEl = S.standLedge.el || null;
          startJump(bp.L, bp.tgtX, t, { pounce: true });
          return;
        }
      }
      // не прыгает в этот раз -> гуляет по текущему блоку (цель может быть чуть за краем -> шагнёт и упадёт)
      const m = 45;
      S.walkTargetX = S.standLedge.x1 - m + Math.random() * (S.standLedge.x2 - S.standLedge.x1 + 2 * m);
      if (Math.random() < 0.12) env.sayTop();
    }

    function fallStep(t, dt) {   // свободное падение/полёт: инерция броска по X + гравитация, ловим полку под ногами
      const p = env.params();
      S.falling = true;
      const f = Math.min(dt / 16, 3);
      if (Math.abs(S.vx) > 0.05) {                    // ИНЕРЦИЯ броска: летит вбок, тормозит воздухом
        S.px += S.vx * f;
        S.vx *= Math.pow(0.90, f);                    // трение
        if (Math.abs(S.vx) > 1) S.face = S.vx < 0 ? -1 : 1;
        if (S.px <= 0) { S.px = 0; S.vx = -S.vx * 0.35; }                                   // мягкий отскок от краёв
        else if (S.px >= window.innerWidth - p.W) { S.px = window.innerWidth - p.W; S.vx = -S.vx * 0.35; }
        if (Math.abs(S.vx) < 0.3) S.vx = 0;
      }
      S.vy = Math.min(S.vy + p.gravity * f, 26);
      const prevFoot = S.py + p.H;
      S.py += S.vy * f;
      const foot = S.py + p.H, cx = S.px + p.W / 2;
      let landed = null;
      for (const L of ledges) {
        if (cx < L.x1 || cx > L.x2) continue;
        if (L.y >= prevFoot - 1 && L.y <= foot + 1) { if (!landed || L.y < landed.y) landed = L; }
      }
      if (landed) { S.falling = false; S.thrown = false; S.vx = 0; S.standLedge = landed; S.py = landed.y - p.H; S.vy = 0; S.walkTargetX = S.px; S.nextJumpDecide = t + 1200; }
      // если в колонке ничего нет — продолжает лететь до пола, потом сама запрыгнет наверх
    }

    return {
      scan, reacquireFloor, startJump, updateJump, testHop, jumpUp, tryClimb, fallStep,
      ledges: () => ledges,                                              // текущий снимок полок (для маршрутов к видео/игре в pet.js)
      jumpPhase: (t) => clamp((t - jumpT) / env.params().jumpMs, 0, 1),  // фаза дуги [0..1] — привязка кадра анимации
      isDrop: () => jumpDrop,                                            // спуск-дроп (кадры fall вместо jump)
      isPounce: () => jumpPounce,                                        // наскок-прыжок (кадры pounce вместо jump)
    };
  }

  Yasia.platformer = { createEngine };
})();
