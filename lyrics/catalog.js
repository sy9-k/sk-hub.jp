// Lyrics Flow の選曲リモコン: Spotify 以外の曲のカタログ（パソコン・スマホ共通）
//   ・iTunes Search API（Apple のカタログ。キーなし。日本の曲に強い）で曲を探す
//   ・スマホは「カタログの曲 ID（it:123…）」をパソコンに送り、パソコンがカタログで曲名・歌手名・長さを確かめて、
//     自分の Spotify で同じ曲を探して予約する（pickSpotify）
//   ・LRCLIB で見つけた曲（lr:123…）も同じように扱える
const ITUNES = 'https://itunes.apple.com/';

// iTunes Search API はブラウザから JSONP で呼ぶ（CORS の有無に左右されないように）
let cbN = 0;
function jsonp(url, ms = 8000) {
  return new Promise((ok, ng) => {
    const cb = '__lfCatalog' + Date.now().toString(36) + (cbN++);
    const s = document.createElement('script');
    let timer = 0;
    const done = (err, v) => { clearTimeout(timer); try { delete window[cb]; } catch { window[cb] = undefined; } s.remove(); if (err) ng(err); else ok(v); };
    timer = setTimeout(() => done(new Error('catalog timeout')), ms);
    window[cb] = (v) => done(null, v);
    s.onerror = () => done(new Error('catalog network'));
    s.src = url + (url.includes('?') ? '&' : '?') + 'callback=' + cb;
    document.head.appendChild(s);
  });
}

const bigArt = (u) => (u || '').replace(/\/\d+x\d+(bb)?\.(jpg|png|webp)$/i, '/600x600bb.$2');
function fromItunes(x) {
  return {
    id: 'it' + x.trackId, ext: 'it:' + x.trackId, uri: '', name: x.trackName || '', artists: x.artistName || '', album: x.collectionName || '',
    art: x.artworkUrl100 || x.artworkUrl60 || '', big: bigArt(x.artworkUrl100), dur: x.trackTimeMillis || 0,
  };
}

// 曲名・歌手名で探す（同じ曲名・歌手名は 1 つにまとめる）
export async function searchItunes(q, mode) {
  const p = new URLSearchParams({ term: q, country: 'JP', media: 'music', entity: 'song', limit: '50', lang: 'ja_jp' });
  if (mode === 'artist') p.set('attribute', 'artistTerm');
  const d = await jsonp(ITUNES + 'search?' + p);
  const seen = new Set();
  return ((d && d.results) || []).filter((x) => x && x.kind === 'song' && x.trackId && x.trackName)
    .filter((x) => { const k = (x.trackName + '\n' + x.artistName).toLowerCase(); return !seen.has(k) && seen.add(k); })
    .map(fromItunes);
}

// カタログの曲 ID から、曲名・歌手名・長さを確かめる（パソコン側。スマホから来た名前より、こちらを信じる）
export async function lookup(ext) {
  const m = /^(it|lr):(\d{1,15})$/.exec(String(ext || ''));
  if (!m) return null;
  if (m[1] === 'it') {
    const d = await jsonp(ITUNES + 'lookup?' + new URLSearchParams({ id: m[2], country: 'JP', lang: 'ja_jp' }));
    const x = d && d.results && d.results.find((r) => r.trackId);
    return x ? fromItunes(x) : null;
  }
  const res = await fetch('https://lrclib.net/api/get/' + m[2]);
  if (!res.ok) return null;
  const x = await res.json();
  return x && x.trackName ? { name: x.trackName, artists: x.artistName || '', album: x.albumName || '', dur: Math.round((x.duration || 0) * 1000) } : null;
}

// Spotify で同じ曲を探す。find(q) は Spotify の検索で、{ id, uri, name, artists, dur } の配列を返す関数
const norm = (s) => String(s || '').toLowerCase().normalize('NFKC').replace(/[\s'’"“”.,!?・\-~〜()（）[\]【】]/g, '');
export async function pickSpotify(meta, find) {
  const name = meta.name.replace(/\s*[(\[（【][^)\]）】]*[)\]）】]\s*/g, ' ').trim() || meta.name;
  const artist = (String(meta.artists || '').split(/\s*[,、&]\s*|\s+feat\.?\s+/i)[0] || '').trim();
  let list = await find('track:"' + name + '"' + (artist ? ' artist:"' + artist + '"' : ''));
  if (!list.length) list = await find(name + ' ' + artist);
  if (!list.length && name !== meta.name) list = await find(meta.name);
  if (!list.length) return null;
  // 長さが近い・歌手名が合う・曲名が合うものを選ぶ（同じ点なら Spotify の並び順）
  const a = norm(artist), n = norm(meta.name), n2 = norm(name);
  const score = (x) => (meta.dur && x.dur ? Math.min(60, Math.abs(x.dur - meta.dur) / 1000) : 0)
    + (a && !norm(x.artists).includes(a) ? 30 : 0)
    + (norm(x.name) === n || norm(x.name) === n2 ? 0 : norm(x.name).includes(n2) ? 3 : 8);
  return list.map((x, i) => ({ x, s: score(x) + i * 0.01 })).sort((p, q) => p.s - q.s)[0].x;
}

// ---------- カテゴリー（ジャンル・新曲）: Apple Music（iTunes）の日本のランキング ----------
// ジャンルの番号は iTunes のもの
const GENRES = { 'j-pop': 27, anime: 29, 'k-pop': 51, rock: 21, 'hip-hop': 18, pop: 14 };
const GENRE_NAMES = { 'j-pop': 'J-Pop', anime: 'Anime', 'k-pop': 'K-Pop', rock: 'Rock', 'hip-hop': 'Hip-Hop/Rap', pop: 'Pop' };
// JSON をそのまま読めればそれで、読めなければ JSONP で
async function getJson(url, ms) {
  try { const r = await fetch(url); if (r.ok) return await r.json(); } catch {}
  return jsonp(url, ms);
}
const lab = (x) => (x && x.label) || '';
function fromChart(e) {
  const id = e && e.id && e.id.attributes && e.id.attributes['im:id'];
  const imgs = (e && e['im:image']) || [];
  const art = imgs.length ? lab(imgs[imgs.length - 1]) : '';
  return {
    id: 'it' + id, ext: 'it:' + id, uri: '', name: lab(e['im:name']), artists: lab(e['im:artist']),
    album: lab(e['im:collection'] && e['im:collection']['im:name']), art, big: bigArt(art), dur: 0,
    released: (e['im:releaseDate'] && e['im:releaseDate'].label) || '',
  };
}
// ランキング（genre を省くと全体）
export async function chart(genre) {
  const g = GENRES[genre];
  const d = await getJson(ITUNES + 'jp/rss/topsongs/limit=100' + (g ? '/genre=' + g : '') + '/json', 6000);
  let list = d && d.feed && d.feed.entry;
  if (list && !Array.isArray(list)) list = [list];
  return (list || []).map(fromChart).filter((x) => /^it\d+$/.test(x.id) && x.name);
}
// カテゴリーの曲: kind は 'genre'（arg にジャンル）か 'new'（新曲）
export async function category(kind, arg) {
  if (kind === 'new') {
    // いま人気の曲のうち、この 1 年に出たものを新しい順に
    const list = await chart('');
    const since = Date.now() - 365 * 864e5;
    const fresh = list.filter((x) => Date.parse(x.released) > since).sort((a, b) => Date.parse(b.released) - Date.parse(a.released));
    return fresh.length >= 10 ? fresh : list;
  }
  if (arg === 'vocaloid') {
    // ボカロはランキングのジャンルがないので、カタログを言葉で探す
    const [a, b] = await Promise.all([searchItunes('VOCALOID', 'song').catch(() => []), searchItunes('初音ミク', 'song').catch(() => [])]);
    const seen = new Set();
    return [...a, ...b].filter((x) => !seen.has(x.id) && seen.add(x.id));
  }
  let list = [];
  try { list = await chart(arg); } catch {}
  if (list.length) return list;
  // ランキングが読めないときは、ジャンルの名前で探す
  const p = new URLSearchParams({ term: GENRE_NAMES[arg] || arg, country: 'JP', media: 'music', entity: 'song', attribute: 'genreIndex', limit: '50', lang: 'ja_jp' });
  const d = await jsonp(ITUNES + 'search?' + p);
  return ((d && d.results) || []).filter((x) => x && x.kind === 'song' && x.trackId).map(fromItunes);
}
