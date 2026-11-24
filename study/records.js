// 組織のプロファイル（クラスの生徒・先生・総合管理者）の学習の記録を、オンラインに保存して共有する
//   記録は store.js が、プロファイルごとに分けて持つ（個人の記録はこの端末だけ）。ここでは、その記録を SK Hub Systems に預け、
//   別の端末で開いたときに合わせる。単語は新しく答えたほう、学習した日は多いほう、小テストは足し合わせる（store.mergeRecords）
//   保存先は accounts/{UID}/studyRecords/{プロファイルの ID}（cloud.js）。ネットがないときは端末に残し、次の機会に送る
import * as store from "./store.js";
import * as cloud from "./cloud.js";

let current = "";
let dirty = false;
let timer = 0;

// プロファイルを切りかえる。前のプロファイルに送っていない記録があれば、先に送る
export function switchTo(ctx) {
  if (current && dirty) cloud.saveRecords(current, store.snapshotRecords()).catch(() => {});
  clearTimeout(timer);
  dirty = false;
  current = ctx || "";
  store.setContext(current);
}

// オンラインの記録と合わせて、足りないものを送る。この端末の記録が変わったら true
export async function sync() {
  const ctx = current;
  if (!ctx) return false;
  try {
    const remote = await cloud.loadRecords(ctx);
    if (ctx !== current) return false;
    const r = store.mergeRecords(remote);
    if (r.remoteStale) await cloud.saveRecords(ctx, store.snapshotRecords());
    if (ctx === current) dirty = false;
    return r.localChanged;
  } catch (e) {
    return false; // ネットがないときなど。記録は端末に残っていて、次に答えたときに送り直す
  }
}

store.onRecordsChange(() => {
  if (!current) return;
  dirty = true;
  clearTimeout(timer);
  timer = setTimeout(sync, 2500);
});
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && dirty) sync(); });
window.addEventListener("pagehide", () => { if (dirty) sync(); });
