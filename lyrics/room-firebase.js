// Lyrics Flow のカラオケのルーム: Firebase への接続（パソコン・スマホ共通）
//   ・SK Hub Systems の Firebase（/y-filter/firebase-config.js）に、名前つきのアプリ「lyrics」として匿名ログインする
//     （サイトのアカウントのログイン（既定のアプリ）とは混ざらない）
//   ・ルール: y-filter リポジトリの systems/firestore.rules の karaokeRooms
const V = '10.12.2';
let ready = null;

export function connect() {
  if (!ready) {
    ready = (async () => {
      const [appMod, authMod, fs, cfg] = await Promise.all([
        import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
        import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
        import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`),
        import('/y-filter/firebase-config.js'),
      ]);
      const app = appMod.getApps().find((a) => a.name === 'lyrics') || appMod.initializeApp(cfg.firebaseConfig, 'lyrics');
      const auth = authMod.getAuth(app);
      await auth.authStateReady();
      if (!auth.currentUser) await authMod.signInAnonymously(auth);
      return { app, auth, uid: auth.currentUser.uid, db: fs.getFirestore(app), fs };
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

// ルームの ID（24 文字のランダムな英数字）
export function newRoomId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const a = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(a, (b) => chars[b % chars.length]).join('');
}
export const ROOM_RE = /^[a-z0-9]{24}$/;

// 曲を、ルームに書く小さい形に
export function compactTrack(t) {
  const s = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  return { id: s(t.id, 64), uri: s(t.uri, 80), name: s(t.name, 300), artists: s(t.artists, 300), art: s(t.art, 500), big: s(t.big, 500), album: s(t.album, 300), dur: Number(t.dur) || 0 };
}
