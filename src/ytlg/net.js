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

/** Remembers the TV app's context + identity headers from one of its requests; returns the parsed body. */
function remember(body, hdrs) {
  try {
    const j = JSON.parse(body);
    if (j?.context?.client) {
      ctx = j.context;
      const keep = {};
      const add = (v, k) => {
        if (/^x-(youtube|goog)-/i.test(k) && !/authuser|pageid/i.test(k))
          keep[k] = v;
      };
      if (hdrs instanceof Headers) hdrs.forEach(add);
      else for (const k in hdrs || {}) add(hdrs[k], k);
      headers = keep;
      while (ctxWaiters.length) ctxWaiters.shift()(ctx);
    }
    return j;
  } catch {
    return null;
  }
}

const inflight = new Map(); // browseId -> promise: the TV app may ask again while a page is still being built

function build(id, j) {
  if (inflight.has(id)) return inflight.get(id);
  const p = (async () => {
    try {
      return await pages.get(id)(j);
    } catch (e) {
      console.warn('[ytlg] page failed', id, e);
      return errorPage(e?.message || String(e));
    } finally {
      setTimeout(() => inflight.delete(id), 0);
    }
  })();
  inflight.set(id, p);
  return p;
}

const isOurPage = (url, j) =>
  !!(j?.browseId && pages.has(j.browseId) && url.includes(API + 'browse'));

// ---- fetch (outermost wrapper)
const origFetch = window.fetch.bind(window);
window.fetch = async (resource, init) => {
  const url = resource instanceof Request ? resource.url : String(resource);
  if (url.includes(API)) {
    const body = await bodyOf(resource, init);
    const j = body
      ? remember(
          body,
          (resource instanceof Request && resource.headers) ||
            init?.headers ||
            {}
        )
      : null;
    if (isOurPage(url, j)) {
      return new Response(JSON.stringify(await build(j.browseId, j)), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }
  }
  return origFetch(resource, init);
};

// ---- XMLHttpRequest (what YouTube's TV app actually uses for InnerTube)
const XHR = XMLHttpRequest.prototype;
const xOpen = XHR.open;
const xSend = XHR.send;
const xHeader = XHR.setRequestHeader;
XHR.open = function (method, url, ...rest) {
  this.__ytlg = { url: String(url), headers: {} };
  return xOpen.call(this, method, url, ...rest);
};
XHR.setRequestHeader = function (k, v) {
  if (this.__ytlg) this.__ytlg.headers[k] = v;
  return xHeader.call(this, k, v);
};
XHR.send = function (body) {
  const m = this.__ytlg;
  if (m && m.url.includes(API) && typeof body === 'string') {
    const j = remember(body, m.headers);
    if (isOurPage(m.url, j)) {
      answerXhr(this, m.url, j);
      return undefined;
    }
  }
  return xSend.call(this, body);
};

/** Completes an XHR with our page instead of sending it (same events and fields a real response has). */
function answerXhr(xhr, url, j) {
  build(j.browseId, j).then((obj) => {
    const text = JSON.stringify(obj);
    const def = (k, v) =>
      Object.defineProperty(xhr, k, { configurable: true, get: () => v });
    def('readyState', 4);
    def('status', 200);
    def('statusText', 'OK');
    def('responseURL', new URL(url, location.href).href);
    def('responseText', text);
    def('response', xhr.responseType === 'json' ? JSON.parse(text) : text);
    xhr.getAllResponseHeaders = () =>
      'content-type: application/json; charset=utf-8\r\n';
    xhr.getResponseHeader = (n) =>
      /^content-type$/i.test(n) ? 'application/json; charset=utf-8' : null;
    for (const ev of ['readystatechange', 'load', 'loadend'])
      xhr.dispatchEvent(new Event(ev));
  });
}

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
