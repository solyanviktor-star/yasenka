// Система «Мини-игры» (v0.7 -> v1.1 «сессии») — фан + XP. Логика игр живёт ЗДЕСЬ, отдельно от монолита pet.js.
// С питомцем общается ТОЛЬКО через ctx.pet (безопасный API: позиция/курсор/XP/настроение/эмоции/ходьба)
// и шину Yasia.events ('game:start' {id} / 'game:stop' / 'game:tick' {t,dt} / 'game:petclick').
// Игра «забирает» питомца (pet.claim) -> главный цикл pet.js ведёт его наземно к pet.walkTo() и шлёт 'game:tick',
// где игра двигает свои сущности, ставит цель и считает столкновения. Падение тут не роняет питомца — гасится флаг games.
//
// v1.1: каждая игра — ЗАКОНЧЕННЫЙ раунд (таймер/лимит бросков/жизни/находки) с HUD-счётчиком, итоговым тостом,
// рекордами (chrome.storage.local: yasiaGameBest) и наградой XP в КОНЦЕ (5-15 за сессию, не спамим каждую поимку).
(() => {
  'use strict';

  // ---------- чистая математика раундов (без DOM) -> тестируется в node (tests/games.test.js) ----------
  const clampN = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const pure = {
    // XP за сессию пропорционально счёту: 0 -> утешительные 2, иначе 5..15 (чтобы даже слабый раунд радовал)
    sessionXp: (score, per) => (score <= 0 ? 2 : clampN(Math.round(score * per), 5, 15)),
    // зомби: победа = 12..15 (меньше укусов -> больше), поражение = по числу стомпов (3..15, 0 -> 2)
    zombieXp: (stomps, bites, win) => (win ? clampN(12 + (3 - bites), 5, 15) : (stomps <= 0 ? 2 : clampN(Math.round(stomps * 1.5), 3, 15))),
    // прятки: быстрее нашёл 5 раз -> больше XP (15 при ~15с, 5 при 65с+)
    hideXp: (sec) => clampN(Math.round(18 - sec / 5), 5, 15),
    // рекорд: обычно «больше = лучше», у пряток lowerBetter (меньшее время); нулевой счёт рекордом не считаем
    isNewBest: (prev, score, lowerBetter) => (lowerBetter ? score > 0 && (prev == null || score < prev) : score > (prev || 0)),
    hearts: (n, max) => '❤️'.repeat(clampN(n, 0, max)) + '🖤'.repeat(clampN(max - n, 0, max)),
    fmtSec: (ms) => (Math.max(0, ms) / 1000).toFixed(1),
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = pure;   // node (юнит-тесты)
  if (typeof window === 'undefined') return;                                    // дальше — только браузер

  const Yasia = (window.Yasia = window.Yasia || {});
  if (!Yasia.systems) return;

  Yasia.systems.register({
    name: 'games',
    init(ctx) {
      const pet = ctx && ctx.pet;
      const events = (ctx && ctx.events) || Yasia.events;
      if (!pet || !pet.root || !events) return {};   // старый pet.js без API -> система no-op (не падаем, чтобы не гасить флаг зря)
      const root = pet.root;
      const storage = (ctx && ctx.storage) || Yasia.storage || null;
      const tr = (ctx && ctx.tr) || (() => ({}));
      const pick = (a) => a[Math.floor(Math.random() * a.length)];
      const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
      const resUrl = (p) => { try { return chrome.runtime.getURL(p); } catch (_) { return ''; } };

      // реплики игр — двуязычные (язык берём из общего tr().lang, как у окна Яси)
      const G = {
        ru: {
          catch: ['Поймала! 😺', 'Ха, попалась~', 'Ещё! ещё!', 'Мяу-победа! 🏆'], miss: ['Эй, куда?! 😼', 'Так быстро?!', 'Ну поймаю же!', 'Хитрюга 😾'],
          eat: 'Ам! 😋', win: 'Победа! 🏆', bite: 'Ай! 🧟', peek: 'Ку-ку! 😸',
          sec: 'с', best: '🏆 Новый рекорд!',
          chaseEnd: (n, xp) => 'Поймано: ' + n + ' — +' + xp + ' XP',
          foodEnd: (n, of, xp) => 'Съедено: ' + n + ' из ' + of + ' — +' + xp + ' XP',
          zombieWin: (xp) => 'Победа! 5 стомпов — +' + xp + ' XP',
          zombieLose: (n, xp) => 'Покусали… стомпов: ' + n + ' — +' + xp + ' XP',
          hideEnd: (s, xp) => 'Найдена 5 раз за ' + s + ' с — +' + xp + ' XP',
        },
        en: {
          catch: ['Caught you! 😺', 'Ha, gotcha~', 'More! more!', 'Mew-victory! 🏆'], miss: ['Hey, where to?! 😼', 'So fast?!', 'I will catch you!', 'Sneaky one 😾'],
          eat: 'Nom! 😋', win: 'Victory! 🏆', bite: 'Ouch! 🧟', peek: 'Peekaboo! 😸',
          sec: 's', best: '🏆 New record!',
          chaseEnd: (n, xp) => 'Caught: ' + n + ' — +' + xp + ' XP',
          foodEnd: (n, of, xp) => 'Ate ' + n + ' of ' + of + ' — +' + xp + ' XP',
          zombieWin: (xp) => 'Victory! 5 stomps — +' + xp + ' XP',
          zombieLose: (n, xp) => 'Bitten… stomps: ' + n + ' — +' + xp + ' XP',
          hideEnd: (s, xp) => 'Found 5 times in ' + s + ' s — +' + xp + ' XP',
        },
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
      // HUD-бейдж (счёт раунда в углу): стили инжектим сами — pet.css правит другой разработчик, наша зона только JS
      function injectHudCss() {
        if (document.getElementById('twtr-game-hud-style')) return;
        const s = document.createElement('style'); s.id = 'twtr-game-hud-style';
        s.textContent = '.twtr-game-hud{position:absolute;top:12px;right:14px;background:rgba(20,20,24,.86);color:#fff;font:800 13px/1.2 system-ui,-apple-system,sans-serif;padding:9px 13px;border-radius:16px;pointer-events:none;white-space:nowrap;box-shadow:0 4px 14px rgba(0,0,0,.35)}';
        (document.head || document.documentElement).appendChild(s);
      }
      function hudMake() {
        injectHudCss();
        const el = mk('twtr-game-hud');
        return { set(t) { el.textContent = t; }, remove() { try { el.remove(); } catch (_) {} } };
      }
      // единый финал раунда: эмоция + награда + итоговый тост + рекорд + отложенный выход (чтобы финал был виден,
      // а stop() не рвал слушатели прямо из emit'а game:tick). Таймеры кладём в timers игры — Escape их погасит.
      function finishRound(o) {   // { id, score, xp, mood, text, emo, lowerBetter, timers }
        const lose = o.emo === 'sad' || o.emo === 'dizzy';
        pet.emote(o.emo || 'levelup', 1600);
        pet.particles(lose ? '#9aa0a6' : '#ffd34d', 10);
        if (o.xp) pet.addXp(o.xp);
        if (o.mood) pet.addMood(o.mood);
        toast(o.text);
        if (storage) storage.localGet({ yasiaGameBest: {} }, (r) => {   // рекорды переживают перезапуск браузера
          const best = (r && r.yasiaGameBest) || {};
          if (pure.isNewBest(best[o.id], o.score, o.lowerBetter)) {
            best[o.id] = o.score; storage.localSet({ yasiaGameBest: best });
            o.timers.push(setTimeout(() => { toast(gt().best).style.top = '96px'; }, 1100));   // ниже итога, чтобы тосты не легли друг на друга
          }
        });
        o.timers.push(setTimeout(stop, 1700));
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
      // Раунд 45с: лови курсор, счёт на HUD; в конце — итог «Поймано N — +XP» и выход.
      function gameChase() {
        const ROUND = 45000, CATCH_R = 46;
        let lastCx = pet.cursor().x, lastCy = pet.cursor().y, coolUntil = 0, missUntil = 0;
        let t0 = 0, score = 0, over = false;
        const timers = [], hud = hudMake();
        const offTick = events.on('game:tick', (d) => {
          if (over) return;
          if (!t0) t0 = d.t;                                          // отсчёт с первого тика (клэйм мог задержаться)
          const left = ROUND - (d.t - t0);
          hud.set('🐾 ' + score + ' · ' + Math.ceil(Math.max(0, left) / 1000) + gt().sec);
          if (left <= 0) {
            over = true;
            const xp = pure.sessionXp(score, 1.2);
            finishRound({ id: 'chase', score, xp, mood: score > 0 ? 4 : 1, emo: score > 0 ? 'levelup' : 'sad', text: gt().chaseEnd(score, xp), timers });
            return;
          }
          const c = pet.cursor(), p = pet.pos();
          pet.climbTo(c.x, c.y);                                      // бежит за курсором и ЗАПРЫГИВАЕТ по полкам, если курсор высоко
          const spd = dist(c.x, c.y, lastCx, lastCy); lastCx = c.x; lastCy = c.y;
          const dd = dist(c.x, c.y, p.cx, p.cy);
          if (dd < CATCH_R && d.t > coolUntil) {                      // поймала (XP не сыплем — награда в конце раунда)
            coolUntil = d.t + 1400; score++;
            pet.emote('pounce', 1100); pet.particles('#ffd34d', 9); pet.say(pick(gt().catch), 1300);
          } else if (spd > 42 && dd > 130 && d.t > missUntil) {       // удрал слишком быстро -> удивляется/злится
            missUntil = d.t + 2800;
            pet.emote(Math.random() < 0.5 ? 'dizzy' : 'angry', 1100); pet.say(pick(gt().miss), 1300);
          }
        });
        const xb = exitButton(stop);
        toast(tr().gChaseHint || '');
        return { end() { offTick(); hud.remove(); try { xb.remove(); } catch (_) {} timers.forEach(clearTimeout); } };
      }

      // ====== Игра 2: Ловля еды ======
      // Раунд = 10 бросков (кликов игрока); Яся доедает всё брошенное, потом итог. 20с без бросков -> мягкий финал.
      function gameFood() {
        const MEAT = 36, THROWS = 10, IDLE_MS = 20000;
        const meats = [];   // { dom, x(left), y(top), vy, landed }
        const timers = [], hud = hudMake();
        let thrown = 0, eaten = 0, lastThrow = Date.now(), over = false;
        function spawnMeat(cx) {
          const m = document.createElement('img');
          const src = resUrl('src/items/meat.png'); if (src) m.src = src;
          m.className = 'twtr-game-meat';
          const x = Math.max(6, Math.min(cx - MEAT / 2, pet.vw() - MEAT - 6));
          m.style.left = x + 'px'; m.style.top = '-44px';
          root.appendChild(m);
          meats.push({ dom: m, x, y: -44, vy: 0, landed: false });
        }
        const onClick = (e) => {
          if (e.target && e.target.closest && e.target.closest('.twtr-game-exit, #twtr-pet')) return;   // кнопка выхода / сам питомец — не еда
          if (!over && thrown < THROWS) { thrown++; lastThrow = Date.now(); spawnMeat(e.clientX); }     // клики глотаем всегда (не лайкать ленту случайно), но лимит бросков держим
          e.preventDefault(); e.stopPropagation();
        };
        document.addEventListener('click', onClick, true);
        const offTick = events.on('game:tick', () => {
          if (over) return;
          hud.set('🍖 ' + eaten + ' · 🎯 ' + thrown + '/' + THROWS);
          const floorY = pet.vh() - 30 - MEAT;                       // пол считаем каждый тик -> resize не оставляет мясо висеть в воздухе
          for (const it of meats) {
            it.x = Math.max(6, Math.min(it.x, pet.vw() - MEAT - 6)); it.dom.style.left = it.x + 'px';
            if (it.landed) { if (it.y !== floorY) { it.y = floorY; it.dom.style.top = it.y + 'px'; } continue; }
            it.vy = Math.min(it.vy + 1.2, 22); it.y = Math.min(it.y + it.vy, floorY);
            if (it.y >= floorY) it.landed = true;
            it.dom.style.top = it.y + 'px';
          }
          if (!meats.length) {                                       // всё съедено/пока пусто: конец раунда или ждём броска
            pet.stop();
            if (thrown >= THROWS || Date.now() - lastThrow > IDLE_MS) {
              over = true;
              const xp = pure.sessionXp(eaten, 1.3);
              finishRound({ id: 'food', score: eaten, xp, mood: eaten > 0 ? 4 : 1, emo: eaten >= THROWS ? 'levelup' : (eaten > 0 ? 'happy' : 'sad'), text: gt().foodEnd(eaten, THROWS, xp), timers });
            }
            return;
          }
          const p = pet.pos();
          let best = null, bd = 1e9;                                 // бежит к ближайшему мясу
          for (const it of meats) { const dd = Math.abs((it.x + MEAT / 2) - p.cx); if (dd < bd) { bd = dd; best = it; } }
          if (best) pet.walkTo(best.x + MEAT / 2 - p.w / 2, true);
          for (let i = meats.length - 1; i >= 0; i--) {              // съедение при касании (XP — в конце, голод утоляем сразу: это суть кормёжки)
            const it = meats[i];
            if (Math.abs((it.x + MEAT / 2) - p.cx) < 30 && Math.abs((it.y + MEAT / 2) - (p.y + p.h)) < 64) {
              try { it.dom.remove(); } catch (_) {}
              meats.splice(i, 1); eaten++;
              pet.emote('pounce', 900); pet.particles('#ff9a52', 7);
              pet.addHunger(-12); pet.say(gt().eat, 1000);
            }
          }
        });
        const xb = exitButton(stop);
        toast(tr().gFoodHint || '');
        return {
          end() {
            offTick(); hud.remove();
            document.removeEventListener('click', onClick, true);
            for (const it of meats) { try { it.dom.remove(); } catch (_) {} }
            try { xb.remove(); } catch (_) {}
            timers.forEach(clearTimeout);
          },
        };
      }

      // ====== Игра 3: Зомби-лучник ======
      // Зомби лезут с краёв к Ясе; она БЕГАЕТ к ближайшему и ЗАПРЫГИВАЕТ на него (стомп), либо клик по зомби -> стрела
      // (стрела спасает от укуса, но в счёт победы идут только стомпы). Победа = 5 стомпов, поражение = 3 укуса; HUD: прогресс + ❤️.
      function gameZombie() {
        pet.ground(true);
        const Z = 30, WIN_STOMPS = 5, MAX_BITES = 3;
        const zombies = [];   // { dom, x(left), y(top), alive }
        const arrows = [];    // { dom, x, y, z }
        const timers = [], hud = hudMake();
        let stomps = 0, bites = 0, spawnAt = 0, hopUntil = 0, wasAir = false, over = false;
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
          if (!z.alive || over) return;
          const p = pet.pos(); pet.face(z.x < p.cx ? -1 : 1); pet.emote('happy', 450);
          const a = document.createElement('div'); a.className = 'twtr-game-arrow'; a.textContent = '➤';
          a.style.left = p.cx + 'px'; a.style.top = (p.y + 12) + 'px';
          root.appendChild(a); arrows.push({ dom: a, x: p.cx, y: p.y + 12, z });
        }
        function finish(win) {
          over = true;
          const xp = pure.zombieXp(stomps, bites, win);
          finishRound(win
            ? { id: 'zombie', score: stomps, xp, mood: 6, emo: 'levelup', text: gt().zombieWin(xp), timers }
            : { id: 'zombie', score: stomps, xp, mood: -2, emo: 'dizzy', text: gt().zombieLose(stomps, xp), timers });
        }
        const offTick = events.on('game:tick', (d) => {
          if (over) return;                                          // финал: сущности замирают до отложенного stop()
          hud.set('👟 ' + stomps + '/' + WIN_STOMPS + ' · ' + pure.hearts(MAX_BITES - bites, MAX_BITES));
          if (d.t > spawnAt) { spawnAt = d.t + 1500 + Math.random() * 1400; if (zombies.filter((z) => z.alive).length < 8) spawnZombie(); }
          const p = pet.pos(), fy = zFloor();
          let near = null, nd = 1e9;                                 // ближайший зомби
          for (const z of zombies) { if (!z.alive) continue; const dd = Math.abs((z.x + Z / 2) - p.cx); if (dd < nd) { nd = dd; near = z; } }
          if (near) {
            pet.walkTo(near.x + Z / 2 - p.w / 2, true);              // бежит к ближайшему зомби
            if (nd < 85 && !pet.airborne() && d.t > hopUntil) { hopUntil = d.t + 650; pet.hop(near.x + Z / 2); }   // близко -> ПРЫЖОК, чтобы топнуть
          } else { pet.stop(); }
          const air = pet.airborne(), justLanded = wasAir && !air; wasAir = air;
          for (const z of zombies) {                                 // зомби идут к Ясе + стомп в прыжке/на приземлении
            if (!z.alive) continue;
            z.x += ((p.cx - (z.x + Z / 2)) > 0 ? 1 : -1) * 0.7; z.dom.style.left = z.x + 'px';
            if (z.y !== fy) { z.y = fy; z.dom.style.top = fy + 'px'; }   // пол пересчитываем -> resize не подвешивает зомби
            const dx = Math.abs((z.x + Z / 2) - p.cx);
            if ((air || justLanded) && dx < 30 && Math.abs((z.y + Z / 2) - (p.y + p.h)) < 46) {   // топнула сверху -> убит
              z.alive = false; try { z.dom.remove(); } catch (_) {} pet.particles('#7bd16a', 8);
              stomps++; pet.emote('pounce', 700);
              if (stomps >= WIN_STOMPS) { pet.say(gt().win, 1300); finish(true); return; }
            } else if (!air && !justLanded && dx < 26) {             // дошёл по земле -> укус (минус ❤️)
              z.alive = false; try { z.dom.remove(); } catch (_) {} pet.emote('angry', 700); pet.say(gt().bite, 800);
              bites++;
              if (bites >= MAX_BITES) { finish(false); return; }
            }
          }
          for (let i = arrows.length - 1; i >= 0; i--) {             // стрелы летят к цели
            const ar = arrows[i], z = ar.z;
            if (!z.alive) { try { ar.dom.remove(); } catch (_) {} arrows.splice(i, 1); continue; }
            const tx = z.x + Z / 2, ty = z.y + Z / 2;
            ar.x += (tx - ar.x) * 0.35; ar.y += (ty - ar.y) * 0.35;
            ar.dom.style.left = ar.x + 'px'; ar.dom.style.top = ar.y + 'px';
            ar.dom.style.transform = 'translate(-50%,-50%) rotate(' + Math.atan2(ty - ar.y, tx - ar.x) + 'rad)';
            if (Math.hypot(tx - ar.x, ty - ar.y) < 15) {             // попал: снял угрозу (в победный счёт не идёт — победа только стомпами)
              z.alive = false; try { z.dom.remove(); } catch (_) {} try { ar.dom.remove(); } catch (_) {} arrows.splice(i, 1);
              pet.particles('#7bd16a', 8);
            }
          }
          bow.style.left = (p.cx - 9) + 'px'; bow.style.top = (p.y + 4) + 'px';   // лук держится у Яси
          for (let i = zombies.length - 1; i >= 0; i--) if (!zombies[i].alive) zombies.splice(i, 1);   // не копим мёртвых (долгая сессия)
        });
        const bow = mk('twtr-game-bow'); bow.textContent = '🏹';
        const xb = exitButton(stop);
        toast(tr().gZombieHint || '');
        return { end() { offTick(); hud.remove(); for (const z of zombies) { try { z.dom.remove(); } catch (_) {} } for (const a of arrows) { try { a.dom.remove(); } catch (_) {} } try { bow.remove(); } catch (_) {} try { xb.remove(); } catch (_) {} timers.forEach(clearTimeout); } };
      }

      // ====== Игра 4: Прятки ======
      // Раунд = 5 находок на время: Яся прячется за элементом страницы (торчат ушки), клик по ушкам -> выпрыгивает.
      // HUD: находки + секундомер; рекорд = МЕНЬШЕЕ время, XP тем больше, чем быстрее.
      function gameHide() {
        pet.ground(false);                                       // позицию ведём вручную (не на полу)
        const FINDS = 5;
        const timers = [], hud = hudMake(), startAt = Date.now();
        let nub = null, spot = null, hidden = false, rehideAt = 0, finds = 0, over = false;
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
          if (over) return;
          spot = pickSpot(); hidden = true; rehideAt = 0;
          if (!nub) { nub = mk('twtr-game-nub'); nub.textContent = '🐱'; nub.addEventListener('click', (e) => { e.stopPropagation(); pop(); }); }
          nub.style.display = 'block';
          pet.appear(false); placeAt();
        }
        function pop() {
          if (!hidden || over) return; hidden = false;
          if (nub) nub.style.display = 'none';
          pet.appear(true); pet.place(spot.x - 23, spot.y - 32); pet.happy(900); pet.emote('happy', 900); pet.particles('#ffd34d', 8);
          pet.say(gt().peek, 1100);
          finds++;
          if (finds >= FINDS) {                                  // раунд собран: счёт = время (десятые секунды честно попадают в рекорд)
            over = true;
            const sec = Math.round((Date.now() - startAt) / 100) / 10;
            const xp = pure.hideXp(sec);
            finishRound({ id: 'hide', score: sec, lowerBetter: true, xp, mood: 4, emo: 'levelup', text: gt().hideEnd(sec.toFixed(1), xp), timers });
          }
        }
        const offTick = events.on('game:tick', (d) => {
          if (over) return;
          hud.set('🔍 ' + finds + '/' + FINDS + ' · ' + pure.fmtSec(Date.now() - startAt) + gt().sec);
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
        return { end() { offTick(); offPet(); hud.remove(); pet.appear(true); if (nub) { try { nub.remove(); } catch (_) {} } try { xb.remove(); } catch (_) {} timers.forEach(clearTimeout); } };
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
