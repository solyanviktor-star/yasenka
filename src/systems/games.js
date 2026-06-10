// Система «Мини-игры» (v0.7) — фан + XP. Логика игр живёт ЗДЕСЬ, отдельно от монолита pet.js.
// С питомцем общается ТОЛЬКО через ctx.pet (безопасный API: позиция/курсор/XP/настроение/эмоции/ходьба)
// и шину Yasia.events ('game:start' {id} / 'game:stop' / 'game:tick' {t,dt} / 'game:petclick').
// Игра «забирает» питомца (pet.claim) -> главный цикл pet.js ведёт его наземно к pet.walkTo() и шлёт 'game:tick',
// где игра двигает свои сущности, ставит цель и считает столкновения. Падение тут не роняет питомца — гасится флаг games.
(() => {
  'use strict';
  const Yasia = (window.Yasia = window.Yasia || {});
  if (!Yasia.systems) return;

  Yasia.systems.register({
    name: 'games',
    init(ctx) {
      const pet = ctx && ctx.pet;
      const events = (ctx && ctx.events) || Yasia.events;
      if (!pet || !pet.root || !events) return {};   // старый pet.js без API -> система no-op (не падаем, чтобы не гасить флаг зря)
      const root = pet.root;
      const tr = (ctx && ctx.tr) || (() => ({}));
      const pick = (a) => a[Math.floor(Math.random() * a.length)];
      const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
      const resUrl = (p) => { try { return chrome.runtime.getURL(p); } catch (_) { return ''; } };

      // реплики игр — двуязычные (язык берём из общего tr().lang, как у окна Яси)
      const G = {
        ru: { catch: ['Поймала! 😺', 'Ха, попалась~', 'Ещё! ещё!', 'Мяу-победа! 🏆'], miss: ['Эй, куда?! 😼', 'Так быстро?!', 'Ну поймаю же!', 'Хитрюга 😾'], eat: 'Ам! 😋', win: 'Победа! 🏆', bite: 'Ай! 🧟', peek: 'Ку-ку! 😸' },
        en: { catch: ['Caught you! 😺', 'Ha, gotcha~', 'More! more!', 'Mew-victory! 🏆'], miss: ['Hey, where to?! 😼', 'So fast?!', 'I will catch you!', 'Sneaky one 😾'], eat: 'Nom! 😋', win: 'Victory! 🏆', bite: 'Ouch! 🧟', peek: 'Peekaboo! 😸' },
      };
      const gt = () => G[(tr() && tr().lang) || 'ru'] || G.ru;

      // ---------- мелкие хелперы DOM (всё в слой питомца, координаты = вьюпорт) ----------
      function mk(cls) { const d = document.createElement('div'); d.className = cls; root.appendChild(d); return d; }
      function exitButton(onExit) {
        const b = mk('twtr-game-exit'); b.textContent = tr().gExit || '✖';
        b.addEventListener('click', (e) => { e.stopPropagation(); onExit(); });
        return b;
      }
      function toast(text) {
        const el = mk('twtr-game-toast'); el.textContent = text || '';
        setTimeout(() => { el.classList.add('fade'); }, 2400);
        setTimeout(() => { try { el.remove(); } catch (_) {} }, 3000);
        return el;
      }

      // ---------- хост: одна активная игра ----------
      let current = null;   // { id, end() }
      function start(id) {
        if (current && current.id === id) return;        // уже идёт эта игра
        stop();
        const def = GAMES[id]; if (!def) return;
        if (!pet.claim(id)) { toast(tr().gBusy || ''); return; }   // занята (скачивание видео) -> не стартуем
        try { current = Object.assign({ id }, def() || {}); }
        catch (_) { current = null; pet.release(); }
      }
      function stop() {
        if (!current) return;
        const c = current; current = null;
        try { c.end && c.end(); } catch (_) {}
        pet.release();
      }

      // ====== Игра 1: Догонялки с курсором ======
      function gameChase() {
        let lastCx = pet.cursor().x, lastCy = pet.cursor().y, coolUntil = 0, missUntil = 0;
        const CATCH_R = 46;
        const offTick = events.on('game:tick', (d) => {
          const c = pet.cursor(), p = pet.pos();
          pet.climbTo(c.x, c.y);                                      // бежит за курсором и ЗАПРЫГИВАЕТ по полкам, если курсор высоко
          const spd = dist(c.x, c.y, lastCx, lastCy); lastCx = c.x; lastCy = c.y;
          const dd = dist(c.x, c.y, p.cx, p.cy);
          if (dd < CATCH_R && d.t > coolUntil) {                      // поймала
            coolUntil = d.t + 1400;
            pet.emote('happy', 1100); pet.particles('#ffd34d', 9);
            pet.addXp(5); pet.addMood(3); pet.say(pick(gt().catch), 1300);
          } else if (spd > 42 && dd > 130 && d.t > missUntil) {       // удрал слишком быстро -> удивляется/злится
            missUntil = d.t + 2800;
            pet.emote(Math.random() < 0.5 ? 'dizzy' : 'angry', 1100); pet.say(pick(gt().miss), 1300);
          }
        });
        const xb = exitButton(stop);
        toast(tr().gChaseHint || '');
        return { end() { offTick(); try { xb.remove(); } catch (_) {} } };
      }

      // ====== Игра 2: Ловля еды ======
      function gameFood() {
        const meats = [];   // { dom, x(left), y(top), vy, landed, floorY }
        const MEAT = 36;
        function spawnMeat(cx) {
          const m = document.createElement('img');
          const src = resUrl('src/items/meat.png'); if (src) m.src = src;
          m.className = 'twtr-game-meat';
          const x = Math.max(6, Math.min(cx - MEAT / 2, pet.vw() - MEAT - 6));
          m.style.left = x + 'px'; m.style.top = '-44px';
          root.appendChild(m);
          meats.push({ dom: m, x, y: -44, vy: 0, landed: false, floorY: pet.vh() - 30 - MEAT });
        }
        const onClick = (e) => {
          if (e.target && e.target.closest && e.target.closest('.twtr-game-exit, #twtr-pet')) return;   // кнопка выхода / сам питомец — не еда
          spawnMeat(e.clientX);
          e.preventDefault(); e.stopPropagation();
        };
        document.addEventListener('click', onClick, true);
        const offTick = events.on('game:tick', () => {
          for (const it of meats) {                                  // падение мяса на пол
            if (it.landed) continue;
            it.vy = Math.min(it.vy + 1.2, 22); it.y = Math.min(it.y + it.vy, it.floorY);
            if (it.y >= it.floorY) it.landed = true;
            it.dom.style.top = it.y + 'px';
          }
          if (!meats.length) { pet.stop(); return; }
          const p = pet.pos();
          let best = null, bd = 1e9;                                 // бежит к ближайшему мясу
          for (const it of meats) { const dd = Math.abs((it.x + MEAT / 2) - p.cx); if (dd < bd) { bd = dd; best = it; } }
          if (best) pet.walkTo(best.x + MEAT / 2 - p.w / 2, true);
          for (let i = meats.length - 1; i >= 0; i--) {              // съедение при касании
            const it = meats[i];
            if (Math.abs((it.x + MEAT / 2) - p.cx) < 30 && Math.abs((it.y + MEAT / 2) - (p.y + p.h)) < 64) {
              try { it.dom.remove(); } catch (_) {}
              meats.splice(i, 1);
              pet.emote('happy', 900); pet.particles('#ff9a52', 7);
              pet.addHunger(-12); pet.addXp(4); pet.say(gt().eat, 1000);
            }
          }
        });
        const xb = exitButton(stop);
        toast(tr().gFoodHint || '');
        return {
          end() {
            offTick();
            document.removeEventListener('click', onClick, true);
            for (const it of meats) { try { it.dom.remove(); } catch (_) {} }
            try { xb.remove(); } catch (_) {}
          },
        };
      }

      // ====== Игра 3: Зомби-лучник ======
      // Зомби лезут с краёв к Ясе; она БЕГАЕТ к ближайшему и ЗАПРЫГИВАЕТ на него (стомп, +XP), либо клик по зомби -> стрела (+XP);
      // дошёл до Яси по земле -> укус (-настроение); каждые 6 убитых -> «победа» (+настроение). Лук/спрайты — пока эмодзи (заменим Nano Banana).
      function gameZombie() {
        pet.ground(true);
        const Z = 30;
        const zombies = [];   // { dom, x(left), y(top), alive }
        const arrows = [];    // { dom, x, y, z }
        let kills = 0, spawnAt = 0, hopUntil = 0, wasAir = false;
        function zFloor() { return pet.vh() - 8 - Z; }   // низ зомби ~ на полу (как ноги Яси)
        function spawnZombie() {
          const fromLeft = Math.random() < 0.5;
          const d = document.createElement('div'); d.className = 'twtr-game-zombie'; d.textContent = '🧟';
          const x = fromLeft ? -Z : pet.vw() + 2;
          const z = { dom: d, x, y: zFloor(), alive: true };
          d.style.left = x + 'px'; d.style.top = z.y + 'px';
          d.addEventListener('click', (e) => { e.stopPropagation(); fire(z); });
          root.appendChild(d); zombies.push(z);
        }
        function fire(z) {
          if (!z.alive) return;
          const p = pet.pos(); pet.face(z.x < p.cx ? -1 : 1); pet.emote('happy', 450);
          const a = document.createElement('div'); a.className = 'twtr-game-arrow'; a.textContent = '➤';
          a.style.left = p.cx + 'px'; a.style.top = (p.y + 12) + 'px';
          root.appendChild(a); arrows.push({ dom: a, x: p.cx, y: p.y + 12, z });
        }
        const offTick = events.on('game:tick', (d) => {
          if (d.t > spawnAt) { spawnAt = d.t + 1500 + Math.random() * 1400; if (zombies.filter((z) => z.alive).length < 8) spawnZombie(); }
          const p = pet.pos();
          let near = null, nd = 1e9;                               // ближайший зомби
          for (const z of zombies) { if (!z.alive) continue; const dd = Math.abs((z.x + Z / 2) - p.cx); if (dd < nd) { nd = dd; near = z; } }
          if (near) {
            pet.walkTo(near.x + Z / 2 - p.w / 2, true);            // бежит к ближайшему зомби
            if (nd < 85 && !pet.airborne() && d.t > hopUntil) { hopUntil = d.t + 650; pet.hop(near.x + Z / 2); }   // близко -> ПРЫЖОК, чтобы топнуть
          } else { pet.stop(); }
          const air = pet.airborne(), justLanded = wasAir && !air; wasAir = air;
          for (const z of zombies) {                               // зомби идут к Ясе + стомп в прыжке/на приземлении
            if (!z.alive) continue;
            z.x += ((p.cx - (z.x + Z / 2)) > 0 ? 1 : -1) * 0.7; z.dom.style.left = z.x + 'px';
            const dx = Math.abs((z.x + Z / 2) - p.cx);
            if ((air || justLanded) && dx < 30 && Math.abs((z.y + Z / 2) - (p.y + p.h)) < 46) {   // топнула сверху -> убит
              z.alive = false; try { z.dom.remove(); } catch (_) {} pet.particles('#7bd16a', 8); pet.addXp(6); kills++;
              if (kills % 6 === 0) { pet.addMood(8); pet.happy(900); pet.say(gt().win, 1300); }
            } else if (!air && !justLanded && dx < 26) {           // дошёл по земле -> укус
              z.alive = false; try { z.dom.remove(); } catch (_) {} pet.emote('angry', 700); pet.addMood(-3); pet.say(gt().bite, 800);
            }
          }
          for (let i = arrows.length - 1; i >= 0; i--) {           // стрелы летят к цели
            const ar = arrows[i], z = ar.z;
            if (!z.alive) { try { ar.dom.remove(); } catch (_) {} arrows.splice(i, 1); continue; }
            const tx = z.x + Z / 2, ty = z.y + Z / 2;
            ar.x += (tx - ar.x) * 0.35; ar.y += (ty - ar.y) * 0.35;
            ar.dom.style.left = ar.x + 'px'; ar.dom.style.top = ar.y + 'px';
            ar.dom.style.transform = 'translate(-50%,-50%) rotate(' + Math.atan2(ty - ar.y, tx - ar.x) + 'rad)';
            if (Math.hypot(tx - ar.x, ty - ar.y) < 15) {           // попал
              z.alive = false; try { z.dom.remove(); } catch (_) {} try { ar.dom.remove(); } catch (_) {} arrows.splice(i, 1);
              pet.particles('#7bd16a', 8); pet.addXp(6); kills++;
              if (kills % 6 === 0) { pet.addMood(8); pet.happy(900); pet.say(gt().win, 1300); }
            }
          }
          bow.style.left = (p.cx - 9) + 'px'; bow.style.top = (p.y + 4) + 'px';   // лук держится у Яси
          for (let i = zombies.length - 1; i >= 0; i--) if (!zombies[i].alive) zombies.splice(i, 1);   // не копим мёртвых (долгая сессия)
        });
        const bow = mk('twtr-game-bow'); bow.textContent = '🏹';
        const xb = exitButton(stop);
        toast(tr().gZombieHint || '');
        return { end() { offTick(); for (const z of zombies) { try { z.dom.remove(); } catch (_) {} } for (const a of arrows) { try { a.dom.remove(); } catch (_) {} } try { bow.remove(); } catch (_) {} try { xb.remove(); } catch (_) {} } };
      }

      // ====== Игра 4: Прятки ======
      // Яся прячется за элементом страницы (торчат ушки), клик по ушкам -> выпрыгивает (+XP), через паузу прячется снова.
      function gameHide() {
        pet.ground(false);                                       // позицию ведём вручную (не на полу)
        let nub = null, spot = null, hidden = false, rehideAt = 0;
        function pickSpot() {
          const els = [...document.querySelectorAll('article,[data-testid="tweet"],img,h1,h2,h3,p,li,button')]
            .filter((el) => { if (root.contains(el)) return false; const r = el.getBoundingClientRect(); return r.width > 80 && r.height > 36 && r.top > 70 && r.bottom < pet.vh() - 20 && r.left > 24 && r.right < pet.vw() - 24; });
          if (els.length) { const el = els[Math.floor(Math.random() * els.length)]; const r = el.getBoundingClientRect(); return { el, x: r.left + r.width / 2, y: r.top }; }
          return { el: null, x: 90 + Math.random() * (pet.vw() - 180), y: pet.vh() * 0.5 };   // фолбэк
        }
        function placeAt() {
          pet.place(spot.x - 23, spot.y - 8);                    // тело чуть ниже верхнего края элемента -> «из-за него»
          if (nub) { nub.style.left = (spot.x - 14) + 'px'; nub.style.top = (spot.y - 24) + 'px'; }
        }
        function hide() {
          spot = pickSpot(); hidden = true; rehideAt = 0;
          if (!nub) { nub = mk('twtr-game-nub'); nub.textContent = '🐱'; nub.addEventListener('click', (e) => { e.stopPropagation(); pop(); }); }
          nub.style.display = 'block';
          pet.appear(false); placeAt();
        }
        function pop() {
          if (!hidden) return; hidden = false;
          if (nub) nub.style.display = 'none';
          pet.appear(true); pet.place(spot.x - 23, spot.y - 32); pet.happy(900); pet.emote('happy', 900); pet.particles('#ffd34d', 8);
          pet.addXp(5); pet.addMood(3); pet.say(gt().peek, 1100);
        }
        const offTick = events.on('game:tick', (d) => {
          if (hidden && spot && spot.el) {                        // следуем за элементом при скролле
            if (!spot.el.isConnected) { hide(); return; }         // лента X виртуализировала узел (detached -> rect=0) -> прячемся в новом месте, а не в углу (0,0)
            const r = spot.el.getBoundingClientRect();
            if (r.width < 1 || r.bottom < 70 || r.top > pet.vh() - 20) { hide(); return; }   // уехал за пределы экрана -> новое место
            spot.x = r.left + r.width / 2; spot.y = r.top; placeAt();
          }
          if (!hidden) { if (!rehideAt) rehideAt = d.t + 1500; else if (d.t > rehideAt) hide(); }   // после выпрыгивания через 1.5с прячется снова
        });
        const offPet = events.on('game:petclick', () => pop());  // кликнул по самой Ясе (мимо ушек) -> тоже выпрыгивает
        hide();
        const xb = exitButton(stop);
        toast(tr().gHideHint || '');
        return { end() { offTick(); offPet(); pet.appear(true); if (nub) { try { nub.remove(); } catch (_) {} } try { xb.remove(); } catch (_) {} } };
      }

      const GAMES = { chase: gameChase, food: gameFood, zombie: gameZombie, hide: gameHide };

      const offStart = events.on('game:start', (p) => start(p && p.id));
      const offStop = events.on('game:stop', () => stop());
      const onKey = (e) => { if (e.key === 'Escape' && current) { e.preventDefault(); e.stopPropagation(); stop(); } };   // Esc -> выйти из игры
      document.addEventListener('keydown', onKey, true);

      return { destroy() { offStart(); offStop(); document.removeEventListener('keydown', onKey, true); stop(); } };
    },
    destroy(inst) { if (inst && inst.destroy) inst.destroy(); },
  });
})();
