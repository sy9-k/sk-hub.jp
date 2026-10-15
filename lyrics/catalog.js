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
