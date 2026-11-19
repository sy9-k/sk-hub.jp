/* ページの管理（/manage）の動き。追加は /api/upload、削除は /api/delete に送る。
 * 操作には独自のヘッダー（X-SK-Home）が必要。別のサイトからの送信を防ぐため。 */
(() => {
  "use strict";
  const HEADERS = { "X-SK-Home": "1" };
  const file = document.getElementById("file");
  const name = document.getElementById("name");
  const add = document.getElementById("add");
  const msg = document.getElementById("msg");

  function say(text, isError) {
    msg.textContent = text;
    msg.hidden = false;
    msg.classList.toggle("is-error", Boolean(isError));
  }

  async function upload(overwrite) {
    const q = new URLSearchParams({ name: name.value.trim() });
    if (overwrite) q.set("overwrite", "1");
    const res = await fetch("/api/upload?" + q.toString(), {
      method: "POST", headers: HEADERS, body: file.files[0],
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  add.addEventListener("click", async () => {
    const f = file.files[0];
    const n = name.value.trim();
    if (!f) return say("HTML ファイルを選んでください", true);
    if (!n) return say("ページ名を入れてください", true);
    add.disabled = true;
    try {
      let r = await upload(false);
      if (r.status === 409) {
        if (!confirm(`「${n}」は既にあります。上書きしますか？`)) return say("追加をやめました");
        r = await upload(true);
      }
      if (r.status !== 200) return say(r.data.error || "追加できませんでした", true);
      location.reload();
    } catch (e) {
      say("通信できませんでした。もう一度お試しください", true);
    } finally {
      add.disabled = false;
    }
  });

  document.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const title = btn.dataset.title;
      if (!confirm(`「${title}」を削除しますか？\n削除すると元に戻せません。`)) return;
      btn.disabled = true;
      try {
        const q = new URLSearchParams({ path: btn.dataset.delete });
        const res = await fetch("/api/delete?" + q.toString(), { method: "POST", headers: HEADERS });
        if (!res.ok) throw new Error(String(res.status));
        location.reload();
      } catch (e) {
        btn.disabled = false;
        alert("削除できませんでした");
      }
    });
  });
})();
