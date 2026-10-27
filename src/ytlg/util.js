// Shared helpers for our pages: storage, dates, request pacing.

// ---------------------------------------------------------------- storage (localStorage, prefix "ytlg.")
export function read(key, fallback) {
  try {
    const v = localStorage.getItem('ytlg.' + key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
export function write(key, value) {
  try {
    localStorage.setItem('ytlg.' + key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable */
  }
}

/** Channels the viewer hearted: [{ channelId, name }] */
export const favorites = {
  list: () => read('favorites', []),
  has: (id) => !!id && read('favorites', []).some((c) => c.channelId === id),
  toggle(id, name) {
    if (!id) return false;
    const l = read('favorites', []);
    const on = l.some((c) => c.channelId === id);
    write(
      'favorites',
      on
        ? l.filter((c) => c.channelId !== id)
        : [{ channelId: id, name: name || '' }, ...l]
    );
    return !on;
  }
};

/** Videos the viewer played (newest first), with their channel: feeds "الجديد" and is left out of Explore. */
export const history = {
  list: () => read('history', []),
  add(item) {
    if (!item?.id) return;
    const l = read('history', []).filter((i) => i.id !== item.id);
    l.unshift({
      id: item.id,
      title: item.title || '',
      sub: item.sub || '',
      channelId: item.channelId || '',
      at: Date.now()
    });
    write('history', l.slice(0, 200));
  },
  clear: () => write('history', []),
  channels() {
    const seen = new Set();
    const out = [];
    for (const i of read('history', [])) {
      if (!i.channelId || seen.has(i.channelId)) continue;
      seen.add(i.channelId);
      out.push({ channelId: i.channelId, name: i.sub || '' });
    }
    return out;
  }
};

/** Cached results with an expiry (localStorage, survives app restarts). */
export function cached(key, ttlMs) {
  const hit = read('cache.' + key, null);
  return hit && Date.now() - hit.at < ttlMs ? hit.v : null;
}
export function cache(key, v) {
  write('cache.' + key, { at: Date.now(), v });
}

// ---------------------------------------------------------------- dates

/** Age in seconds from a relative date text ("منذ 3 ساعات", "قبل يومين", "2 days ago"). Unknown -> very old. */
export function ageOf(meta) {
  const t = String(meta || '').replace(/[٠-٩]/g, (d) =>
    String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))
  );
  const units = [
    [/ثاني|second/, 1],
    [/دقيق|دقائق|minute/, 60],
    [/ساع|hour/, 3600],
    [/يوم|أيام|ايام|day/, 86400],
    [/أسبوع|اسبوع|أسابيع|اسابيع|week/, 604800],
    [/شهر|أشهر|اشهر|month/, 2592000],
    [/سن|عام|أعوام|year/, 31536000]
  ];
  for (const [re, sec] of units) {
    const m = t.match(new RegExp('(?:(\\d+)\\s*)?(' + re.source + ')[^\\s•]*'));
    if (!m) continue;
    let n = m[1] ? Number(m[1]) : 1;
    if (
      !m[1] &&
      /(ين|ان)$/.test(m[0]) &&
      !/ثواني|دقائق|أيام|ايام|ساعات/.test(m[0])
    )
      n = 2; // dual: يومين، ساعتين
    return n * sec;
  }
  return 1e12;
}

/** Age of an item in seconds: exact publish time when known (RSS), else parsed from its date text. */
export function itemAge(it) {
  if (it.publishedAt) return Math.max(0, (Date.now() - it.publishedAt) / 1000);
  const m = ageOf(it.meta);
  return m < 1e12 ? m : ageOf(it.sub);
}

/** "منذ 3 ساعات"-style text from seconds. */
export function relTime(sec) {
  const u = [
    [31536000, 'سنة', 'سنوات'],
    [2592000, 'شهر', 'أشهر'],
    [604800, 'أسبوع', 'أسابيع'],
    [86400, 'يوم', 'أيام'],
    [3600, 'ساعة', 'ساعات'],
    [60, 'دقيقة', 'دقائق']
  ];
  for (const [n, one, many] of u) {
    const k = Math.floor(sec / n);
    if (k >= 1) {
      if (k === 1) return 'منذ ' + one;
      if (k === 2)
        return (
          'منذ ' +
          ({ سنة: 'سنتين', ساعة: 'ساعتين', دقيقة: 'دقيقتين' }[one] ||
            one + 'ين')
        );
      return 'منذ ' + k + ' ' + (k <= 10 ? many : one);
    }
  }
  return 'الآن';
}

// ---------------------------------------------------------------- pacing

/**
 * All our searches go through this gate: at most 2 at a time, >= 0.4 s apart. YouTube treats bursts of
 * searches as a bot and starts asking the whole connection to sign in.
 */
export const gate = (() => {
  let active = 0;
  let last = 0;
  const queue = [];
  const pump = () => {
    if (active >= 2 || !queue.length) return;
    const wait = Math.max(0, last + 400 - Date.now());
    if (wait) {
      setTimeout(pump, wait);
      return;
    }
    const job = queue.shift();
    active++;
    last = Date.now();
    job
      .fn()
      .then(job.ok, job.bad)
      .finally(() => {
        active--;
        pump();
      });
    pump();
  };
  return (fn) =>
    new Promise((ok, bad) => {
      queue.push({ fn, ok, bad });
      pump();
    });
})();

/** runs async jobs with a concurrency limit */
export async function pool(items, limit, fn) {
  const out = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        try {
          out[k] = await fn(items[k]);
        } catch {
          out[k] = null;
        }
      }
    })
  );
  return out;
}

export const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
