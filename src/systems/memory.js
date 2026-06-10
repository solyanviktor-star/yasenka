// Память Яси (v1.1) — ПРОВАЙДЕРО-НЕЗАВИСИМАЯ: работает одинаково на Hermes, GPT-ключе и подписке.
// Три части: (1) модель пользователя — факты/преференции (их извлекает ai.js доп. LLM-вызовом и кладёт сюда),
// (2) журнал мест — какие сайты посещали (host+заголовок+когда/сколько; БЕЗ LLM, дёшево), (3) эпизоды — сводки.
// Хранилище — chrome.storage.local (локально на устройстве, не синкается). recall() отдаёт ai.js компактную выжимку под запрос.
// Падение тут гасит флаг 'memory' — питомец живёт. Журнал ведёт сам (само-логирование текущей страницы + SPA-навигации).
(() => {
  'use strict';
  const Yasia = (window.Yasia = window.Yasia || {});
  if (!Yasia.systems) return;

  const MEM_KEY = 'yasiaMemory';     // { profile:[{id,text,ts}], episodes:[{id,text,ts}], updatedAt }
  const PLC_KEY = 'yasiaPlaces';     // { sites: { <host>: {host,title,url,first,last,visits} } }
  const MAX_FACTS = 60, MAX_EPISODES = 30, MAX_PLACES = 300;
  const RECALL_CAP = 1100;           // жёсткий лимит выжимки в символах — чтобы не раздувать каждый запрос
  const now = () => Date.now();
  const uid = () => 'm' + now().toString(36) + Math.floor(Math.random() * 1e5).toString(36);

  Yasia.systems.register({
    name: 'memory',
    flag: 'memory',
    init(ctx) {
      const storage = (ctx && ctx.storage) || Yasia.storage;
      let mem = { profile: [], episodes: [], updatedAt: 0 };
      let plc = { sites: {} };
      let loaded = false, pendingVisit = null, watchTimer = 0, lastHref = '';

      const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
      const tokens = (s) => norm(s).split(/[^a-zа-яё0-9]+/i).filter((w) => w.length > 2);
      const saveMem = () => { mem.updatedAt = now(); try { storage.localSet({ [MEM_KEY]: mem }); } catch (_) {} };
      const savePlc = () => { try { storage.localSet({ [PLC_KEY]: plc }); } catch (_) {} };

      try {
        storage.localGet({ [MEM_KEY]: null, [PLC_KEY]: null }, (s) => {
          if (s && s[MEM_KEY] && typeof s[MEM_KEY] === 'object') { mem = Object.assign(mem, s[MEM_KEY]); mem.profile = mem.profile || []; mem.episodes = mem.episodes || []; }
          if (s && s[PLC_KEY] && typeof s[PLC_KEY] === 'object') { plc = Object.assign(plc, s[PLC_KEY]); plc.sites = plc.sites || {}; }
          loaded = true;
          if (pendingVisit) { const p = pendingVisit; pendingVisit = null; noteVisit(p.url, p.title); }   // визит до загрузки -> применяем после
          else noteVisit(location.href, document.title);   // залогировать текущую страницу
        });
      } catch (_) { loaded = true; }

      function noteVisit(url, title) {
        try { if (Yasia.guard && !Yasia.guard.allows('journal')) return; } catch (_) {}   // страж: в безопасном режиме журнал сайтов на паузе
        if (!url) return;
        if (!loaded) { pendingVisit = { url, title }; return; }   // ждём загрузку хранилища, иначе перезапишем
        let host = ''; try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return; }
        if (!host) return;
        lastHref = url;
        const t = (title || '').trim().slice(0, 160);
        const cur = plc.sites[host] || { host, title: t, url, first: now(), last: 0, visits: 0 };
        cur.visits += 1; cur.last = now(); if (t) { cur.title = t; cur.url = url; }
        plc.sites[host] = cur;
        const hosts = Object.keys(plc.sites);
        if (hosts.length > MAX_PLACES) {                          // прунинг: выкидываем самые старые по last
          hosts.sort((a, b) => plc.sites[a].last - plc.sites[b].last);
          for (let i = 0; i < hosts.length - MAX_PLACES; i++) delete plc.sites[hosts[i]];
        }
        savePlc();
      }
      // SPA-навигация (X/YouTube меняют URL без перезагрузки) — ловим сменой href + поздний заголовок
      try { watchTimer = setInterval(() => { try { if (loaded && location.href !== lastHref) noteVisit(location.href, document.title); } catch (_) {} }, 6000); } catch (_) {}
      try { setTimeout(() => { try { if (loaded) noteVisit(location.href, document.title); } catch (_) {} }, 3500); } catch (_) {}   // дать заголовку устаканиться

      function addFacts(facts) {
        if (!Array.isArray(facts)) return 0; let added = 0;
        for (let f of facts) {
          f = String(f || '').trim().slice(0, 200); if (f.length < 4) continue;
          const nf = norm(f);
          if (mem.profile.some((p) => norm(p.text) === nf)) continue;   // точный дубль не пишем
          mem.profile.push({ id: uid(), text: f, ts: now() }); added++;
        }
        if (mem.profile.length > MAX_FACTS) mem.profile = mem.profile.slice(-MAX_FACTS);   // грубый предел; умное слияние — compaction в ai.js
        if (added) saveMem();
        return added;
      }
      function addEpisode(text) {
        text = String(text || '').trim().slice(0, 400); if (text.length < 8) return;
        mem.episodes.push({ id: uid(), text, ts: now() });
        if (mem.episodes.length > MAX_EPISODES) mem.episodes = mem.episodes.slice(-MAX_EPISODES);
        saveMem();
      }

      function searchPlaces(query, limit) {
        const qt = tokens(query); if (!qt.length) return [];
        return Object.values(plc.sites).map((s) => {
          const hay = norm(s.host + ' ' + s.title); let score = 0; for (const w of qt) if (hay.indexOf(w) !== -1) score += 1; return { s, score };
        }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score || b.s.last - a.s.last).slice(0, limit || 6).map((x) => x.s);
      }
      const recentPlaces = (limit) => Object.values(plc.sites).sort((a, b) => b.last - a.last).slice(0, limit || 5);
      function fmtPlace(s, lang) {
        let d = ''; try { d = new Date(s.last).toLocaleDateString(lang === 'en' ? 'en-US' : 'ru-RU', { dateStyle: 'short' }); } catch (_) {}
        return s.host + (s.title ? ' — ' + s.title : '') + (d ? ' (' + d + ')' : '') + (s.visits > 1 ? ' ×' + s.visits : '');
      }

      // компактная выжимка для system-промпта: релевантные факты + подходящие/недавние сайты (с жёстким лимитом)
      function recall(query, lang) {
        const en = lang === 'en'; const parts = [];
        if (mem.profile.length) {
          const qt = tokens(query);
          const ranked = mem.profile.map((p) => { const hay = norm(p.text); let sc = 0; for (const w of qt) if (hay.indexOf(w) !== -1) sc += 2; return { p, sc }; })
            .sort((a, b) => b.sc - a.sc || b.p.ts - a.p.ts).slice(0, 6).map((x) => x.p.text);
          if (ranked.length) parts.push((en ? 'What you remember about the user:\n- ' : 'Что ты помнишь о пользователе:\n- ') + ranked.join('\n- '));
        }
        const matched = searchPlaces(query, 6);
        if (matched.length) parts.push((en ? 'Matching sites you visited together:\n- ' : 'Подходящие сайты, где вы были:\n- ') + matched.map((s) => fmtPlace(s, lang)).join('\n- '));
        else { const rec = recentPlaces(5); if (rec.length) parts.push((en ? 'Recently visited sites:\n- ' : 'Недавно посещённые сайты:\n- ') + rec.map((s) => fmtPlace(s, lang)).join('\n- ')); }
        let out = parts.join('\n\n');
        if (out.length > RECALL_CAP) out = out.slice(0, RECALL_CAP) + '…';
        return out;
      }

      Yasia.memory = {
        noteVisit, addFacts, addEpisode, recall,
        profile: () => mem.profile.slice(),
        places: () => Object.values(plc.sites).sort((a, b) => b.last - a.last),
        episodes: () => mem.episodes.slice(),
        removeFact: (id) => { mem.profile = mem.profile.filter((p) => p.id !== id); saveMem(); },
        clearProfile: () => { mem.profile = []; mem.episodes = []; saveMem(); },
        clearPlaces: () => { plc.sites = {}; savePlc(); },
        needsCompaction: () => mem.profile.length >= MAX_FACTS - 5,
        setProfileTexts: (texts) => { mem.profile = (texts || []).map((x) => ({ id: uid(), text: String(x).slice(0, 200), ts: now() })); saveMem(); },
        maxFacts: MAX_FACTS,
      };

      return { destroy() { try { if (watchTimer) clearInterval(watchTimer); } catch (_) {} if (Yasia.memory) try { delete Yasia.memory; } catch (_) { Yasia.memory = null; } } };
    },
    destroy(inst) { if (inst && inst.destroy) inst.destroy(); },
  });
})();
