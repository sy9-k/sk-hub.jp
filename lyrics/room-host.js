// Lyrics Flow のカラオケのルーム: パソコン（親機）の側
//   ・ルームを作り（または前のルームにつなぎ直し）、スマホからの頼み（requests）を受けて、親機の Spotify で実行する
//   ・いまの様子（演奏中の曲・次の曲と予約した人）を、ルームの state に書く（変わったときだけ、4 秒に 1 回まで）
//   ・Lyrics Flow の本体（lyrics/index.html）とは window.LF_HOST でやり取りする
import { connect, newRoomId, ROOM_RE, compactTrack } from '/lyrics/room-firebase.js';

const H = () => window.LF_HOST;
const ROOM_MS = 11.5 * 3600e3;   // ルームの期限（ルールの上限は 12 時間）
const STALE_MS = 2 * 60e3;        // これより古い頼みは実行しない（親機を開き直したときに、昔の頼みをまとめて動かさない）
let room = null;                  // { id, c, unsub, timer, lastState }
const byName = new Map();         // 曲の ID → 予約した人の名前

function trackOf(x) {
  const imgs = (x.album && x.album.images) || [];
  return compactTrack({
    id: x.id, uri: x.uri, name: x.name, artists: (x.artists || []).map((a) => a.name).join(', '), album: x.album ? x.album.name : '',
    art: imgs.length ? (imgs.find((i) => i.width && i.width <= 300) || imgs[imgs.length - 1]).url : '', big: imgs.length ? imgs[0].url : '', dur: x.duration_ms,
  });
}

// ---------- ルームを開く・閉じる ----------
export async function open(prevId) {
  const c = await connect();
  const { doc, getDoc, setDoc, updateDoc, serverTimestamp, Timestamp, collection, query, where, onSnapshot } = c.fs;
  let id = ROOM_RE.test(prevId || '') ? prevId : null;
  if (id) {
    // 前のルーム: 自分のもので、まだ開いていればつなぎ直して期限をのばす
    try {
      const snap = await getDoc(doc(c.db, 'karaokeRooms', id));
      const d = snap.exists() ? snap.data() : null;
      if (d && d.hostUid === c.uid && d.open && d.expiresAt.toMillis() > Date.now()) {
        await updateDoc(snap.ref, { expiresAt: Timestamp.fromMillis(Date.now() + ROOM_MS), updatedAt: serverTimestamp() });
      } else id = null;
    } catch { id = null; }
  }
  if (!id) {
    id = newRoomId();
    await setDoc(doc(c.db, 'karaokeRooms', id), {
      hostUid: c.uid, open: true, createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + ROOM_MS), state: {}, updatedAt: serverTimestamp(),
    });
  }
  close(true);
  room = { id, c, lastState: '', queue: [], queueAt: 0, extendedAt: Date.now() };
  // 頼みを受ける（status == new のものだけ。並べ替えは手元で）
  room.unsub = onSnapshot(query(collection(c.db, 'karaokeRooms', id, 'requests'), where('status', '==', 'new')), (snap) => {
    snap.docChanges().filter((ch) => ch.type === 'added').map((ch) => ch.doc)
      .sort((a, b) => (a.data().createdAt?.toMillis?.() || 0) - (b.data().createdAt?.toMillis?.() || 0))
      .forEach((d) => enqueue(d));
  }, (e) => console.warn('room listen', e));
  room.timer = setInterval(publish, 4000);
  publish();
  return { id, url: location.origin + '/lyrics/remote/?room=' + id };
}

export async function close(silent) {
  if (!room) return;
  const r = room;
  room = null;
  clearInterval(r.timer);
  r.unsub && r.unsub();
  if (silent) return;
  const { doc, updateDoc, serverTimestamp } = r.c.fs;
  try { await updateDoc(doc(r.c.db, 'karaokeRooms', r.id), { open: false, updatedAt: serverTimestamp() }); } catch (e) { console.warn(e); }
}

export const nameOf = (trackId) => byName.get(trackId) || '';

// ---------- 頼みを 1 つずつ実行する ----------
let chain = Promise.resolve();
function enqueue(d) { chain = chain.then(() => handle(d)).catch((e) => console.warn('room request', e)); }

async function handle(d) {
  if (!room) return;
  const r = d.data();
  const { updateDoc, deleteDoc, serverTimestamp } = room.c.fs;
  const created = r.createdAt?.toMillis?.() || Date.now();
  let out;
  if (Date.now() - created > STALE_MS) out = { status: 'error', error: 'expired' };
  else {
    try { out = await run(r); }
    catch (e) { out = { status: 'error', error: String(e && e.message || e).slice(0, 300) }; }
  }
  await updateDoc(d.ref, { status: out.status, ...(out.result ? { result: out.result } : {}), ...(out.error ? { error: out.error } : {}), doneAt: serverTimestamp() }).catch(() => {});
  // 結果を読んだころに消す
  setTimeout(() => deleteDoc(d.ref).catch(() => {}), 90e3);
}

const enc = encodeURIComponent;
async function run(r) {
  const h = H();
  // スマホ側で理由を出せるように「Spotify 404: NO_ACTIVE_DEVICE」の形で返す
  const fail = (res) => ({ status: 'error', error: ('Spotify ' + res.status + (res.reason ? ': ' + res.reason : '')).slice(0, 300) });
  if (r.kind === 'search') return { status: 'done', result: await search(r.mode, r.q || '') };
  if (r.kind === 'reserve') {
    const res = await h.call('POST', '/me/player/queue?uri=' + enc(r.track.uri));
    if (!res.ok) return fail(res);
    byName.set(r.track.id, r.name || '');
    h.onReserved(r.name || '', r.track);
    room.queueAt = 0;
    return { status: 'done' };
  }
  if (r.kind === 'playNow') {
    const res = await h.call('PUT', '/me/player/play', { uris: [r.track.uri] });
    if (!res.ok) return fail(res);
    byName.set(r.track.id, r.name || '');
    return { status: 'done' };
  }
  if (r.kind === 'op') {
    const pos = h.rawMs();
    const vol = h.volume();
    const ops = {
      pause: ['PUT', '/me/player/pause'], play: ['PUT', '/me/player/play'], skip: ['POST', '/me/player/next'], prev: ['POST', '/me/player/previous'],
      restart: ['PUT', '/me/player/seek?position_ms=0'],
      rew: ['PUT', '/me/player/seek?position_ms=' + Math.max(0, Math.round(pos - 10000))],
      ff: ['PUT', '/me/player/seek?position_ms=' + Math.round(pos + 10000)],
      volUp: ['PUT', '/me/player/volume?volume_percent=' + Math.min(100, vol + 10)],
      volDown: ['PUT', '/me/player/volume?volume_percent=' + Math.max(0, vol - 10)],
    };
    const o = ops[r.op];
    if (!o) return { status: 'error', error: 'unknown op' };
    const res = await h.call(o[0], o[1]);
    return res.ok ? { status: 'done' } : fail(res);
  }
  return { status: 'error', error: 'unknown kind' };
}

async function search(modeArg, q) {
  const h = H();
  // 「song:20」のように、続きを読むときは何曲目からかを付けてくる
  const [mode, offRaw] = String(modeArg || '').split(':');
  const offset = Math.min(980, Math.max(0, Number(offRaw) || 0));
  // 混んでいる・一時的に断られたときは、少し待って 2 回までやり直す
  const get = async (path) => {
    for (let i = 0; ; i++) {
      const res = await h.call('GET', path);
      if (res.ok) return res.json;
      if (i < 2 && (res.status === 429 || res.status === 403 || res.status >= 500 || res.status === 0)) { await new Promise((ok) => setTimeout(ok, res.status === 429 ? 2500 : 700 * (i + 1))); continue; }
      throw new Error('Spotify ' + res.status + (res.reason ? ': ' + res.reason : ''));
    }
  };
  const params = (qq, limit) => '/search?' + new URLSearchParams({ type: 'track', limit: String(limit), offset: String(offset), market: 'from_token', q: qq });
  const tracks = (d) => ((d && d.tracks && d.tracks.items) || []).filter(Boolean).map(trackOf);
  if (mode === 'song') return tracks(await get(params(q, 20)));
  // 歌詞のデータベースで見つけた曲を、Spotify の曲にする（q は「曲名\n歌手名」）
  if (mode === 'resolve') {
    const [name, artist] = q.split('\n');
    const exact = tracks(await get(params('track:"' + name + '"' + (artist ? ' artist:"' + artist + '"' : ''), 5)));
    return exact.length ? exact : tracks(await get(params(name + ' ' + (artist || ''), 5)));
  }
  if (mode === 'artist') return tracks(await get(params('artist:"' + q + '"', 20)));
  if (mode === 'genre') return tracks(await get(params('genre:"' + q + '"', 40)));
  if (mode === 'new') return tracks(await get(params('year:' + new Date().getFullYear(), 40)));
  if (mode === 'top') return (((await get('/me/top/tracks?limit=50&time_range=' + (['short_term', 'medium_term', 'long_term'].includes(q) ? q : 'short_term'))) || {}).items || []).map(trackOf);
  if (mode === 'recent') {
    const d = await get('/me/player/recently-played?limit=50');
    const seen = new Set();
    return ((d && d.items) || []).map((x) => x.track).filter((x) => x && !seen.has(x.id) && seen.add(x.id)).map(trackOf);
  }
  if (mode === 'queue') {
    const d = await get('/me/player/queue');
    const out = [];
    if (d && d.currently_playing && d.currently_playing.type === 'track') out.push({ ...trackOf(d.currently_playing), current: true });
    ((d && d.queue) || []).filter((x) => x && x.type === 'track').slice(0, 40).forEach((x, i) => out.push({ ...trackOf(x), pos: i + 1, by: byName.get(x.id) || '' }));
    return out;
  }
  return [];
}

// ---------- いまの様子を書く ----------
async function publish() {
  if (!room) return;
  const h = H();
  const { doc, updateDoc, serverTimestamp, Timestamp } = room.c.fs;
  // 開きっぱなしのときは、1 時間ごとに期限をのばす
  if (Date.now() - room.extendedAt > 3600e3) {
    room.extendedAt = Date.now();
    updateDoc(doc(room.c.db, 'karaokeRooms', room.id), { expiresAt: Timestamp.fromMillis(Date.now() + ROOM_MS), updatedAt: serverTimestamp() }).catch((e) => console.warn('room extend', e));
  }
  // 次の曲（15 秒に 1 回、予約が入ったときはすぐ）
  if (Date.now() - room.queueAt > 15e3) {
    room.queueAt = Date.now();
    try {
      const res = await h.call('GET', '/me/player/queue');
      if (res.ok && res.json) room.queue = (res.json.queue || []).filter((x) => x && x.type === 'track').slice(0, 8).map((x) => ({ ...trackOf(x), by: byName.get(x.id) || '' }));
    } catch {}
  }
  const n = h.now();
  const state = {
    now: n ? { ...compactTrack(n), by: byName.get(n.id) || '', playing: !!n.playing, progress: Math.round(n.progress || 0), at: Date.now() } : null,
    queue: room.queue,
    theme: h.theme(),
  };
  // 再生位置と時刻は毎回変わるので、それ以外が変わったとき・30 秒たったときだけ書く
  const key = JSON.stringify({ ...state, now: state.now ? { ...state.now, progress: 0, at: 0 } : null });
  if (key === room.lastState && Date.now() - (room.lastAt || 0) < 30e3) return;
  room.lastState = key;
  room.lastAt = Date.now();
  try { await updateDoc(doc(room.c.db, 'karaokeRooms', room.id), { state, updatedAt: serverTimestamp() }); } catch (e) { console.warn('room publish', e); }
}
export function poke() { if (room) { room.lastState = ''; room.queueAt = 0; publish(); } }
