// MALU の検索結果ページ。外部辞書サイトを開く代わりに、公開 API から引いた結果をここに出す。
// 取得元: ja.wiktionary.org / ja.wikipedia.org / api.dictionaryapi.dev（どれも CORS で直接読める）
(function () {
  'use strict';

  const t = window.SKI18N ? window.SKI18N.t : (s, v) => (v ? s.replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? v[k] : m)) : s);
  const params = new URLSearchParams(location.search);
  const term = (params.get('q') || '').trim().slice(0, 200);
  const dict = (params.get('dict') || '').slice(0, 40);
  const cat = (params.get('cat') || '').slice(0, 20);

  const queryInput = document.getElementById('result-query');
  const form = document.getElementById('result-form');
  const meta = document.getElementById('result-meta');
  const list = document.getElementById('result-list');

  // ---- テーマ（MALU の設定を引き継ぐ） ----
  (function applyTheme() {
    let theme = 'auto';
    try { theme = (JSON.parse(localStorage.getItem('dictionarySettings')) || {}).theme || 'auto'; } catch (e) {}
    const dark = theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  })();

  // ---- 小さな部品 ----
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function addCard(title, linkHref, linkText) {
    const card = el('section', 'result-card result-card--loading');
    card.style.setProperty('--i', String(list.children.length));
    const head = el('div', 'result-card__head');
    head.appendChild(el('h2', 'result-card__title', title));
    if (linkHref) {
      const a = el('a', 'result-card__link', linkText);
      a.href = linkHref;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      head.appendChild(a);
    }
    const body = el('div', 'result-card__body', t('読み込み中…'));
    card.appendChild(head);
    card.appendChild(body);
    list.appendChild(card);
    return { card, body };
  }

  function finish(card, body, empty) {
    card.classList.remove('result-card--loading');
    if (empty) card.classList.add('result-card--empty');
    return body;
  }

  function credit(card, text) {
    card.appendChild(el('p', 'result-card__credit', text));
  }

  async function getJson(url) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  function failed(slot, err) {
    slot.body.textContent = navigator.onLine === false
      ? t('オフラインのため取得できません。')
      : t('取得できませんでした。しばらくしてからもう一度お試しください。');
    finish(slot.card, slot.body, true);
    if (window.console) console.warn(err);
  }

  // ---- Wiktionary（日本語版。ほとんどの言語の語がのっている） ----
  async function wiktionary() {
    const pageUrl = 'https://ja.wiktionary.org/wiki/' + encodeURIComponent(term);
    const slot = addCard(t('ウィクショナリー'), pageUrl, t('ウィクショナリーで開く'));
    try {
      const api = 'https://ja.wiktionary.org/w/api.php?action=query&prop=extracts&explaintext=1&exsectionformat=plain&redirects=1&format=json&origin=*&titles=' + encodeURIComponent(term);
      const data = await getJson(api);
      const pages = data && data.query && data.query.pages ? Object.values(data.query.pages) : [];
      const page = pages[0];
      if (!page || page.missing !== undefined || !page.extract || !page.extract.trim()) {
        slot.body.textContent = t('この言葉は見つかりませんでした。');
        finish(slot.card, slot.body, true);
        await suggest(slot);
        return;
      }
      slot.body.textContent = '';
      renderExtract(slot.body, page.extract);
      finish(slot.card, slot.body, false);
      credit(slot.card, t('出典: ウィクショナリー日本語版（CC BY-SA）'));
    } catch (err) {
      failed(slot, err);
    }
  }

  // 見出し（空行が 2 つ以上あく）ごとに分けて、1 行目を見出し、残りを段落にする
  function renderExtract(body, text) {
    const MAX = 6000;
    let clipped = false;
    if (text.length > MAX) { text = text.slice(0, MAX); clipped = true; }
    text.trim().split(/\n{3,}/).forEach((section) => {
      const lines = section.split('\n').map((s) => s.trim()).filter(Boolean);
      if (!lines.length) return;
      body.appendChild(el('h3', null, lines[0]));
      lines.slice(1).forEach((line) => body.appendChild(el('p', null, line)));
    });
    if (clipped) body.appendChild(el('p', 'phonetic', t('…（続きは「ウィクショナリーで開く」から）')));
  }

  // 見つからなかったときの「もしかして」
  async function suggest(slot) {
    try {
      const data = await getJson('https://ja.wiktionary.org/w/api.php?action=opensearch&limit=6&format=json&origin=*&search=' + encodeURIComponent(term));
      const words = Array.isArray(data) && Array.isArray(data[1]) ? data[1].filter((w) => w !== term) : [];
      if (!words.length) return;
      slot.body.appendChild(el('p', null, t('もしかして:')));
      const box = el('div', 'result-suggest');
      words.forEach((w) => {
        const a = el('a', null, w);
        a.href = resultUrl(w);
        box.appendChild(a);
      });
      slot.body.appendChild(box);
    } catch (e) { /* 候補が出せなくても困らない */ }
  }

  // ---- Wikipedia の要約（国語辞典の語彙向け） ----
  async function wikipedia() {
    const pageUrl = 'https://ja.wikipedia.org/wiki/' + encodeURIComponent(term);
    const slot = addCard(t('ウィキペディア'), pageUrl, t('ウィキペディアで開く'));
    try {
      const data = await getJson('https://ja.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(term) + '?redirect=true');
      if (!data || !data.extract) {
        slot.body.textContent = t('この言葉は見つかりませんでした。');
        finish(slot.card, slot.body, true);
        return;
      }
      slot.body.textContent = '';
      if (data.description) slot.body.appendChild(el('p', 'phonetic', data.description));
      slot.body.appendChild(el('p', null, data.extract));
      finish(slot.card, slot.body, false);
      credit(slot.card, t('出典: ウィキペディア日本語版（CC BY-SA）'));
    } catch (err) {
      failed(slot, err);
    }
  }

  // ---- 英語の定義（Free Dictionary API） ----
  async function english() {
    const pageUrl = 'https://en.wiktionary.org/wiki/' + encodeURIComponent(term);
    const slot = addCard(t('英語の定義（English）'), pageUrl, t('Wiktionary（英語版）で開く'));
    try {
      const data = await getJson('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(term.toLowerCase()));
      if (!Array.isArray(data) || !data.length) {
        slot.body.textContent = t('この言葉は見つかりませんでした。');
        finish(slot.card, slot.body, true);
        return;
      }
      slot.body.textContent = '';
      const first = data[0];
      const phon = first.phonetic || (first.phonetics || []).map((p) => p.text).find(Boolean);
      if (phon) slot.body.appendChild(el('p', 'phonetic', phon));
      data.forEach((entry) => {
        (entry.meanings || []).forEach((m) => {
          slot.body.appendChild(el('span', 'pos', m.partOfSpeech || ''));
          const ol = el('ol');
          (m.definitions || []).slice(0, 4).forEach((d) => {
            const li = el('li', null, d.definition || '');
            if (d.example) li.appendChild(el('p', 'example', '“' + d.example + '”'));
            ol.appendChild(li);
          });
          slot.body.appendChild(ol);
        });
      });
      finish(slot.card, slot.body, false);
      credit(slot.card, t('出典: Free Dictionary API（Wiktionary 由来）'));
    } catch (err) {
      failed(slot, err);
    }
  }

  // ---- どの辞書を引くか ----
  const hasLatin = /^[A-Za-z][A-Za-z' -]*$/.test(term);
  const srcParam = (params.get('src') || '').slice(0, 60);
  function resultUrl(word) {
    const p = new URLSearchParams({ q: word });
    if (srcParam) p.set('src', srcParam);
    if (dict) p.set('dict', dict);
    if (cat) p.set('cat', cat);
    return '/dictionary/result/?' + p.toString();
  }

  // ---- Wiktionary（英語版） ----
  async function enWiktionary() {
    const pageUrl = 'https://en.wiktionary.org/wiki/' + encodeURIComponent(term);
    const slot = addCard(t('Wiktionary（英語版）'), pageUrl, t('Wiktionary（英語版）で開く'));
    try {
      const api = 'https://en.wiktionary.org/w/api.php?action=query&prop=extracts&explaintext=1&exsectionformat=plain&redirects=1&format=json&origin=*&titles=' + encodeURIComponent(term);
      const data = await getJson(api);
      const pages = data && data.query && data.query.pages ? Object.values(data.query.pages) : [];
      const page = pages[0];
      if (!page || page.missing !== undefined || !page.extract || !page.extract.trim()) {
        slot.body.textContent = t('この言葉は見つかりませんでした。');
        finish(slot.card, slot.body, true);
        return;
      }
      slot.body.textContent = '';
      renderExtract(slot.body, page.extract);
      finish(slot.card, slot.body, false);
      credit(slot.card, t('出典: Wiktionary 英語版（CC BY-SA）'));
    } catch (err) {
      failed(slot, err);
    }
  }

  // どの取得元を使うか（API モードのホームの「引く先」。指定がなければカテゴリから決める）
  function pickSources() {
    if (srcParam) {
      const keys = srcParam.split(',');
      if (!keys.includes('auto')) return keys;
      return hasLatin ? ['en', 'wikt'] : ['wikt', 'wp'];
    }
    const keys = ['wikt'];
    if (cat === 'eigo' || (cat === 'eij' && hasLatin)) keys.unshift('en');
    if (cat === 'kokugo') keys.push('wp');
    return keys;
  }

  function run() {
    queryInput.value = term;
    if (!term) {
      meta.textContent = t('調べたい言葉を入力してください。');
      queryInput.focus();
      return;
    }
    document.title = term + ' | ' + t('検索結果') + ' | MALU';
    meta.textContent = '';
    const strong = el('strong', null, term);
    meta.appendChild(strong);
    meta.appendChild(document.createTextNode(' ' + t('の検索結果')));

    const keys = pickSources();
    if (keys.includes('en')) english();
    if (keys.includes('wikt')) wiktionary();
    if (keys.includes('enwikt')) enWiktionary();
    if (keys.includes('wp')) wikipedia();
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const next = queryInput.value.trim();
    if (!next) { queryInput.focus(); return; }
    location.href = resultUrl(next);
  });

  run();
})();
