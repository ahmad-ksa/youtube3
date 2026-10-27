// Channel pages newest -> oldest: when YouTube's TV app opens a channel, its "Videos" row (the channel's
// uploads, newest first) moves to the top and the videos inside every row are sorted by upload date.
import { ageOf } from './util.js';

const AGE_TEXT = /(?:^|\s)(?:قبل|منذ)\s|\bago\b/i;
const TITLE_KEYS = new Set(['title', 'accessibility', 'accessibilityData']);

/** Upload age (seconds) of one card: from its "قبل 3 أيام" / "3 days ago" line; unknown = Infinity. */
function cardAge(card) {
  let found = null;
  const walk = (o, depth) => {
    if (found || depth > 12 || !o || typeof o !== 'object') return;
    for (const k in o) {
      if (TITLE_KEYS.has(k)) continue;
      const v = o[k];
      if (typeof v === 'string') {
        if (
          (k === 'text' || k === 'content' || k === 'simpleText') &&
          AGE_TEXT.test(v)
        ) {
          found = v;
          return;
        }
      } else walk(v, depth + 1);
      if (found) return;
    }
  };
  walk(card, 0);
  const a = found ? ageOf(found) : 1e12;
  return a < 1e12 ? a : Infinity;
}

const textOf = (t) =>
  t?.simpleText || (t?.runs || []).map((r) => r.text).join('') || '';

function shelfTitle(shelf) {
  const h = shelf.headerRenderer?.shelfHeaderRenderer || {};
  return textOf(h.title || h.avatarLockup?.avatarLockupRenderer?.title).trim();
}

/** Sorts a list of cards newest first (stable: cards without a date keep their place at the end). */
function sortCards(items) {
  if (!Array.isArray(items) || items.length < 2) return;
  const keyed = items.map((it, i) => ({ it, i, age: cardAge(it) }));
  if (!keyed.some((k) => k.age !== Infinity)) return;
  keyed.sort((a, b) => a.age - b.age || a.i - b.i);
  keyed.forEach((k, i) => {
    items[i] = k.it;
  });
}

/** Is this InnerTube response a channel page? */
function isChannel(r) {
  const tv = r?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer;
  return !!(
    tv?.header?.channelHeaderRenderer ||
    r?.header?.channelHeaderRenderer ||
    r?.header?.c4TabbedHeaderRenderer ||
    r?.metadata?.channelMetadataRenderer
  );
}

export function sortChannelPage(r) {
  if (!isChannel(r)) return false;
  const tv = r.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer;
  const content = tv?.content || {};
  const sections = content.sectionListRenderer?.contents;
  if (Array.isArray(sections)) {
    for (const s of sections) {
      const shelf = s.shelfRenderer;
      sortCards(shelf?.content?.horizontalListRenderer?.items);
      sortCards(shelf?.content?.gridRenderer?.items);
    }
    // the channel's uploads row ("الفيديوهات" / "Videos") first
    const i = sections.findIndex((s) => {
      const shelf = s.shelfRenderer;
      return (
        shelf &&
        /^(الفيديوهات|فيديوهات|videos|uploads)$/i.test(shelfTitle(shelf)) &&
        shelf.endpoint?.browseEndpoint?.browseId?.startsWith('UC')
      );
    });
    if (i > 0) sections.unshift(sections.splice(i, 1)[0]);
  }
  sortCards(content.gridRenderer?.items);
  return true;
}
