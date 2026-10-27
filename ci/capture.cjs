// CI probe: loads YouTube's TV app (https://www.youtube.com/tv) in Chrome with an LG webOS user agent and our
// built user script injected at document start (as webOS does), then saves the InnerTube JSON it receives
// (guide = side menu, browse = pages) and screenshots, so the app's own data formats can be studied.
const { chromium } = require('playwright');
const fs = require('fs');
const injectLikeWebOS = (code) =>
  `(() => { const run = () => { ${code}\n }; if (document.documentElement) run(); else { const o = new MutationObserver(() => { if (document.documentElement) { o.disconnect(); run(); } }); o.observe(document, { childList: true }); } })();`;

const UA =
  'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 WebAppManager';
const OUT = 'capture';
fs.mkdirSync(OUT, { recursive: true });
const log = [];
const say = (s) => {
  log.push(s);
  console.log(s);
};

(async () => {
  process.on('unhandledRejection', (e) => {
    say('FATAL ' + ((e && e.stack) || e));
    fs.writeFileSync(`${OUT}/log.txt`, log.join('\n'));
    process.exit(1);
  });
  const b = await chromium.launch({
    channel: process.env.CHANNEL || undefined,
    args: ['--autoplay-policy=no-user-gesture-required']
  });
  const ctx = await b.newContext({
    userAgent: UA,
    viewport: { width: 1920, height: 1080 },
    locale: 'ar-SA'
  });
  if (fs.existsSync('dist/webOSUserScripts/userScript.js')) {
    await ctx.addInitScript({
      content: injectLikeWebOS(
        fs.readFileSync('dist/webOSUserScripts/userScript.js', 'utf8')
      )
    });
  }
  const p = await ctx.newPage();
  let n = 0;
  let searches = 0;
  p.on('console', (m) => {
    if (!/WebGL|adapters/.test(m.text()))
      say(`  [${m.type()}] ${m.text().slice(0, 300)}`);
  });
  p.on('pageerror', (e) => say('  [pageerror] ' + e.message));
  p.on('response', async (r) => {
    const u = r.url();
    const m = u.match(/youtubei\/v1\/(\w+)/);
    if (!m) return;
    if (m[1] === 'search') {
      searches++;
      return;
    }
    try {
      const body = await r.text();
      let req = null;
      try {
        req = JSON.parse(r.request().postData() || 'null');
      } catch {
        /* not json */
      }
      const name = `${String(++n).padStart(2, '0')}-${m[1]}${req?.browseId ? '-' + req.browseId : ''}.json`;
      fs.writeFileSync(
        `${OUT}/${name}`,
        JSON.stringify(
          {
            url: u,
            status: r.status(),
            request: req,
            response: JSON.parse(body)
          },
          null,
          1
        )
      );
      say(`saved ${name} (${r.status()}, ${body.length} bytes)`);
    } catch (e) {
      say('response error ' + u.slice(0, 80) + ' ' + e.message);
    }
  });
  await p.goto('https://www.youtube.com/tv', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(12000);
  await p.screenshot({ path: `${OUT}/1-start.png` });
  // welcome screen: "البدء" (Get started), then the sign-in screen: walk down to "المشاهدة كضيف" (Watch as guest)
  await p.keyboard.press('Enter');
  await p.waitForTimeout(5000);
  for (let i = 0; i < 6; i++) {
    const txt = await p.evaluate(() =>
      (
        document.querySelector('[class*="focused"], :focus')?.textContent || ''
      ).trim()
    );
    say(`focused: ${txt.slice(0, 60)}`);
    if (/كضيف|guest/i.test(txt)) break;
    await p.keyboard.press('ArrowDown');
    await p.waitForTimeout(600);
  }
  await p.keyboard.press('Enter');
  await p.waitForTimeout(8000);
  await p.screenshot({ path: `${OUT}/2-after-welcome.png` });
  // side menu
  await p.keyboard.press('ArrowRight');
  await p.waitForTimeout(400); // RTL: menu is on the right
  await p.keyboard.press('ArrowLeft');
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${OUT}/3-menu.png` });
  // our pages, opened the way the app opens a page
  const open = async (id, wait, shot) => {
    const before = searches;
    const t0 = Date.now();
    await p.evaluate((x) => {
      location.hash = '#/browse?c=' + x;
    }, id);
    // wait until a card shows (or the time is up)
    let shown = -1;
    while (Date.now() - t0 < wait) {
      await p.waitForTimeout(500);
      const n = await p.evaluate(
        () =>
          document.querySelectorAll(
            'ytlr-tile-renderer, [class*="lockup"], ytlr-lockup-view-model'
          ).length
      );
      if (n > 0 && shown < 0) shown = Date.now() - t0;
      if (shown >= 0 && Date.now() - t0 > shown + 2500) break;
    }
    await p.screenshot({ path: `${OUT}/${shot}.png` });
    say(
      `PAGE ${id}: first cards after ${shown < 0 ? 'never' : shown + ' ms'}, searches ${searches - before}`
    );
  };
  // the player: open a video and capture the data YouTube's player bar is built from (/next, /player)
  await p.evaluate(() => {
    location.hash = '#/watch?v=dQw4w9WgXcQ';
  });
  await p.waitForTimeout(15000);
  await p.screenshot({ path: `${OUT}/6-player.png` });
  await p.keyboard.press('Enter');
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${OUT}/7-player-bar.png` });
  await p.keyboard.press('ArrowDown');
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${OUT}/8-player-bar-down.png` });
  const hooks = await p.evaluate(() => ({
    yttv:
      typeof window._yttv === 'object' ? Object.keys(window._yttv).length : 0,
    hash: location.hash
  }));
  say('page state: ' + JSON.stringify(hooks));
  fs.writeFileSync(`${OUT}/log.txt`, log.join('\n'));
  await b.close();
})();
