// Network layer: (1) answers YouTube's TV app when it asks for one of OUR pages (browseId "FEytlg_…"), and
// (2) makes InnerTube requests with the TV app's own identity (context + headers copied from its requests),
// so our searches look exactly like the app's own.
import { gate } from './util.js';

const API = '/youtubei/v1/';
let ctx = null; // the TV app's InnerTube context (client, visitorData, …)
let headers = {}; // its request headers (client name/version, visitor id)
const ctxWaiters = [];
const pages = new Map(); // browseId -> async () => response JSON

/** Registers one of our pages: when the TV app browses `browseId`, `build()` provides the response. */
export function definePage(browseId, build) {
  pages.set(browseId, build);
}

async function bodyOf(resource, init) {
  try {
    if (init && typeof init.body === 'string') return init.body;
    if (resource instanceof Request) return await resource.clone().text();
  } catch {
    /* unreadable */
  }
  return null;
}

function remember(body, resource, init) {
  try {
    const j = JSON.parse(body);
    if (j?.context?.client) {
      ctx = j.context;
      const h = new Headers(
        (resource instanceof Request && resource.headers) || init?.headers || {}
      );
      const keep = {};
      h.forEach((v, k) => {
        if (/^x-(youtube|goog)-/i.test(k) && !/authuser|pageid/i.test(k))
          keep[k] = v;
      });
      headers = keep;
      while (ctxWaiters.length) ctxWaiters.shift()(ctx);
    }
    return j;
  } catch {
    return null;
  }
}

const json = (obj) =>
  new Response(JSON.stringify(obj), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });

// Outermost fetch wrapper (installed after AdFree's FetchRegistry, so it runs first).
const origFetch = window.fetch.bind(window);
window.fetch = async (resource, init) => {
  const url = resource instanceof Request ? resource.url : String(resource);
  if (url.includes(API)) {
    const body = await bodyOf(resource, init);
    const j = body ? remember(body, resource, init) : null;
    const id = j?.browseId;
    if (id && pages.has(id) && url.includes(API + 'browse')) {
      try {
        return json(await pages.get(id)(j));
      } catch (e) {
        console.warn('[ytlg] page failed', id, e);
        return json(errorPage(e?.message || String(e)));
      }
    }
  }
  return origFetch(resource, init);
};

/** The TV app's context (waits for its first request). */
export function context() {
  if (ctx) return Promise.resolve(ctx);
  const fromCfg = window.ytcfg?.get?.('INNERTUBE_CONTEXT');
  if (fromCfg?.client) {
    ctx = fromCfg;
    return Promise.resolve(ctx);
  }
  return new Promise((ok) => {
    ctxWaiters.push(ok);
    setTimeout(() => ok(ctx), 15000);
  });
}

/**
 * InnerTube request in the TV app's identity. opts: { gl, hl, safe } override region / language and turn on
 * Restricted Mode (filters mature content). Searches are paced by the shared gate.
 */
export async function api(endpoint, body, opts = {}) {
  const base = await context();
  if (!base) throw new Error('YouTube context not ready');
  const c = JSON.parse(JSON.stringify(base));
  if (opts.gl) c.client.gl = opts.gl;
  if (opts.hl) c.client.hl = opts.hl;
  if (opts.safe) c.user = { ...(c.user || {}), enableSafetyMode: true };
  const run = async () => {
    const r = await origFetch(`${API}${endpoint}?prettyPrint=false`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ context: c, ...body })
    });
    if (!r.ok) throw new Error(`${endpoint} ${r.status}`);
    return r.json();
  };
  return endpoint === 'search' ? gate(run) : run();
}

/** RSS feed of a playlist (exact publish times). query like "playlist_id=UULF…". */
export async function rssFeed(query) {
  const res = await origFetch(`/feeds/videos.xml?${query}`);
  if (!res.ok) throw new Error('rss ' + res.status);
  const xml = await res.text();
  const tag = (e, t) =>
    (e.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1] || '';
  const un = (x) =>
    x
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  const entries = [];
  for (const e of xml.match(/<entry>[\s\S]*?<\/entry>/g) || []) {
    const id = tag(e, 'yt:videoId');
    const at = Date.parse(tag(e, 'published'));
    if (!id || !at || /\/shorts\//.test(e)) continue;
    entries.push({
      type: 'video',
      id,
      title: un(tag(e, 'title')),
      sub: un(tag(tag(e, 'author'), 'name')),
      publishedAt: at,
      meta: '',
      thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      duration: ''
    });
  }
  const head = xml.split('<entry>')[0];
  return {
    owner: un(tag(tag(head, 'author'), 'name')) || entries[0]?.sub || '',
    entries
  };
}

/** A channel's latest long-form uploads (UULF playlist = uploads without Shorts), exact times. */
export async function channelRss(channelId) {
  const { entries } = await rssFeed(`playlist_id=UULF${channelId.slice(2)}`);
  return entries.map((e) => ({ ...e, channelId }));
}

/** A page that shows a message (used when building one of our pages fails). */
export function errorPage(msg) {
  return {
    responseContext: {},
    contents: {
      tvBrowseRenderer: {
        content: {
          tvSurfaceContentRenderer: {
            content: {
              sectionListRenderer: {
                contents: [
                  {
                    shelfRenderer: {
                      headerRenderer: {
                        shelfHeaderRenderer: {
                          avatarLockup: {
                            avatarLockupRenderer: {
                              title: {
                                simpleText:
                                  'تعذّر التحميل: ' + msg + ' — حاول لاحقًا'
                              },
                              size: 'AVATAR_LOCKUP_SIZE_SMALL'
                            }
                          }
                        }
                      },
                      content: { horizontalListRenderer: { items: [] } }
                    }
                  }
                ]
              }
            }
          }
        }
      }
    }
  };
}
