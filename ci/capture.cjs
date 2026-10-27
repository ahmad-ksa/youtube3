// CI probe: loads YouTube's TV app (https://www.youtube.com/tv) in Chrome with an LG webOS user agent and our
// built user script injected at document start (as webOS does), then saves the InnerTube JSON it receives
// (guide = side menu, browse = pages) and screenshots, so the app's own data formats can be studied.
const { chromium } = require('playwright');
const fs = require('fs');

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
    await ctx.addInitScript({ path: 'dist/webOSUserScripts/userScript.js' });
  }
  const p = await ctx.newPage();
  let n = 0;
  p.on('console', (m) => {
    if (!/WebGL|adapters/.test(m.text()))
      say(`  [${m.type()}] ${m.text().slice(0, 300)}`);
  });
  p.on('pageerror', (e) => say('  [pageerror] ' + e.message));
  p.on('response', async (r) => {
    const u = r.url();
    const m = u.match(/youtubei\/v1\/(\w+)/);
    if (!m) return;
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
  await p.waitForTimeout(15000);
  await p.screenshot({ path: `${OUT}/1-home.png` });
  // open the side menu (guide): Left from the first row, then walk down it
  await p.keyboard.press('ArrowLeft');
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${OUT}/2-guide.png` });
  for (let i = 0; i < 4; i++) {
    await p.keyboard.press('ArrowDown');
    await p.waitForTimeout(400);
  }
  await p.screenshot({ path: `${OUT}/3-guide-down.png` });
  await p.keyboard.press('Enter');
  await p.waitForTimeout(6000);
  await p.screenshot({ path: `${OUT}/4-guide-item-page.png` });
  // search page as a grid sample
  await p.evaluate(() => {
    location.hash = '#/search?q=' + encodeURIComponent('وثائقي');
  });
  await p.waitForTimeout(8000);
  await p.screenshot({ path: `${OUT}/5-search.png` });
  const hooks = await p.evaluate(() => ({
    yttv:
      typeof window._yttv === 'object' ? Object.keys(window._yttv).length : 0,
    hash: location.hash
  }));
  say('page state: ' + JSON.stringify(hooks));
  fs.writeFileSync(`${OUT}/log.txt`, log.join('\n'));
  await b.close();
})();
