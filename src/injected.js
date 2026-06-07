// Перехватчик сети в МИРЕ СТРАНИЦЫ (world: MAIN), только на TikTok/Twitter/X/Instagram.
// Изолированный content script не видит fetch/XHR страницы — поэтому ловим прямые mp4-URL
// из ответов GraphQL/API и шлём их в pet.js через window.postMessage. НИЧЕГО не модифицируем,
// только читаем (клон ответа). Контент страницы не трогаем.
(() => {
  const buf = [];                                   // буфер пойманного — переотдаём по запросу (на случай, если pet.js ещё не слушал)
  const post = (url, bitrate, kind, tweetId, cover) => {
    const item = { url, bitrate: bitrate || 0, kind: kind || '', tweetId: tweetId || null, cover: cover || null };
    const ex = buf.find((b) => b.url === item.url);
    if (ex) { if (!ex.tweetId && item.tweetId) ex.tweetId = item.tweetId; if (!ex.cover && item.cover) ex.cover = item.cover; if (item.bitrate > (ex.bitrate || 0)) ex.bitrate = item.bitrate; } // примиряем id/обложку/битрейт, а не «первый победил»
    else { buf.push(item); if (buf.length > 80) buf.shift(); }
    try { window.postMessage({ __yasiaMedia: item }, '*'); } catch (_) {}
  };
  window.addEventListener('message', (e) => {        // pet.js просит «отдай всё, что поймал»
    if (e.source !== window || !e.data || !e.data.__yasiaCollect) return;
    for (const it of buf) { try { window.postMessage({ __yasiaMedia: it }, '*'); } catch (_) {} }
  });
  const unesc = (u) => u.replace(/\\u0026/gi, '&').replace(/\\u002F/gi, '/').replace(/\\\//g, '/');

  // ===== АКТИВНЫЙ ролик ленты «Рекомендации» ЧИТАЕМ ИЗ САМОЙ СТРАНИЦЫ (React) =====
  // В ленте URL не меняется и рядом с видео нет id/ссылки — но у активного <video> в React-пропсах
  // лежит весь объект ролика (id + video.playAddr/bitrateInfo). Только МИР СТРАНИЦЫ это видит. READ-ONLY.
  function yasiaActiveVideoEl() {
    try {
      const cy = window.innerHeight / 2; const cands = [];
      document.querySelectorAll('video').forEach((v) => {
        const r = v.getBoundingClientRect();
        if (r.width < 80 || r.height < 80) return;
        const vh = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
        if (vh <= 0) return;
        cands.push({ v, vh, center: (r.top + r.bottom) / 2, brackets: r.top <= cy && r.bottom >= cy, playing: !v.paused && !v.ended && v.readyState >= 2 && v.currentTime > 0 });
      });
      let pool = cands.filter((c) => c.brackets); if (!pool.length) pool = cands;
      pool.sort((a, b) => (b.playing - a.playing) || (b.vh - a.vh) || (Math.abs(a.center - cy) - Math.abs(b.center - cy)));
      return pool[0] ? pool[0].v : null;
    } catch (_) { return null; }
  }
  function yasiaGetFiber(node) {
    try { const key = Object.keys(node).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')); return key ? node[key] : null; } catch (_) { return null; }
  }
  function yasiaLooksLikeItem(o) {
    return o && typeof o === 'object' && o.video && typeof o.video === 'object' &&
      (typeof o.video.playAddr === 'string' || Array.isArray(o.video.playAddr) || Array.isArray(o.video.bitrateInfo)) && (o.id || o.aweme_id);
  }
  function yasiaFindItemIn(obj, depth) {
    if (!obj || typeof obj !== 'object' || (depth || 0) > 4) return null;
    if (yasiaLooksLikeItem(obj)) return obj;
    for (const k of ['videoData', 'item', 'data', 'feedItem', 'aweme', 'itemStruct', 'value', 'itemInfo']) {
      const c = obj[k];
      if (c && typeof c === 'object') { if (yasiaLooksLikeItem(c)) return c; const deep = yasiaFindItemIn(c, (depth || 0) + 1); if (deep) return deep; }
    }
    return null;
  }
  function yasiaCurrentItem() {
    const v = yasiaActiveVideoEl(); if (!v) return null;
    let el = v, fiber = null;                                  // у <video> fiber'а НЕТ — он на РОДИТЕЛЕ (ур. ~2): сперва ищем элемент с fiber
    for (let up = 0; el && up < 20 && !fiber; el = el.parentElement, up++) fiber = yasiaGetFiber(el);
    for (let hops = 0; fiber && hops < 40; fiber = fiber.return, hops++) {   // дальше вверх по дереву fiber'ов: item лежит в memoizedProps.value.item
      try { const hit = yasiaFindItemIn(fiber.memoizedProps) || yasiaFindItemIn(fiber.memoizedState); if (hit) return hit; } catch (_) {}
    }
    return null;
  }
  function yasiaExtractItem(item) {
    try {
      const vd = item.video || {};
      const id = (item.id || item.aweme_id) ? String(item.id || item.aweme_id) : null;
      let url = Array.isArray(vd.playAddr) ? vd.playAddr[0] : vd.playAddr; let br = 0;
      if (Array.isArray(vd.bitrateInfo) && vd.bitrateInfo.length) {
        const best = vd.bitrateInfo.slice().sort((a, b) => (b.Bitrate || 0) - (a.Bitrate || 0))[0];
        const u = best && best.PlayAddr && best.PlayAddr.UrlList && best.PlayAddr.UrlList[0];
        if (u) { url = u; br = best.Bitrate || 0; }
      }
      if (typeof url !== 'string' || !/^https?:/.test(url)) return null;
      const cover = (typeof vd.cover === 'string' && vd.cover) || (typeof vd.originCover === 'string' && vd.originCover) || (typeof vd.dynamicCover === 'string' && vd.dynamicCover) || null;
      const user = (item.author && (item.author.uniqueId || item.author)) || null;
      return { id, url: unesc(url), bitrate: br, cover: cover ? unesc(cover) : null, author: typeof user === 'string' ? user : null };
    } catch (_) { return null; }
  }
  window.addEventListener('message', (e) => {            // pet.js просит активный ролик ленты (по факту со страницы)
    if (e.source !== window || !e.data || e.data.__yasiaActiveReq == null) return;
    const reqId = e.data.__yasiaActiveReq; let out = { reqId, id: null, url: null };
    try { const item = yasiaCurrentItem(); if (item) { const ex = yasiaExtractItem(item); if (ex && ex.url) out = Object.assign({ reqId }, ex, { referer: 'https://www.tiktok.com/' }); } } catch (_) {}
    try { window.postMessage({ __yasiaActive: out }, '*'); } catch (_) {}
  });

  // TikTok: СТРУКТУРНО — привязываем каждый playAddr к id ролика (иначе из ленты берётся чужой)
  function harvestTikTok(node, depth) {
    if (!node || typeof node !== 'object' || (depth || 0) > 18) return false;
    let any = false;
    const v = node.video;
    if (v && typeof v === 'object' && (typeof v.playAddr === 'string' || Array.isArray(v.playAddr) || Array.isArray(v.bitrateInfo))) {
      const id = node.id || node.awemeId || node.aweme_id || null;
      const cover = (typeof v.cover === 'string' && v.cover) || (typeof v.originCover === 'string' && v.originCover) || (typeof v.dynamicCover === 'string' && v.dynamicCover) || null;
      let url = Array.isArray(v.playAddr) ? v.playAddr[0] : v.playAddr;
      let br = 0;
      if (Array.isArray(v.bitrateInfo) && v.bitrateInfo.length) {
        const best = v.bitrateInfo.slice().sort((a, b) => (b.Bitrate || 0) - (a.Bitrate || 0))[0];
        const u = best && best.PlayAddr && best.PlayAddr.UrlList && best.PlayAddr.UrlList[0];
        if (u) { url = u; br = best.Bitrate || 0; }
      }
      if (typeof url === 'string' && /^https?:/.test(url)) { post(unesc(url), br, 'tiktok', id ? String(id) : null, cover ? unesc(cover) : null); any = true; }
    }
    for (const k in node) { const c = node[k]; if (c && typeof c === 'object') { if (harvestTikTok(c, (depth || 0) + 1)) any = true; } }
    return any;
  }

  // Instagram: СТРУКТУРНО — привязываем каждое video_versions к code/pk ролика + обложка (для матча с активным видео)
  function harvestInstagram(node, depth) {
    if (!node || typeof node !== 'object' || (depth || 0) > 18) return false;
    let any = false;
    if (Array.isArray(node.video_versions) && node.video_versions.length) {
      const best = node.video_versions.slice().sort((a, b) => (b.width || 0) - (a.width || 0))[0];
      if (best && best.url) {
        const iv = node.image_versions2 && node.image_versions2.candidates;
        const cover = (Array.isArray(iv) && iv.length && iv[0].url) || (typeof node.thumbnail_url === 'string' && node.thumbnail_url) || null;
        const id = node.code || node.shortcode || node.pk || node.id || null;
        post(unesc(best.url), best.width || 0, 'instagram', id ? String(id) : null, cover ? unesc(cover) : null);
        any = true;
      }
    }
    for (const k in node) { const c = node[k]; if (c && typeof c === 'object') { if (harvestInstagram(c, (depth || 0) + 1)) any = true; } }
    return any;
  }

  // Twitter: СТРУКТУРНО — привязываем каждый ролик к id_str твита (иначе берётся чужой из ленты/ответов)
  function harvestTwitter(node, depth) {
    if (!node || typeof node !== 'object' || (depth || 0) > 16) return false;
    let any = false;
    const legacy = node.legacy || node;
    const media = (legacy.extended_entities && legacy.extended_entities.media) || (legacy.entities && legacy.entities.media);
    const id = legacy.id_str || node.rest_id || null;
    if (Array.isArray(media)) {
      for (const md of media) {
        const vs = md.video_info && md.video_info.variants;
        if (Array.isArray(vs)) {
          const best = vs.filter((v) => v.content_type === 'video/mp4').sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
          if (best && best.url) { post(best.url, best.bitrate || 0, 'twitter', id); any = true; }
        }
      }
    }
    for (const k in node) { const v = node[k]; if (v && typeof v === 'object') { if (harvestTwitter(v, (depth || 0) + 1)) any = true; } }
    return any;
  }

  function scan(text) {
    if (!text || typeof text !== 'string' || text.length < 20) return;
    if (text.indexOf('video') === -1 && text.indexOf('playAddr') === -1) return;
    // Twitter: пробуем распарсить JSON и привязать к id твита
    if (text.indexOf('video_info') !== -1 && text.indexOf('variants') !== -1) {
      try { if (harvestTwitter(JSON.parse(text), 0)) return; } catch (_) {}
    }
    // TikTok: пробуем распарсить JSON и привязать каждый playAddr к id ролика
    if (text.indexOf('playAddr') !== -1 || text.indexOf('bitrateInfo') !== -1) {
      try { if (harvestTikTok(JSON.parse(text), 0)) return; } catch (_) {}
    }
    // Instagram: пробуем распарсить JSON и привязать каждое video_versions к code/pk + обложка
    if (text.indexOf('video_versions') !== -1) {
      try { if (harvestInstagram(JSON.parse(text), 0)) return; } catch (_) {}
    }
    let m;
    try {
      // Instagram: video_versions[].url (первый — лучшее качество)
      const reIg = /"video_versions":\[\{[\s\S]*?"url":"([^"]+)"/g;
      while ((m = reIg.exec(text))) post(unesc(m[1]), 0, 'instagram');
      // TikTok: playAddr (БЕЗ вотермарки), не downloadAddr; рядом ищем cover, чтобы матч по обложке сработал даже без id
      const reTt = /"playAddr":"(https[^"]+)"/g;
      while ((m = reTt.exec(text))) {
        const win = text.slice(Math.max(0, m.index - 800), m.index + 200);
        const cm = win.match(/"(?:cover|originCover)":"(https[^"]+)"/);
        post(unesc(m[1]), 0, 'tiktok', null, cm ? unesc(cm[1]) : null);
      }
      // Twitter-фолбэк регексом (если JSON не распарсился) — без привязки к id
      const reTw = /"content_type":"video\/mp4","url":"([^"]+)"/g;
      while ((m = reTw.exec(text))) {
        const bm = text.slice(Math.max(0, m.index - 40), m.index).match(/"bitrate":(\d+)/);
        post(unesc(m[1]), bm ? +bm[1] : 0, 'twitter', null);
      }
    } catch (_) {}
  }

  // патчим fetch
  const of = window.fetch;
  if (of) {
    window.fetch = function () {
      const p = of.apply(this, arguments);
      try { p.then((r) => { try { r.clone().text().then(scan).catch(() => {}); } catch (_) {} }).catch(() => {}); } catch (_) {}
      return p;
    };
  }
  // патчим XHR (площадки используют и его)
  const oo = XMLHttpRequest.prototype.open, os = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function () { try { this.__yurl = arguments[1]; } catch (_) {} return oo.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    try { this.addEventListener('load', function () { try { scan(this.responseText); } catch (_) {} }); } catch (_) {}
    return os.apply(this, arguments);
  };
})();
