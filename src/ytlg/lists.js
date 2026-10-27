// Our lists for YouTube's TV interface: Explore / Trending (world, Arab, Saudi, Gulf), music, favourites, new.
// Same queries, filters and region logic as youtube2 (tested there); searches go out in the TV app's own
// identity with Restricted Mode on and are paced by the shared gate. Every list is sorted newest -> oldest.
import { api, channelRss, rssFeed } from './net.js';
import { extract } from './extract.js';
import {
  favorites,
  history,
  itemAge,
  relTime,
  pool,
  shuffle,
  cached,
  cache,
  read,
  write
} from './util.js';

const DAY = 86400;

// search "sp" params (protobuf): sort 3 = view count; upload filter 2 = today, 3 = week, 4 = month; type 1 = video
const SP = {
  relevance: { today: 'EgQIAhAB', week: 'EgQIAxAB', month: 'EgQIBBAB' },
  views: { today: 'CAMSBAgCEAE=', week: 'CAMSBAgDEAE=', month: 'CAMSBAgEEAE=' }
};

// Successive age windows: each batch only keeps videos older than the previous one, so appending batches
// keeps the whole list sorted newest -> oldest.
const WINDOWS = [
  { sp: 'today', min: 0, max: DAY },
  { sp: 'week', min: DAY, max: 7 * DAY },
  { sp: 'month', min: 7 * DAY, max: 31 * DAY }
];

// ---------------------------------------------------------------- query pools

// Europe, Americas, Russia, Korea (English, French, German, Spanish, Italian, Portuguese, Dutch, Polish,
// Swedish, Russian, Korean)
const WORLD_EXPLORE = [
  'documentary',
  'cooking',
  'street food',
  'travel vlog',
  'tech review',
  'science experiment',
  'space',
  'history',
  'comedy sketch',
  'car review',
  'DIY',
  'woodworking',
  'restoration',
  'nature',
  'wildlife',
  'live session',
  'interview',
  'podcast',
  'challenge',
  'gaming',
  'speedrun',
  'animation',
  'short film',
  'magic trick',
  'drawing',
  'workout',
  'architecture',
  'engineering',
  'chess',
  'football',
  'NBA',
  'NFL',
  'fishing',
  'camping',
  'van life',
  'recette',
  'voyage',
  'documentaire',
  'humour',
  'Rezept',
  'Reise',
  'Doku',
  'receta',
  'viaje',
  'documental',
  'ricetta',
  'viaggio',
  'receita',
  'viagem',
  'reis',
  'podróż',
  'resa',
  'рецепт',
  'путешествие',
  'документальный',
  'обзор',
  'юмор',
  'наука',
  '요리',
  '여행',
  '브이로그',
  '리뷰',
  '예능',
  '과학'
];
// Every Arab country, plus subjects (Arabic only)
const ARAB_EXPLORE = [
  'السعودية',
  'مصر',
  'الإمارات',
  'الكويت',
  'قطر',
  'البحرين',
  'عمان',
  'اليمن',
  'العراق',
  'سوريا',
  'لبنان',
  'الأردن',
  'فلسطين',
  'المغرب',
  'الجزائر',
  'تونس',
  'ليبيا',
  'السودان',
  'موريتانيا',
  'الصومال',
  'جيبوتي',
  'جزر القمر',
  'وثائقي',
  'طبخ',
  'أكلات شعبية',
  'سفر',
  'رحلة',
  'تقنية',
  'مراجعة',
  'علوم',
  'تاريخ',
  'قصة',
  'كوميديا',
  'مقالب',
  'سيارات',
  'تعليم',
  'بودكاست',
  'تحدي',
  'حيوانات',
  'طبيعة',
  'صحراء',
  'تراث',
  'فن',
  'خط عربي',
  'شعر',
  'إنشاد',
  'كرة القدم',
  'رياضة',
  'لياقة',
  'اقتصاد',
  'برمجة',
  'ألعاب',
  'مطاعم',
  'زراعة',
  'بناء',
  'رمضان',
  'سوالف',
  'فلوق'
];
// Broad, high-traffic subjects for "most watched now"
const WORLD_TREND = [
  'music video',
  'official video',
  'trailer',
  'news',
  'football',
  'highlights',
  'gaming',
  'podcast',
  'comedy',
  'challenge',
  'review',
  'vlog',
  'reaction',
  'interview',
  'documentary',
  'clip officiel',
  'canción',
  'клип',
  'новости',
  '뮤직비디오',
  'MV'
];
// songs only, many languages and styles (most-watched music worldwide)
const MUSIC_TREND = [
  'official music video',
  'music video',
  'official audio',
  'lyric video',
  'new song',
  'MV',
  'kpop MV',
  'pop song',
  'hip hop',
  'rap song',
  'reggaeton',
  'rock song',
  'EDM',
  'country song',
  'video oficial',
  'clip officiel',
  'клип',
  'фит',
  'Musikvideo',
  '뮤직비디오',
  'live performance'
];
const ARAB_TREND = [
  'فيديو كليب',
  'أغنية',
  'اخبار',
  'عاجل',
  'مباراة',
  'ملخص',
  'أهداف',
  'برنامج',
  'مسلسل',
  'حلقة',
  'بودكاست',
  'تحدي',
  'مقلب',
  'فلوق',
  'ردة فعل',
  'مقابلة',
  'كوميدي',
  'شيلة',
  'مهرجان',
  'السعودية',
  'مصر',
  'المغرب'
];

// Saudi Arabia: cities, football, food, culture, desert life, entertainment
const SAUDI_EXPLORE = [
  'الرياض',
  'جدة',
  'الدمام',
  'الخبر',
  'مكة',
  'المدينة المنورة',
  'أبها',
  'الطائف',
  'القصيم',
  'حائل',
  'تبوك',
  'العلا',
  'نيوم',
  'موسم الرياض',
  'فلوق سعودي',
  'طبخ سعودي',
  'كبسة',
  'مندي',
  'قهوة سعودية',
  'كشتة',
  'رحلة برية',
  'تطعيس',
  'مقناص',
  'هجن',
  'خيل',
  'سيارات سعودية',
  'سوالف',
  'قصة سعودية',
  'بودكاست سعودي',
  'مسلسل سعودي',
  'كوميديا سعودية',
  'دوري روشن',
  'تقنية سعودي',
  'مطاعم الرياض',
  'تراث سعودي',
  'العرضة السعودية',
  'تحدي سعودي',
  'مخيم'
];
const SAUDI_TREND = [
  'السعودية',
  'سعودي',
  'الرياض',
  'جدة',
  'دوري روشن',
  'الهلال',
  'النصر',
  'الاتحاد',
  'الأهلي',
  'شيلة',
  'موسم الرياض',
  'مسلسل سعودي',
  'بودكاست سعودي',
  'سنابات',
  'فلوق سعودي',
  'ملخص مباراة',
  'أخبار السعودية',
  'عاجل السعودية',
  'برنامج سعودي'
];
// Gulf: the six GCC countries
const GULF_EXPLORE = [
  'الرياض',
  'جدة',
  'فلوق سعودي',
  'كبسة',
  'كشتة',
  'الكويت',
  'فلوق كويتي',
  'مطاعم الكويت',
  'الدوحة',
  'قطر',
  'دبي',
  'أبوظبي',
  'الشارقة',
  'فلوق إماراتي',
  'البحرين',
  'المنامة',
  'مسقط',
  'صلالة',
  'سلطنة عمان سياحة',
  'طبخ خليجي',
  'مجبوس',
  'مسلسل خليجي',
  'غوص',
  'صيد سمك',
  'برية',
  'تراث خليجي',
  'سيارات',
  'سوالف خليجية',
  'بودكاست خليجي',
  'مخيم',
  'هجن'
];
const GULF_TREND = [
  'السعودية',
  'الكويت',
  'قطر',
  'الإمارات',
  'دبي',
  'البحرين',
  'سلطنة عمان',
  'خليجي',
  'مسلسل خليجي',
  'شيلة',
  'دوري روشن',
  'دوري نجوم قطر',
  'الدوري الإماراتي',
  'الدوري الكويتي',
  'أخبار الخليج',
  'عاجل',
  'ملخص مباراة',
  'فلوق',
  'بودكاست خليجي',
  'كليب خليجي'
];
const GULF_SESSIONS = ['gl:SA', 'gl:AE', 'gl:KW', 'gl:QA', 'gl:BH', 'gl:OM'];
// world trending / world songs: searched as viewers in Europe, the Americas and Korea (English interface)
const WEST_SESSIONS = [
  'w:US',
  'w:GB',
  'w:CA',
  'w:DE',
  'w:FR',
  'w:ES',
  'w:IT',
  'w:NL',
  'w:BR',
  'w:MX',
  'w:KR'
];

// Egypt: cities, football, food, cinema / series, daily life
const EGYPT_EXPLORE = [
  'مصر',
  'القاهرة',
  'الإسكندرية',
  'الأقصر',
  'أسوان',
  'الغردقة',
  'شرم الشيخ',
  'الصعيد',
  'أكل مصري',
  'أكل شارع مصري',
  'مطبخ مصري',
  'فلوق مصري',
  'يوميات مصرية',
  'الدوري المصري',
  'الأهلي',
  'الزمالك',
  'مسلسل مصري',
  'فيلم مصري',
  'برنامج مصري',
  'كوميديا مصرية',
  'سوالف مصرية',
  'مقلب مصري',
  'ستاند اب مصري',
  'وسط البلد',
  'خان الخليلي',
  'النيل',
  'الأهرامات',
  'سيارات مصر',
  'أسعار مصر',
  'تجربة مطعم مصري'
];

// travel: the newest Arabic travel videos (trips, tours, hotels, places)
const TRAVEL = [
  'سياحة',
  'رحلة',
  'رحلتي إلى',
  'جولة في',
  'فلوق سفر',
  'السفر',
  'أماكن سياحية',
  'تجربة فندق',
  'منتجع',
  'سياحة في تركيا',
  'سياحة في أوروبا',
  'سياحة في السعودية',
  'سياحة في مصر',
  'سياحة في دبي',
  'سياحة في جورجيا',
  'سياحة في أذربيجان',
  'سياحة في ماليزيا',
  'سياحة في إندونيسيا',
  'سياحة في تايلند',
  'سياحة في المالديف',
  'سياحة في سويسرا',
  'سياحة في إيطاليا',
  'سياحة في إسبانيا',
  'سياحة في لندن',
  'سياحة في باريس',
  'سياحة في اليابان',
  'سياحة في كوريا',
  'سياحة في أمريكا',
  'العلا',
  'أبها',
  'رحلة برية',
  'كشتة',
  'تخييم',
  'رحلة بحرية',
  'طيران تجربة'
];

// whole-word place / nationality markers (with or without "ال", and nisba endings: سعودي، سعودية، سعوديين…)
const W = (words) =>
  new RegExp(
    `(?:^|[\\s\\p{P}\\p{S}])(?:ال)?(?:${words})(?:ي|ية|يه|يين|يون)?(?=$|[\\s\\p{P}\\p{S}])`,
    'u'
  );
const SAUDI_MARK = W(
  'سعود|رياض|جدة|جده|دمام|خبر|مكة|مكه|المدينة المنورة|أبها|ابها|طائف|قصيم|حائل|تبوك|علا|نيوم|هلال|نصر|اتحاد|أهلي|اهلي|روشن|نجد|حجاز'
);
// bare "عمان" is left out on purpose: it is also Amman (Jordan); Omani videos say سلطنة عمان / عماني / مسقط / صلالة
const GULF_OTHER = W(
  'كويت|قطر|إمارات|امارات|دبي|أبوظبي|ابوظبي|شارقة|شارقه|بحرين|منامة|سلطنة عمان|عماني|مسقط|صلالة|دوحة|دوحه'
);
const NON_GULF = W(
  'مصر|قاهرة|قاهره|إسكندرية|اسكندرية|مغرب|جزائر|تونس|ليبيا|ليب|عراق|بغداد|سوريا|سوري|شام|دمشق|حلب|لبنان|بيروت|أردن|اردن|فلسطين|غزة|غزه|سودان|يمن|صنعاء|موريتاني|صومال'
);

const EGYPT_MARK = W(
  'مصر|قاهرة|قاهره|إسكندرية|اسكندرية|اسكندريه|جيزة|جيزه|أقصر|اقصر|أسوان|اسوان|صعيد|غردقة|غردقه|شرم الشيخ|بورسعيد|منصورة|منصوره|طنطا|زقازيق|زمالك|بيراميدز|إسماعيلي|اسماعيلي|نيل|أهرامات|اهرامات|خليلي|مصرى'
);
const NON_EGYPT = W(
  'سعود|رياض|جدة|جده|دمام|مكة|مكه|أبها|ابها|قصيم|حائل|تبوك|نجد|حجاز|روشن|كويت|قطر|إمارات|امارات|دبي|أبوظبي|ابوظبي|بحرين|سلطنة عمان|عماني|مسقط|مغرب|جزائر|تونس|ليبيا|عراق|بغداد|سوريا|شام|دمشق|لبنان|بيروت|أردن|اردن|فلسطين|غزة|غزه|يمن|صنعاء|خليج'
);

// ---------------------------------------------------------------- filters

const ARABIC = /[؀-ۿ]/;
// letters used by Urdu / Persian but not by Arabic (keeps Pakistani / Iranian titles out of the Arab lists)
const URDU_PERSIAN = /[ٹڈڑںھہےیکگپچژ]/;
// Indic scripts, Tagalog/Filipino and South-Asian markers (for "Explore the World")
const SOUTH_ASIA_SCRIPT = /[ऀ-෿]/; // Devanagari, Bengali, Gurmukhi, Gujarati, Oriya, Tamil, Telugu, Kannada, Malayalam, Sinhala
const SOUTH_ASIA_WORDS =
  /\b(hindi|bollywood|tollywood|tamil|telugu|punjabi|bhojpuri|marathi|kannada|malayalam|bangla|bengali|bangladesh|urdu|desi|india|indian|pakistan|pakistani|lahore|karachi|islamabad|mumbai|delhi|hyderabad|kolkata|nepal|nepali|sri lanka|pinoy|filipino|filipina|tagalog|philippines|manila|ofw|kapuso|kapamilya|teleserye|abs-cbn|gma)\b/i;
// "world" lists are Europe, the Americas and Korea only: no other scripts (Hebrew, Arabic, Indic, Thai, Lao,
// Myanmar, Khmer, Japanese kana, Chinese), no Vietnamese, and no South / South-East Asian or African markers
const NON_WEST_SCRIPT =
  /[\u0590-\u08FF\u0900-\u0DFF\u0E00-\u0EFF\u1000-\u109F\u1780-\u17FF\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF]/;
const VIETNAMESE = /[ăđơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i;
const NON_WEST_WORDS =
  /\b(indonesia|indonesian|jakarta|malaysia|malay|vietnam|viet|thailand|thai|cambodia|myanmar|lagu|terbaru|sinetron|dangdut|resmi|bahasa|nigeria|nigerian|naija|afrobeats?|ghana|kenya|amapiano|china|chinese|japan|japanese|anime|pptv|thairath|workpoint|one31|gmmtv|vtv|abp|aaj tak|ndtv|zee|sony sab|colors tv|star plus)\b/i;
// romanized Hindi / Urdu / Tagalog / Indonesian words, Indian and Pakistani surnames and big South-Asian labels
const ROMANIZED_SOUTH =
  /\b(hai|hain|tum|tera|teri|mera|meri|mujhe|tujhe|pyar|pyaar|ishq|zindagi|sanam|yaar|bhai|bhaiya|nahi|nahin|kya|kaise|gaana|gana|bhajan|shayari|naat|qawwali|ghazal|singh|kaur|sharma|verma|gupta|yadav|reddy|chauhan|thakur|mishra|pandey|tiwari|arijit|kakkar|badshah|diljit|t-series|tseries|saregama|zee music|yrf|shemaroo|goldmines|aditya music|lahari|desi music|speed records|ary digital|har pal geo|hum tv|mga|naman|talaga|kasi|yang|untuk|dengan|nggak|banget|kocak)\b/i;
const isWest = (it) => {
  const t = `${it.title} ${it.sub}`;
  return (
    !ARABIC.test(t) &&
    !NON_WEST_SCRIPT.test(t) &&
    !VIETNAMESE.test(t) &&
    !SOUTH_ASIA_WORDS.test(t) &&
    !ROMANIZED_SOUTH.test(t) &&
    !NON_WEST_WORDS.test(t)
  );
};
// sexual / adult content (titles or channel names), several languages; Restricted Mode is the main filter
const ADULT =
  /\b(sex|sexy|porn|nsfw|nude|naked|erotic|onlyfans|18\+|xxx|hot girl|bikini try|lingerie|strip|секс|эрот|порно|섹시|노출|야한)\b|سكس|إباح|اباح|عاري|جنس|مثيرة?\s|بدون ملابس/i;

export const isAdult = (it) => ADULT.test(`${it.title} ${it.sub}`);
const RULES = {
  world: (it) => !isAdult(it) && isWest(it),
  arab: (it) =>
    !isAdult(it) &&
    ARABIC.test(it.title) &&
    !URDU_PERSIAN.test(it.title) &&
    !SOUTH_ASIA_SCRIPT.test(it.title),
  worldTrend: (it) => !isAdult(it) && isWest(it),
  // Egypt: Arabic; kept when it names Egypt, dropped when it points to another Arab country
  egypt: (it) => {
    if (!RULES.arab(it)) return false;
    const t = `${it.title} ${it.sub}`;
    return EGYPT_MARK.test(t) || !NON_EGYPT.test(t);
  },
  // Saudi lists: Arabic; kept when it names Saudi places / clubs, dropped when it points to another country
  saudi: (it) => {
    if (!RULES.arab(it)) return false;
    const t = `${it.title} ${it.sub}`;
    return SAUDI_MARK.test(t) || (!GULF_OTHER.test(t) && !NON_GULF.test(t));
  },
  // Gulf lists: Arabic; kept when it names a Gulf country / place, dropped when it points outside the Gulf
  gulf: (it) => {
    if (!RULES.arab(it)) return false;
    const t = `${it.title} ${it.sub}`;
    return SAUDI_MARK.test(t) || GULF_OTHER.test(t) || !NON_GULF.test(t);
  }
};

// ---------------------------------------------------------------- searching

/** kind -> request overrides: region + language of the search, Restricted Mode always on */
function regionOf(kind) {
  if (kind === 'world') return { gl: 'US', hl: 'en', safe: true };
  if (kind.startsWith('w:')) return { gl: kind.slice(2), hl: 'en', safe: true };
  if (kind.startsWith('gl:'))
    return { gl: kind.slice(3), hl: 'ar', safe: true };
  return { gl: 'SA', hl: 'ar', safe: true };
}

async function search(kind, query, sp) {
  try {
    const j = await api('search', { query, params: sp }, regionOf(kind));
    return extract(j, { noShorts: true }).items.filter(
      (i) => i.type === 'video' && !i.live && !i.short
    );
  } catch (e) {
    console.warn('[ytlg] search', query, e?.message);
    return [];
  }
}

/** Channels and videos that belong to the viewer (left out of Explore). */
function personal() {
  const ids = new Set();
  const names = new Set();
  const vids = new Set();
  for (const c of favorites.list()) {
    if (c.channelId) ids.add(c.channelId);
    if (c.name) names.add(c.name);
  }
  for (const c of history.channels()) {
    if (c.channelId) ids.add(c.channelId);
    if (c.name) names.add(c.name);
  }
  for (const v of history.list()) vids.add(v.id);
  return { ids, names, vids };
}

/**
 * A date-windowed list: searches today's uploads, then this week's (older than a day), up to `windows`,
 * keeping each batch inside its age window so the whole list stays newest -> oldest.
 */
async function feed({
  kind,
  queries,
  perQuery,
  sort,
  perChannel,
  rule,
  excludePersonal,
  windows = 2
}) {
  const pool_ = shuffle(queries.slice());
  let qi = 0;
  const seen = new Set();
  const perCh = new Map();
  const own = excludePersonal ? personal() : null;
  const out = [];
  for (const win of WINDOWS.slice(0, windows)) {
    const take = [];
    for (let k = 0; k < perQuery; k++) take.push(pool_[qi++ % pool_.length]);
    const kinds = [].concat(kind);
    const lists = await Promise.all(
      take.map((q, k) => search(kinds[k % kinds.length], q, SP[sort][win.sp]))
    );
    const batch = [];
    for (const it of lists.flat()) {
      const age = itemAge(it);
      if (age < win.min || age >= win.max || seen.has(it.id) || !rule(it))
        continue;
      if (
        own &&
        (own.vids.has(it.id) ||
          own.ids.has(it.channelId) ||
          own.names.has(it.sub))
      )
        continue;
      const ch = it.channelId || it.sub;
      const n = perCh.get(ch) || 0;
      if (n >= perChannel) continue;
      perCh.set(ch, n + 1);
      seen.add(it.id);
      batch.push({ ...it, age });
    }
    batch.sort((a, b) => a.age - b.age);
    out.push(...batch);
  }
  return out;
}

/** Cached for 45 min (reopening a page sends no new searches); `fresh` skips the cache. */
async function cachedList(name, make, fresh) {
  if (!fresh) {
    const hit = cached('list.' + name, 45 * 60e3);
    if (hit) return hit.map((i) => ({ ...i, age: itemAge(i) }));
  }
  const items = await make();
  if (items.length) cache('list.' + name, items);
  return items;
}

export const LISTS = {
  exploreWorld: {
    title: 'استكشف العالم',
    make: () =>
      feed({
        kind: 'world',
        queries: WORLD_EXPLORE,
        perQuery: 6,
        sort: 'relevance',
        perChannel: 1,
        rule: RULES.world,
        excludePersonal: true
      })
  },
  exploreArab: {
    title: 'استكشف العرب',
    make: () =>
      feed({
        kind: 'arab',
        queries: ARAB_EXPLORE,
        perQuery: 6,
        sort: 'relevance',
        perChannel: 1,
        rule: RULES.arab,
        excludePersonal: true
      })
  },
  exploreSaudi: {
    title: 'استكشف السعودية',
    make: () =>
      feed({
        kind: 'gl:SA',
        queries: SAUDI_EXPLORE,
        perQuery: 6,
        sort: 'relevance',
        perChannel: 1,
        rule: RULES.saudi,
        excludePersonal: true
      })
  },
  exploreGulf: {
    title: 'استكشف الخليج',
    make: () =>
      feed({
        kind: GULF_SESSIONS,
        queries: GULF_EXPLORE,
        perQuery: 6,
        sort: 'relevance',
        perChannel: 1,
        rule: RULES.gulf,
        excludePersonal: true
      })
  },
  exploreEgypt: {
    title: 'استكشف مصر',
    make: () =>
      feed({
        kind: 'gl:EG',
        queries: EGYPT_EXPLORE,
        perQuery: 6,
        sort: 'relevance',
        perChannel: 1,
        rule: RULES.egypt,
        excludePersonal: true
      })
  },
  travelNew: {
    title: 'جديد السياحة',
    make: () =>
      feed({
        kind: 'arab',
        queries: TRAVEL,
        perQuery: 8,
        sort: 'relevance',
        perChannel: 1,
        rule: RULES.arab
      })
  },
  trendWorld: {
    title: 'تريند العالم',
    make: () =>
      feed({
        kind: WEST_SESSIONS,
        queries: WORLD_TREND,
        perQuery: 8,
        sort: 'views',
        perChannel: 2,
        rule: RULES.worldTrend
      })
  },
  trendArab: {
    title: 'الترند العربي',
    make: () =>
      feed({
        kind: 'arab',
        queries: ARAB_TREND,
        perQuery: 8,
        sort: 'views',
        perChannel: 2,
        rule: RULES.arab
      })
  },
  trendSaudi: {
    title: 'الترند السعودي',
    make: () =>
      feed({
        kind: 'gl:SA',
        queries: SAUDI_TREND,
        perQuery: 8,
        sort: 'views',
        perChannel: 2,
        rule: RULES.saudi
      })
  },
  trendGulf: {
    title: 'ترند الخليج',
    make: () =>
      feed({
        kind: GULF_SESSIONS,
        queries: GULF_TREND,
        perQuery: 8,
        sort: 'views',
        perChannel: 2,
        rule: RULES.gulf
      })
  },
  trendMusic: {
    title: 'تريند الأغاني العالمي',
    make: () =>
      feed({
        kind: WEST_SESSIONS,
        queries: MUSIC_TREND,
        perQuery: 8,
        sort: 'views',
        perChannel: 2,
        rule: RULES.worldTrend
      })
  }
};

export function list(name, fresh) {
  return cachedList(name, LISTS[name].make, fresh);
}

// ---------------------------------------------------------------- favourites / new (exact times via RSS)

/** Newest video of each channel, ONE list sorted by publish time across channels. */
async function newestPerChannel(channels) {
  const out = [];
  await pool(channels, 6, async (c) => {
    let vids = [];
    try {
      vids = await channelRss(c.channelId);
    } catch {
      /* feed down: skip this time */
    }
    const v = vids[0];
    if (!v) return;
    const age = itemAge(v);
    out.push({
      ...v,
      sub: v.sub || c.name,
      channelId: c.channelId,
      age,
      meta: relTime(age)
    });
  });
  out.sort((a, b) => a.age - b.age);
  return out;
}

/** المفضلة: the newest video of each hearted channel. */
export const favoritesList = () => newestPerChannel(favorites.list());
/** الجديد: the newest video of each channel you watched (last 25 channels). */
export const newList = () => newestPerChannel(history.channels().slice(0, 25));

// ---------------------------------------------------------------- music (newest song + newest album per singer)

const ARAB_ARTISTS = [
  'محمد عبده',
  'عبدالمجيد عبدالله',
  'راشد الماجد',
  'رابح صقر',
  'ماجد المهندس',
  'حسين الجسمي',
  'أصالة',
  'أحلام',
  'نوال الكويتية',
  'بلقيس',
  'داليا مبارك',
  'عايض',
  'فؤاد عبدالواحد',
  'محمد عساف',
  'عمرو دياب',
  'تامر حسني',
  'محمد حماقي',
  'شيرين عبد الوهاب',
  'أنغام',
  'ويجز',
  'مروان موسى',
  'نانسي عجرم',
  'إليسا',
  'وائل كفوري',
  'راغب علامة',
  'ناصيف زيتون',
  'كاظم الساهر',
  'سعد لمجرد',
  'حاتم عمور',
  'الشاب خالد'
];
const EGYPT_ARTISTS = [
  'عمرو دياب',
  'تامر حسني',
  'محمد حماقي',
  'شيرين عبد الوهاب',
  'أنغام',
  'أحمد سعد',
  'محمد منير',
  'ويجز',
  'مروان موسى',
  'مروان بابلو',
  'رامي صبري',
  'رامي جمال',
  'بهاء سلطان',
  'حمزة نمرة',
  'محمود العسيلي',
  'آمال ماهر',
  'روبي',
  'كارمن سليمان',
  'مصطفى قمر',
  'محمد فؤاد',
  'هاني شاكر',
  'كايروكي',
  'محمد رمضان',
  'أحمد كامل',
  'تامر عاشور'
];
const WORLD_ARTISTS = [
  'Taylor Swift',
  'The Weeknd',
  'Ed Sheeran',
  'Billie Eilish',
  'Dua Lipa',
  'Bruno Mars',
  'Ariana Grande',
  'Justin Bieber',
  'Drake',
  'Rihanna',
  'Beyoncé',
  'Lady Gaga',
  'Coldplay',
  'Imagine Dragons',
  'Maroon 5',
  'Shakira',
  'Bad Bunny',
  'Karol G',
  'Sabrina Carpenter',
  'Olivia Rodrigo',
  'Post Malone',
  'Sia',
  'Adele',
  'Miley Cyrus',
  'Harry Styles',
  'Selena Gomez',
  'Charlie Puth',
  'Calvin Harris',
  'David Guetta',
  'BLACKPINK',
  'Stray Kids',
  'ROSÉ',
  'Kendrick Lamar',
  'SZA',
  'Eminem',
  'Doja Cat',
  'Linkin Park',
  'Katy Perry'
];
const NOT_SONG =
  /شيل[ةه]|شيلات|نشيد|أنشودة|انشودة|إنشاد|اناشيد|أناشيد|قرآن|تلاوة|محاضرة|بودكاست|\b(podcast|interview|reaction|behind the scenes|tutorial|lesson|vlog)\b/i;
const SP_CHANNEL = 'EgIQAg==';
const SP_PLAYLIST = 'EgIQAw==';
const norm = (s) =>
  String(s || '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+|-|topic|توبيك/gi, '')
    .toLowerCase();

async function rawSearch(kind, query, sp) {
  try {
    return extract(await api('search', { query, params: sp }, regionOf(kind)), {
      noShorts: true
    }).items;
  } catch {
    return [];
  }
}

// singer channel: the singer's name as whole word(s), little else (bilingual official names are fine, e.g.
// "محمد عبده | Mohammed Abdu"), and nothing that marks a news / TV / fan / lyrics channel
const NOT_ARTIST =
  /قناة|الفضائية|أخبار|اخبار|news|\btv\b|fan|محبي|عشاق|كليبات|اغاني|أغاني|lyrics|كاريوكي|karaoke|film|drama|دراما|مسلسل/i;
const spaced = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

function isArtistChannel(title, name) {
  const T = ` ${spaced(title)} `;
  const N = ` ${spaced(name)} `;
  if (!T.includes(N) || NOT_ARTIST.test(title)) return false;
  return T.replace(N, ' ').trim().length <= 30;
}
async function resolveArtist(kind, name) {
  const ids = read('artistIds2', {}); // v2: stricter matching (v1 matched e.g. a news channel for "بلقيس")
  const hit = ids[name];
  if (hit && Date.now() - hit.at < 30 * 86400e3)
    return hit.id ? { channelId: hit.id, name } : null;
  const ch = (await rawSearch(kind, name, SP_CHANNEL)).find(
    (c) => c.type === 'channel' && isArtistChannel(c.title, name)
  );
  ids[name] = { id: ch?.id || '', at: Date.now() };
  write('artistIds2', ids);
  return ch ? { channelId: ch.id, name } : null;
}

async function newestSong(c) {
  const v = (await channelRss(c.channelId)).find(
    (x) => !NOT_SONG.test(x.title) && !isAdult(x)
  );
  if (!v) return null;
  const age = itemAge(v);
  return age > 120 * DAY
    ? null
    : { ...v, sub: v.sub || c.name, age, meta: relTime(age) };
}

/** Newest official album (OLAK playlist, owner = the singer, 3+ tracks), date = newest track (RSS). 12 h cache. */
async function newestAlbum(kind, c, word) {
  const key = 'album.' + c.channelId;
  const hit = cached(key, 12 * 3600e3);
  if (hit !== null)
    return (
      hit && {
        ...hit,
        age: itemAge(hit),
        meta: `ألبوم • ${relTime(itemAge(hit))}`
      }
    );
  const cands = (await rawSearch(kind, `${c.name} ${word}`, SP_PLAYLIST))
    .filter((p) => p.type === 'playlist' && /^OLAK5uy_/.test(p.id))
    .slice(0, 4);
  const want = norm(c.name);
  let best = null;
  for (const p of cands) {
    let f;
    try {
      f = await rssFeed(`playlist_id=${p.id}`);
    } catch {
      continue;
    }
    if (f.entries.length < 3 || !norm(f.owner).includes(want)) continue;
    const at = Math.max(...f.entries.map((e) => e.publishedAt));
    if (!best || at > best.publishedAt)
      best = {
        type: 'playlist',
        id: p.id,
        title: p.title,
        sub: c.name,
        channelId: c.channelId,
        publishedAt: at,
        videoId: f.entries[0].id,
        tracks: f.entries.length,
        thumb: `https://i.ytimg.com/vi/${f.entries[0].id}/hqdefault.jpg`
      };
  }
  cache(key, best || false);
  if (!best) return null;
  const age = itemAge(best);
  return { ...best, age, meta: `ألبوم • ${relTime(age)}` };
}

const MUSIC = {
  arab: { kind: 'arab', artists: ARAB_ARTISTS, word: 'ألبوم' },
  world: { kind: 'world', artists: WORLD_ARTISTS, word: 'album' },
  egypt: { kind: 'gl:EG', artists: EGYPT_ARTISTS, word: 'ألبوم' }
};

/** الموسيقى العربية / الأجنبية: newest song + newest album of each singer, one list newest first. */
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const busy = {};

/** an album already in the 12 h cache (no request); undefined when not looked up yet */
function cachedAlbum(c) {
  const hit = cached('album.' + c.channelId, 12 * 3600e3);
  if (hit === null) return undefined;
  if (!hit) return null;
  const age = itemAge(hit);
  return { ...hit, age, meta: `ألبوم • ${relTime(age)}` };
}

/**
 * الموسيقى العربية / الأجنبية: newest song + newest album of each singer, one list newest first.
 * Answers within ~8 s: singers whose channel is already known, their songs (RSS) and the albums already
 * cached. Unknown singers and missing albums are looked up quietly in the background (paced), so the page
 * fills in on the next open instead of making the TV wait (it re-asks for a page that takes too long).
 */
export async function music(which, fresh) {
  const cfg = MUSIC[which];
  if (!fresh) {
    const hit = cached('list.music.' + which, 30 * 60e3);
    if (hit) return hit.map((i) => ({ ...i, age: itemAge(i) }));
  }
  const known = () => {
    const ids = read('artistIds2', {});
    return cfg.artists
      .map((n) => (ids[n]?.id ? { channelId: ids[n].id, name: n } : null))
      .filter(Boolean);
  };
  const ids0 = read('artistIds2', {});
  const unresolved = cfg.artists.filter(
    (n) => !ids0[n] || Date.now() - ids0[n].at > 30 * 86400e3
  );
  const resolving = pool(unresolved, 2, (n) => resolveArtist(cfg.kind, n));
  await Promise.race([resolving, sleep(8000)]);
  const singers = known();
  const songs = await pool(singers, 6, (c) => newestSong(c).catch(() => null));
  const albums = singers.map(cachedAlbum);
  const missing = singers.filter((c, i) => albums[i] === undefined);
  const out = [...songs, ...albums].filter(Boolean);
  out.sort((a, b) => a.age - b.age);
  const complete =
    !missing.length &&
    singers.length === known().length &&
    (await Promise.race([
      resolving.then(() => true),
      sleep(0).then(() => false)
    ]));
  if (complete) cache('list.music.' + which, out);
  else if (!busy[which]) {
    busy[which] = true;
    resolving
      .then(() =>
        pool(
          known().filter((c) => cachedAlbum(c) === undefined),
          2,
          (c) => newestAlbum(cfg.kind, c, cfg.word)
        )
      )
      .catch(() => {})
      .finally(() => {
        busy[which] = false;
      });
  }
  return out;
}
