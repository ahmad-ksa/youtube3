// Offline check of our features with REAL captured YouTube TV data (side menu + search results).
const {
  chromium
} = require('/home/claude/youtube-lg/app/node_modules/playwright');
const fs = require('fs');
const injectLikeWebOS = (code) =>
  `(() => { const run = () => { ${code}\n }; if (document.documentElement) run(); else { const o = new MutationObserver(() => { if (document.documentElement) { o.disconnect(); run(); } }); o.observe(document, { childList: true }); } })();`;

const guide = JSON.parse(
  fs.readFileSync(
    '/tmp/claude-0/-home-claude/7576411e-8174-5c04-97d5-3cff1d4cee93/scratchpad/cap/02-guide.json',
    'utf8'
  )
);
const search = JSON.parse(
  fs.readFileSync(
    '/tmp/claude-0/-home-claude/7576411e-8174-5c04-97d5-3cff1d4cee93/scratchpad/cap/04-search.json',
    'utf8'
  )
);
const now = Date.now(),
  H = 3600e3;
const rss = (pl) =>
  '<feed><author><name>Owner</name></author>' +
  [
    [2, 'a'],
    [30, 'b']
  ]
    .map(
      ([h, t], i) =>
        '<entry><yt:videoId>' +
        pl.slice(4, 10) +
        i +
        'xxxxx</yt:videoId><title>' +
        t +
        '</title><author><name>' +
        pl +
        '</name></author><published>' +
        new Date(now - h * H * (pl.endsWith('B') ? 3 : 1)).toISOString() +
        '</published></entry>'
    )
    .join('') +
  '</feed>';
const PAGE =
  '<!doctype html><html><body><script>window.__ready = true;</' +
  'script></body></html>';
(async () => {
  const b = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'
  });
  const ctx = await b.newContext({
    userAgent:
      'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 WebAppManager'
  });
  await ctx.addInitScript({
    content: injectLikeWebOS(
      fs.readFileSync('dist/webOSUserScripts/userScript.js', 'utf8')
    )
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => {
    if (/ytlg|error/i.test(m.text()))
      console.log('   console:', m.text().slice(0, 200));
  });
  const sent = [];
  await p.route('**/*', async (r) => {
    const u = r.request().url();
    if (u === 'https://www.youtube.com/tv')
      return r.fulfill({ status: 200, contentType: 'text/html', body: PAGE });
    if (u.includes('/youtubei/v1/search')) {
      sent.push(JSON.parse(r.request().postData()));
      return r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(search.response)
      });
    }
    if (u.includes('/youtubei/v1/'))
      return r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{}'
      });
    if (u.includes('/feeds/videos.xml')) {
      const pl = u.match(/playlist_id=([\w-]+)/)[1];
      return r.fulfill({
        status: 200,
        contentType: 'application/xml',
        body: rss(pl)
      });
    }
    return r.abort();
  });
  await p.goto('https://www.youtube.com/tv');
  await p.waitForTimeout(1500);
  const res = await p.evaluate(
    async ({ guide, ctx0 }) => {
      const out = {};
      // 1) side menu
      const g = JSON.parse(JSON.stringify(guide));
      out.menu = g.items[0].guideSectionRenderer.items.map(
        (i) => i.guideEntryRenderer.formattedTitle.simpleText
      );
      // 2) the app makes a normal request first (its identity is remembered), then opens our pages
      await fetch('/youtubei/v1/browse?prettyPrint=false', {
        method: 'POST',
        headers: {
          'X-YouTube-Client-Name': '7',
          'X-YouTube-Client-Version': '7.2026'
        },
        body: JSON.stringify({ context: ctx0, browseId: 'default' })
      });
      localStorage.setItem(
        'ytlg.favorites',
        JSON.stringify([
          { channelId: 'UCaaaaaaaaaaA', name: 'A' },
          { channelId: 'UCbbbbbbbbbbB', name: 'B' }
        ])
      );
      const page = async (id) =>
        (
          await fetch('/youtubei/v1/browse?prettyPrint=false', {
            method: 'POST',
            body: JSON.stringify({ context: ctx0, browseId: id })
          })
        ).json();
      const rowsOf = (j) =>
        j.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents.map(
          (s) => ({
            title:
              s.shelfRenderer.headerRenderer.shelfHeaderRenderer.avatarLockup
                .avatarLockupRenderer.title.simpleText,
            cards: s.shelfRenderer.content.horizontalListRenderer.items.map(
              (c) =>
                c.lockupViewModel.metadata.lockupMetadataViewModel.metadata.contentMetadataViewModel.metadataRows
                  .map((r) =>
                    r.metadataParts.map((x) => x.text.content).join(' • ')
                  )
                  .join(' | ')
            )
          })
        );
      out.fav = rowsOf(await page('FEytlg_fav'));
      // the TV app itself uses XMLHttpRequest: same page through XHR
      out.xhr = await new Promise((ok) => {
        const x = new XMLHttpRequest();
        x.open('POST', '/youtubei/v1/browse?prettyPrint=false');
        x.setRequestHeader('Content-Type', 'application/json');
        x.onreadystatechange = () => {
          if (x.readyState === 4)
            ok({
              status: x.status,
              rows: rowsOf(JSON.parse(x.responseText)).length,
              via: 'onreadystatechange'
            });
        };
        x.send(JSON.stringify({ context: ctx0, browseId: 'FEytlg_fav' }));
      });
      const ex = await page('FEytlg_exploreArab');
      out.explore = rowsOf(ex).map((r) => ({
        title: r.title,
        n: r.cards.length,
        first: r.cards.slice(0, 3)
      }));
      // 3) YouTube's own cards get the favourite item
      const s2 = JSON.parse(JSON.stringify(ctx0.__search));
      out.cardMenu =
        s2.contents.sectionListRenderer.contents[0].shelfRenderer.content.horizontalListRenderer.items[0].lockupViewModel.rendererContext.commandContext.onLongPress.innertubeCommand.showMenuCommand.menu.menuRenderer.items.map(
          (m) => m.menuNavigationItemRenderer.text.runs[0].text
        );
      return out;
    },
    {
      guide: guide.response,
      ctx0: { ...search.request.context, __search: search.response }
    }
  );
  console.log('MENU:', res.menu.join(' | '));
  console.log('FAVOURITES page:');
  for (const r of res.fav)
    console.log('  ' + r.title + ': ' + r.cards.join('  ->  '));
  console.log('EXPLORE ARAB page:');
  for (const r of res.explore)
    console.log('  ' + r.title + ' (' + r.n + '): ' + r.first.join('  ->  '));
  console.log('XHR page:', JSON.stringify(res.xhr));
  console.log('card long-press menu:', res.cardMenu.join(' | '));
  const s = sent[0] || {};
  console.log(
    'our search request: query=' +
      s.query +
      ' params=' +
      s.params +
      ' gl=' +
      s.context?.client?.gl +
      ' hl=' +
      s.context?.client?.hl +
      ' restricted=' +
      s.context?.user?.enableSafetyMode +
      ' client=' +
      s.context?.client?.clientName +
      ' | searches sent: ' +
      sent.length
  );
  console.log('page errors:', errs.length, errs.slice(0, 3));
  await b.close();
})();
