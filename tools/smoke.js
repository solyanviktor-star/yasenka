// Живой smoke-тест расширения «Яся» в реальном Chrome (puppeteer-core).
// Проверяет: загрузку на странице, движение, поглаживание мышью, паузу, попап
// (тумблеры флагов, экспорт/импорт), кнопку скачивания картинок, чистоту консоли.
//
// Запуск (puppeteer-core не входит в зависимости проекта — ставится одноразово):
//   npm i --no-save puppeteer-core
//   node tools/smoke.js
// Переопределение путей: YASIA_EXT (папка расширения), CHROME_PATH (бинарь Chrome).
'use strict';
const puppeteer = require('puppeteer-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const EXT = process.env.YASIA_EXT || path.resolve(__dirname, '..');
const CHROME = process.env.CHROME_PATH || [
  (process.env.ProgramFiles || '') + '\\Google\\Chrome\\Application\\chrome.exe',
  (process.env['ProgramFiles(x86)'] || '') + '\\Google\\Chrome\\Application\\chrome.exe',
  (process.env.LOCALAPPDATA || '') + '\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => { try { return fs.existsSync(p); } catch (_) { return false; } });
const PORT = 8123;
const DL_DIR = path.join(require('os').tmpdir(), 'yasia-smoke-downloads');

const results = [];
function check(name, ok, extra) {
  results.push({ name, ok, extra: extra || '' });
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''));
}

const PAGE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>smoke</title></head>
<body style="margin:0;font:16px sans-serif">
  <article style="width:600px;height:180px;background:#eee;margin:40px auto;padding:10px"><p>Tweet-like block one. Some text to stand on and walk around.</p></article>
  <article style="width:600px;height:180px;background:#ddd;margin:40px auto;padding:10px"><p>Second tweet-like block with more text.</p></article>
  <img src="/img1.png" width="400" height="300" style="display:block;margin:20px auto">
  <img src="/img2.png" width="300" height="300" style="display:block;margin:20px auto">
  <div style="height:900px"></div>
</body></html>`;

function startServer() {
  const png = fs.readFileSync(path.join(EXT, 'src', 'items', 'popcorn.png'));
  const srv = http.createServer((req, res) => {
    if (req.url.startsWith('/img')) { res.writeHead(200, { 'content-type': 'image/png' }); res.end(png); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(PAGE_HTML);
  });
  return new Promise((ok) => srv.listen(PORT, '127.0.0.1', () => ok(srv)));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  if (!CHROME) { console.error('Chrome не найден — задай CHROME_PATH'); process.exit(2); }
  fs.rmSync(DL_DIR, { recursive: true, force: true }); fs.mkdirSync(DL_DIR, { recursive: true });
  const srv = await startServer();
  // Chrome 137+ (Stable) не принимает --load-extension: грузим через новый API
  // puppeteer (enableExtensions -> --enable-unsafe-extension-debugging + installExtension).
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    enableExtensions: true,
    args: ['--no-first-run', '--no-default-browser-check', '--window-size=1280,900'],
    defaultViewport: { width: 1280, height: 900 },
  });
  let exitCode = 0;
  try {
    const extId = await browser.installExtension(EXT);
    check('расширение установлено (installExtension)', !!extId, extId);
    // все загрузки (chrome.downloads и <a download>) — во временную папку, не в «Загрузки» пользователя
    const bcdp = await browser.target().createCDPSession();
    await bcdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL_DIR, eventsEnabled: true });

    const page = await browser.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'load' });

    // 1) питомец появился
    let petOk = false;
    try { await page.waitForSelector('#twtr-pet', { timeout: 12000 }); petOk = true; } catch (_) {}
    check('питомец появился на странице', petOk);
    if (!petOk) throw new Error('нет питомца — дальше нечего проверять');
    await sleep(2500);

    const petBox = async () => page.evaluate(() => { const p = document.querySelector('#twtr-pet'); const r = p.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, display: getComputedStyle(p).display }; });

    // 2) живёт и двигается (roam по умолчанию включён)
    const p1 = await petBox(); await sleep(3500); const p2 = await petBox();
    const moved = Math.hypot(p2.x - p1.x, p2.y - p1.y) > 3;
    check('питомец двигается сам (roam)', moved, `d=${Math.hypot(p2.x - p1.x, p2.y - p1.y).toFixed(1)}px`);

    // 3) поглаживание мышью: ёрзаем курсором по спрайту туда-сюда -> «мур» (пузырь/is-happy)
    const b = await petBox();
    const cy = b.y + b.h * 0.5;
    for (let pass = 0; pass < 14; pass++) {
      const x0 = b.x + 4, x1 = b.x + b.w - 4;
      const from = pass % 2 ? x1 : x0, to = pass % 2 ? x0 : x1;
      for (let s = 0; s <= 6; s++) await page.mouse.move(from + (to - from) * (s / 6), cy);
      await sleep(40);
    }
    await sleep(400);
    const stroked = await page.evaluate(() => {
      const pet = document.querySelector('#twtr-pet'), bub = document.querySelector('#twtr-pet-bubble');
      return pet.classList.contains('is-happy') || (bub && bub.classList.contains('show'));
    });
    check('поглаживание мышью даёт реакцию (мур/радость)', stroked);

    // 4) попап: новые контролы на месте
    const popup = await browser.newPage();
    await popup.goto('chrome-extension://' + extId + '/src/popup.html', { waitUntil: 'load' });
    await sleep(900);
    const popupState = await popup.evaluate(() => ({
      paused: !!document.getElementById('paused'),
      flagsN: document.querySelectorAll('#flags [data-flag]').length,
      exportBtn: (document.getElementById('exportBtn') || {}).textContent || '',
      importBtn: !!document.getElementById('importBtn'),
    }));
    check('попап: чекбокс паузы есть', popupState.paused);
    check('попап: тумблеры флагов построены (7 шт.)', popupState.flagsN === 7, 'n=' + popupState.flagsN);
    check('попап: кнопки экспорта/импорта на месте', !!popupState.exportBtn && popupState.importBtn, popupState.exportBtn);

    // 5) пауза: включаем из попапа -> питомец замирает на странице.
    // ВАЖНО: tick стоит на скрытой вкладке (document.hidden) — перед замерами возвращаем страницу на передний план.
    await popup.evaluate(() => new Promise((ok) => chrome.storage.sync.set({ paused: true }, ok)));
    await page.bringToFront(); await sleep(1200);
    const q1 = await petBox(); await sleep(2500); const q2 = await petBox();
    const frozen = Math.hypot(q2.x - q1.x, q2.y - q1.y) <= 1;
    check('пауза: питомец замер на месте', frozen, `d=${Math.hypot(q2.x - q1.x, q2.y - q1.y).toFixed(1)}px`);
    check('пауза: питомец остался видимым', q2.display !== 'none');
    await popup.evaluate(() => new Promise((ok) => chrome.storage.sync.set({ paused: false }, ok)));
    await page.bringToFront(); await sleep(700);
    const r1 = await petBox();
    let resumeD = 0;   // гуляние делает паузы по несколько секунд — меряем максимум смещения за 9с
    for (let i = 0; i < 18; i++) { await sleep(500); const rr = await petBox(); resumeD = Math.max(resumeD, Math.hypot(rr.x - r1.x, rr.y - r1.y)); if (resumeD > 3) break; }
    check('после паузы снова живёт', resumeD > 3, `d=${resumeD.toFixed(1)}px`);

    // 6) флаг из попапа долетает в storage и на страницу (watch -> flags:changed)
    await popup.evaluate(() => { const c = document.querySelector('#flags [data-flag="games"]'); c.checked = false; c.dispatchEvent(new Event('change')); });
    await sleep(600);
    const flagSaved = await popup.evaluate(() => new Promise((ok) => chrome.storage.sync.get({ yasiaFlags: null }, (s) => ok(s.yasiaFlags && s.yasiaFlags.games === false))));
    check('флаг games=false записан в sync из попапа', !!flagSaved);
    const dlgOpen = await page.evaluate(() => {
      const pet = document.querySelector('#twtr-pet'); pet.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return new Promise((ok) => setTimeout(() => ok(!!document.querySelector('#twtr-dialog.show')), 600));
    });
    check('клик по питомцу открывает окно', dlgOpen);
    await popup.evaluate(() => { const c = document.querySelector('#flags [data-flag="games"]'); c.checked = true; c.dispatchEvent(new Event('change')); });

    // 7) вкладка медиа: кнопка «скачать картинки» есть и реально качает
    const imgsBtn = await page.evaluate(() => new Promise((ok) => {
      const cap = document.querySelector('#twtr-cap-dl'); if (!cap) return ok({ found: false });
      cap.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      setTimeout(() => {
        const btn = document.querySelector('#twtr-dlg-dli');
        if (!btn) return ok({ found: false });
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        setTimeout(() => { const st = document.querySelector('#twtr-dlg-status'); ok({ found: true, status: st ? st.textContent : '' }); }, 2500);
      }, 700);
    }));
    check('кнопка «скачать картинки» в окне есть', imgsBtn.found);
    check('скачивание картинок: статус успеха', /✓/.test(imgsBtn.status || ''), (imgsBtn.status || '').slice(0, 60));

    // 8) экспорт: файл скачивается и валиден (вкладка попапа активна — клики/скачивания в фоне Chrome глушит)
    await popup.bringToFront(); await sleep(300);
    await popup.evaluate(() => { document.querySelectorAll('details').forEach((d) => { d.open = true; }); document.getElementById('exportBtn').click(); });
    let expFile = null;
    for (let i = 0; i < 30 && !expFile; i++) { await sleep(300); const f = fs.readdirSync(DL_DIR).filter((x) => x.endsWith('.json') && !x.endsWith('.crdownload')); if (f.length) expFile = path.join(DL_DIR, f[0]); }
    let expData = null;
    try { expData = JSON.parse(fs.readFileSync(expFile, 'utf8')); } catch (_) {}
    check('экспорт: JSON-файл скачан', !!expData, expFile ? path.basename(expFile) : 'нет файла');
    check('экспорт: формат верный (app=yasenka, sync+local, без yasiaAI)', !!expData && expData.app === 'yasenka' && expData.sync && expData.local && !('yasiaAI' in (expData.local || {})), expData ? 'ключей sync=' + Object.keys(expData.sync).length + ' local=' + Object.keys(expData.local).length : '');

    // 9) импорт: подменяем hunger=42 и скармливаем файл обратно через doImport(File)
    if (expData) {
      expData.local.hunger = 42; expData.local.hungerAt = Date.now();
      const impOk = await popup.evaluate(async (txt) => {
        const f = new File([txt], 'b.json', { type: 'application/json' });
        doImport(f);
        await new Promise((r) => setTimeout(r, 500));
        return new Promise((ok) => chrome.storage.local.get({ hunger: -1 }, (s) => ok(s.hunger)));
      }, JSON.stringify(expData));
      check('импорт: hunger=42 применился в storage', impOk === 42, 'hunger=' + impOk);
    }

    // 10) ошибки консоли страницы от расширения
    const extErrors = errors.filter((e) => /yasia|twtr|chrome-extension/i.test(e));
    check('консоль без ошибок расширения', extErrors.length === 0, extErrors.slice(0, 2).join(' || '));

    const failed = results.filter((r) => !r.ok);
    console.log('\n==== ИТОГ: ' + (results.length - failed.length) + '/' + results.length + ' PASS ====');
    if (failed.length) { exitCode = 1; console.log('Провалены: ' + failed.map((f) => f.name).join('; ')); }
  } catch (e) {
    exitCode = 2; console.error('SMOKE CRASH:', e);
  } finally {
    await browser.close().catch(() => {});
    srv.close();
  }
  process.exit(exitCode);
})();
