// Our features inside YouTube's TV interface:
// - extra entries in its side menu (guide) that open our pages;
// - those pages are answered locally (net.js) in YouTube's own page format (render.js);
// - "❤ add channel to favourites" in the long-press menu of every video card;
// - channel pages: uploads row first, every row newest -> oldest;
// - the channel of every played video is remembered (for "الجديد" and to keep Explore free of your channels).
import { definePage } from './net.js';
import { datedPage } from './render.js';
import { LISTS, list, favoritesList, newList, music } from './lists.js';
import { favorites, history } from './util.js';
import { ResolveCommandRegistry } from '../app_api';
import { installPlayerButton } from './playerButton.js';
import { sortChannelPage } from './channelSort.js';

const isFav = (id) => favorites.has(id);

/** Small on-screen message (bottom centre), independent of AdFree's own UI module. */
function toast(text, ms = 3000) {
  const el = document.createElement('div');
  el.textContent = text;
  el.setAttribute('dir', 'auto');
  el.style.cssText =
    'position:fixed;left:50%;bottom:8%;transform:translateX(-50%);z-index:2147483647;background:rgba(20,20,20,.92);color:#fff;font:500 30px/1.4 sans-serif;padding:18px 36px;border-radius:40px;box-shadow:0 8px 30px rgba(0,0,0,.5);transition:opacity .3s;';
  (document.body || document.documentElement).appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 400);
  }, ms);
}

// ---------------------------------------------------------------- pages
const PAGES = [
  // [browseId suffix, side-menu title, icon, builder]
  [
    'fav',
    'المفضلة',
    'LIKE',
    async () => datedPage('المفضلة', await favoritesList(), isFav)
  ],
  [
    'new',
    'الجديد',
    'SUBSCRIPTIONS',
    async () => datedPage('الجديد', await newList(), isFav)
  ],
  ['exploreWorld', 'استكشف العالم', 'EXPLORE', null],
  ['exploreArab', 'استكشف العرب', 'EXPLORE', null],
  ['exploreSaudi', 'استكشف السعودية', 'EXPLORE', null],
  ['exploreGulf', 'استكشف الخليج', 'EXPLORE', null],
  ['exploreEgypt', 'استكشف مصر', 'EXPLORE', null],
  ['travelNew', 'جديد السياحة', 'EXPLORE', null],
  ['trendWorld', 'تريند العالم', 'TRENDING', null],
  ['trendArab', 'الترند العربي', 'TRENDING', null],
  ['trendSaudi', 'الترند السعودي', 'TRENDING', null],
  ['trendGulf', 'ترند الخليج', 'TRENDING', null],
  [
    'musicArab',
    'الموسيقى العربية',
    'YOUTUBE_MUSIC',
    async () => datedPage('الموسيقى العربية', await music('arab'), isFav)
  ],
  [
    'musicEgypt',
    'الأغاني المصرية الجديدة',
    'YOUTUBE_MUSIC',
    async () =>
      datedPage('الأغاني المصرية الجديدة', await music('egypt'), isFav)
  ],
  [
    'musicWorld',
    'الموسيقى الأجنبية',
    'YOUTUBE_MUSIC',
    async () => datedPage('الموسيقى الأجنبية', await music('world'), isFav)
  ],
  ['trendMusic', 'تريند الأغاني العالمي', 'TRENDING', null]
];
const ID = (k) => 'FEytlg_' + k;

for (const [key, title, , build] of PAGES) {
  definePage(
    ID(key),
    build || (async () => datedPage(title, await list(key), isFav))
  );
}
void LISTS;

// ---------------------------------------------------------------- JSON hook: guide entries, card menus, history
const origParse = JSON.parse;

function guideEntry(key, title, icon) {
  return {
    guideEntryRenderer: {
      navigationEndpoint: { browseEndpoint: { browseId: ID(key) } },
      icon: { iconType: icon },
      formattedTitle: { simpleText: title }
    }
  };
}

/** Adds our entries to YouTube's side menu, right after its home entry. */
function addGuide(r) {
  const sec = r?.items?.[0]?.guideSectionRenderer;
  if (
    !sec?.items ||
    sec.items.some((i) =>
      i.guideEntryRenderer?.navigationEndpoint?.browseEndpoint?.browseId?.startsWith(
        'FEytlg_'
      )
    )
  )
    return;
  const home = sec.items.findIndex((i) =>
    /^FEtopics$|^FEwhat_to_watch$/.test(
      i.guideEntryRenderer?.navigationEndpoint?.browseEndpoint?.browseId || ''
    )
  );
  sec.items.splice(
    home >= 0 ? home + 1 : 1,
    0,
    ...PAGES.map(([k, t, icon]) => guideEntry(k, t, icon))
  );
}

/** Adds "❤ add channel to favourites" to every card's long-press menu that has a "go to channel" item. */
function addFavItems(o, depth = 0) {
  if (!o || typeof o !== 'object' || depth > 40) return;
  if (Array.isArray(o)) {
    for (const v of o) addFavItems(v, depth + 1);
    return;
  }
  const smc = o.showMenuCommand;
  const items = smc?.menu?.menuRenderer?.items;
  if (
    Array.isArray(items) &&
    !items.some(
      (i) => i.menuNavigationItemRenderer?.navigationEndpoint?.ytlgCommand
    )
  ) {
    let ch = '';
    for (const mi of items) {
      const b =
        mi.menuNavigationItemRenderer?.navigationEndpoint?.browseEndpoint
          ?.browseId;
      if (b && b.startsWith('UC')) {
        ch = b;
        break;
      }
    }
    if (ch) {
      const name = smc.subtitle?.simpleText || '';
      items.push({
        menuNavigationItemRenderer: {
          text: {
            runs: [
              {
                text: isFav(ch)
                  ? '💔 إزالة القناة من المفضلة'
                  : '❤ إضافة القناة للمفضلة'
              }
            ]
          },
          navigationEndpoint: {
            ytlgCommand: { action: 'favorite', channelId: ch, name }
          }
        }
      });
    }
  }
  for (const k in o) {
    if (k !== 'showMenuCommand') addFavItems(o[k], depth + 1);
  }
}

// the playing video's channel (for the ❤ button in YouTube's player bar)
const channelOf = new Map(); // videoId -> { channelId, name }
let lastVideo = '';
function currentChannel() {
  const v = (location.hash.match(/[?&]v=([\w-]{11})/) || [])[1] || lastVideo;
  return channelOf.get(v) || null;
}

JSON.parse = function (...args) {
  const r = origParse.apply(this, args);
  try {
    if (r && typeof r === 'object') {
      if (r.items?.[0]?.guideSectionRenderer) addGuide(r);
      const d = r.videoDetails;
      if (d?.videoId && d.channelId) {
        channelOf.set(d.videoId, {
          channelId: d.channelId,
          name: d.author || ''
        });
        lastVideo = d.videoId;
      }
      if (d?.videoId && d.channelId)
        history.add({
          id: d.videoId,
          title: d.title,
          sub: d.author,
          channelId: d.channelId
        });
      if (r.contents?.tvBrowseRenderer) sortChannelPage(r);
      if (r.contents || r.onResponseReceivedActions || r.continuationContents)
        addFavItems(r);
    }
  } catch (e) {
    console.warn('[ytlg] json hook', e);
  }
  return r;
};

// ---------------------------------------------------------------- our commands (from the card menus)
ResolveCommandRegistry.getInstance().then((reg) => {
  reg.setHook('ytlgCommand', (_orig, payload) => {
    let c = /** @type {any} */ (payload).ytlgCommand || {};
    if (c.action === 'favoriteCurrent') {
      const ch = currentChannel();
      if (!ch) {
        toast('تعذّر معرفة قناة هذا الفيديو');
        return undefined;
      }
      // a copy: the button keeps the same command object for every press
      c = { action: 'favorite', channelId: ch.channelId, name: ch.name };
    }
    if (c.action === 'favorite' && c.channelId) {
      const on = favorites.toggle(c.channelId, c.name);
      toast(
        on
          ? `❤ أُضيفت ${c.name || 'القناة'} إلى المفضلة`
          : `أُزيلت ${c.name || 'القناة'} من المفضلة`,
        3000
      );
    }
    return undefined;
  });
});

installPlayerButton(currentChannel, (id) => favorites.has(id));

console.info('[ytlg] features loaded:', PAGES.length, 'pages');
