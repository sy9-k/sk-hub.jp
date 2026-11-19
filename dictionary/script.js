// 多言語（/assets/i18n.js）。t('日本語') で、選んだ言語の訳を返す（辞書は assets/i18n/<言語>.js）
const t = window.SKI18N ? window.SKI18N.t : (s, v) => (v ? s.replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? v[k] : m)) : s);
const form = document.getElementById('dictionary-form');
const themeColorMeta = document.querySelector('meta[name="theme-color"]');
const queryInput = document.getElementById('query-input');
const searchButton = document.querySelector('.btn-search');
const categoryButtons = document.querySelectorAll('.category-tab');
const dictionaryPanel = document.querySelector('.dictionary-panel');
const dictionarySelectRow = document.getElementById('dictionary-select-row');
const historyContainer = document.getElementById('search-history');
const offlineOverlay = document.getElementById('offline-overlay');
const mainView = document.getElementById('main-view');
const settingsButton = document.getElementById('settings-button');
const settingsOverlay = document.getElementById('settings-overlay');
const settingsClose = document.getElementById('settings-close');
const settingsNavItems = document.querySelectorAll('.settings-nav__item');
const settingsSections = document.querySelectorAll('.settings-section');
const defaultDictionarySelect = document.getElementById('default-dictionary');
const openModeInputs = document.querySelectorAll('input[name="open-mode"]');
const themeModeInputs = document.querySelectorAll('input[name="theme-mode"]');
const clearHistoryButton = document.getElementById('clear-history');
const clearHistoryStatus = document.getElementById('clear-history-status');
const resetCacheButton = document.getElementById('reset-cache');
const networkStatus = document.getElementById('network-status');
const checkUpdateButton = document.getElementById('check-update');
const pwaInstallButton = document.getElementById('pwa-install-button');
const pwaInstallStatus = document.getElementById('pwa-install-status');
const pwaUpdateStatus = document.getElementById('pwa-update-status');
const pwaCheckUpdateButton = document.getElementById('pwa-check-update');
const pwaResetCacheButton = document.getElementById('pwa-reset-cache');
const aboutUpdateStatus = document.getElementById('about-update-status');
const appVersion = document.getElementById('app-version');
const installBanner = document.getElementById('install-banner');
const installButton = document.getElementById('install-button');
const installDismiss = document.getElementById('install-dismiss');
const currentTime = document.getElementById('current-time');
const CACHE_NAME = 'dictionary-v2';
const APP_VERSION = '1.0.0';
const DEFAULT_SETTINGS = { defaultDictionary: 'weblio', openMode: 'new', theme: 'auto', resultSource: 'external', apiSources: ['auto'] };
const resultSourceInputs = document.querySelectorAll('input[name="result-source"]');
const topAppBar = document.getElementById('top-app-bar');
const RIPPLE_SELECTOR = '.icon-button, .tab, .btn-search, .dict-pill, .history-item, .settings-nav__item, .settings-action, .settings-mode label, .install-banner__button, .install-banner__dismiss';
const DICTIONARY_THEME_COLORS = {
  weblio: '#1b4b8d',
  goo: '#2563a9',
  kotobank: '#334d8f',
  daijirin: '#123a6d',
  oxford: '#1a73e8',
  cambridge: '#2563eb',
  longman: '#0f5fc9',
  macmillan: '#0b4da2',
  naver_kr: '#d93025',
  daum_kr: '#c5221f',
  papago_ko: '#e5483f',
  google_ko: '#b91c1c',
  naver_zh: '#ff6f00',
  baidu_zh: '#f4511e',
  google_zh: '#e85d04',
  papago_zh: '#c2410c',
  jisho: '#0f9d58',
  alc: '#16a34a',
  weblio_ej: '#15803d',
  deepl_ej: '#047857',
  naver_ja_ko: '#fbbc05',
  daum_ja_ko: '#eab308',
  papago_jk: '#d97706',
  google_jk: '#ca8a04'
};
let selectedCategory = 'kokugo';
let selectedDictionary = 'weblio';
let searchHistory = loadSearchHistory();
let settings = loadSettings();
let isOffline = false;
let deferredInstallPrompt = null;
let serviceWorkerRegistration = null;

function loadSearchHistory() {
  try {
    const stored = localStorage.getItem('searchHistory');
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    return [];
  }
}

function saveSearchHistory() {
  localStorage.setItem('searchHistory', JSON.stringify(searchHistory));
}

function loadSettings() {
  try {
    const stored = localStorage.getItem('dictionarySettings');
    return stored ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored) } : { ...DEFAULT_SETTINGS };
  } catch (error) {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings() {
  localStorage.setItem('dictionarySettings', JSON.stringify(settings));
}

function isStandaloneApp() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function getResolvedTheme() {
  if (settings.theme === 'dark') return 'dark';
  if (settings.theme === 'light') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme() {
  const resolvedTheme = getResolvedTheme();
  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.style.colorScheme = resolvedTheme;
  applyColorScheme();
}

// Material 3 のダイナミックカラー：シード色から色相を取り出し、
// トーン（CIELAB の L*）ごとの色で配色ロールを組み立てる
const LAB_EPSILON = 216 / 24389;
const LAB_KAPPA = 24389 / 27;
const D65_WHITE = [0.95047, 1, 1.08883];

function srgbToLinear(channel) {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(channel) {
  const value = channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(Math.max(value, 0), 1) * 255);
}

function labF(value) {
  return value > LAB_EPSILON ? Math.cbrt(value) : (LAB_KAPPA * value + 16) / 116;
}

function labFInverse(value) {
  const cubed = value ** 3;
  return cubed > LAB_EPSILON ? cubed : (116 * value - 16) / LAB_KAPPA;
}

function hexToLch(hex) {
  const number = parseInt(hex.replace('#', ''), 16);
  const [r, g, b] = [(number >> 16) & 255, (number >> 8) & 255, number & 255].map(srgbToLinear);
  const fx = labF((0.4124 * r + 0.3576 * g + 0.1805 * b) / D65_WHITE[0]);
  const fy = labF(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const fz = labF((0.0193 * r + 0.1192 * g + 0.9505 * b) / D65_WHITE[2]);
  const a = 500 * (fx - fy);
  const bValue = 200 * (fy - fz);
  return { l: 116 * fy - 16, c: Math.hypot(a, bValue), h: Math.atan2(bValue, a) };
}

function lchToLinearRgb(l, c, h) {
  const fy = (l + 16) / 116;
  const fx = fy + (c * Math.cos(h)) / 500;
  const fz = fy - (c * Math.sin(h)) / 200;
  const x = labFInverse(fx) * D65_WHITE[0];
  const y = l > LAB_KAPPA * LAB_EPSILON ? fy ** 3 : l / LAB_KAPPA;
  const z = labFInverse(fz) * D65_WHITE[2];
  return [
    3.2406 * x - 1.5372 * y - 0.4986 * z,
    -0.9689 * x + 1.8758 * y + 0.0415 * z,
    0.0557 * x - 0.204 * y + 1.057 * z
  ];
}

// トーンを固定したまま、sRGB に収まるまで彩度を下げる
function toneToHex(hue, chroma, tone) {
  const inGamut = (rgb) => rgb.every((channel) => channel >= -0.0001 && channel <= 1.0001);
  let rgb = lchToLinearRgb(tone, chroma, hue);
  if (!inGamut(rgb)) {
    let low = 0;
    let high = chroma;
    for (let i = 0; i < 16; i += 1) {
      const mid = (low + high) / 2;
      if (inGamut(lchToLinearRgb(tone, mid, hue))) low = mid;
      else high = mid;
    }
    rgb = lchToLinearRgb(tone, low, hue);
  }
  return `#${rgb.map((channel) => linearToSrgb(channel).toString(16).padStart(2, '0')).join('')}`;
}

function createColorScheme(seedColor, isDark) {
  const { c, h } = hexToLch(seedColor);
  const primary = (tone) => toneToHex(h, Math.min(Math.max(c, 36), 64), tone);
  const secondary = (tone) => toneToHex(h, 18, tone);
  const neutral = (tone) => toneToHex(h, 4, tone);
  const neutralVariant = (tone) => toneToHex(h, 9, tone);
  const pick = (light, dark) => (isDark ? dark : light);

  return {
    primary: primary(pick(40, 80)),
    'on-primary': primary(pick(100, 20)),
    'primary-container': primary(pick(90, 30)),
    'on-primary-container': primary(pick(10, 90)),
    'inverse-primary': primary(pick(80, 40)),
    'secondary-container': secondary(pick(90, 30)),
    'on-secondary-container': secondary(pick(10, 90)),
    surface: neutral(pick(98, 6)),
    'surface-container-lowest': neutral(pick(100, 4)),
    'surface-container-low': neutral(pick(96, 10)),
    'surface-container': neutral(pick(94, 12)),
    'surface-container-high': neutral(pick(92, 17)),
    'surface-container-highest': neutral(pick(90, 22)),
    'on-surface': neutral(pick(10, 90)),
    'on-surface-variant': neutralVariant(pick(30, 80)),
    outline: neutralVariant(pick(50, 60)),
    'outline-variant': neutralVariant(pick(80, 30)),
    'inverse-surface': neutral(pick(20, 90)),
    'inverse-on-surface': neutral(pick(95, 20))
  };
}

function applyColorScheme(seedColor = getSelectedAccentColor()) {
  const scheme = createColorScheme(seedColor, getResolvedTheme() === 'dark');
  const rootStyle = document.documentElement.style;
  Object.entries(scheme).forEach(([role, value]) => {
    rootStyle.setProperty(`--md-${role}`, value);
  });
  if (themeColorMeta) {
    themeColorMeta.setAttribute('content', scheme.surface);
  }
}

function findCategoryForDictionary(dictionaryKey) {
  return Object.entries(categories).find(([, category]) =>
    category.dictionaries.some((dict) => dict.key === dictionaryKey)
  )?.[0];
}

function applySettings() {
  const category = findCategoryForDictionary(settings.defaultDictionary);
  if (category) {
    selectedCategory = category;
    selectedDictionary = settings.defaultDictionary;
  } else {
    selectedCategory = 'kokugo';
    selectedDictionary = DEFAULT_SETTINGS.defaultDictionary;
    settings.defaultDictionary = DEFAULT_SETTINGS.defaultDictionary;
    saveSettings();
  }
}

function populateDefaultDictionarySelect() {
  if (!defaultDictionarySelect) return;
  defaultDictionarySelect.innerHTML = '';

  Object.entries(categories).forEach(([categoryKey, category]) => {
    const optgroup = document.createElement('optgroup');
    optgroup.label = category.label;

    category.dictionaries.forEach((dictionary) => {
      const option = document.createElement('option');
      option.value = dictionary.key;
      option.textContent = dictionary.label;
      optgroup.appendChild(option);
    });

    defaultDictionarySelect.appendChild(optgroup);
  });

  defaultDictionarySelect.value = settings.defaultDictionary || DEFAULT_SETTINGS.defaultDictionary;
}

function updateOpenModeInputs() {
  if (!openModeInputs) return;
  openModeInputs.forEach((input) => {
    input.checked = input.value === settings.openMode;
  });
}

function updateResultSourceInputs() {
  resultSourceInputs.forEach((input) => {
    input.checked = input.value === settings.resultSource;
  });
}

function updateThemeModeInputs() {
  if (!themeModeInputs) return;
  themeModeInputs.forEach((input) => {
    input.checked = input.value === settings.theme;
  });
}

function updatePwaInstallState() {
  if (!pwaInstallButton && !pwaInstallStatus) return;

  const installed = isStandaloneApp();
  if (pwaInstallStatus) {
    if (installed) {
      pwaInstallStatus.textContent = t('このアプリはインストール済みです。');
    } else if (deferredInstallPrompt) {
      pwaInstallStatus.textContent = t('この端末にアプリとしてインストールできます。');
    } else {
      pwaInstallStatus.textContent = t('ブラウザの条件がそろうとインストールできます。');
    }
  }

  if (pwaInstallButton) {
    pwaInstallButton.disabled = installed || !deferredInstallPrompt;
    pwaInstallButton.textContent = installed ? t('インストール済み') : t('インストール');
  }
}

async function handleInstallPrompt() {
  if (!deferredInstallPrompt) {
    updatePwaInstallState();
    return;
  }
  deferredInstallPrompt.prompt();
  const choiceResult = await deferredInstallPrompt.userChoice;
  if (choiceResult.outcome === 'accepted') {
    console.log('PWA install accepted');
  } else {
    console.log('PWA install dismissed');
  }
  deferredInstallPrompt = null;
  hideInstallBanner();
  updatePwaInstallState();
}

function bindSettingsEvents() {
  if (defaultDictionarySelect) {
    defaultDictionarySelect.addEventListener('change', (event) => {
      settings.defaultDictionary = event.target.value;
      saveSettings();
      applySettings();
      updateCategorySelection();
    });
  }

  if (openModeInputs) {
    openModeInputs.forEach((input) => {
      input.addEventListener('change', (event) => {
        settings.openMode = event.target.value;
        saveSettings();
      });
    });
  }

  resultSourceInputs.forEach((input) => {
    input.addEventListener('change', (event) => {
      settings.resultSource = event.target.value === 'api' ? 'api' : 'external';
      saveSettings();
      applyApiMode();
      modeSwitchPending = true;
    });
  });

  if (themeModeInputs) {
    themeModeInputs.forEach((input) => {
      input.addEventListener('change', (event) => {
        settings.theme = event.target.value;
        saveSettings();
        applyTheme();
      });
    });
  }
}

function getResultTarget() {
  return settings.openMode === 'same' ? '_self' : '_blank';
}

function getDictionaryLabel(dictionaryKey) {
  for (const category of Object.values(categories)) {
    const dictionary = category.dictionaries.find((item) => item.key === dictionaryKey);
    if (dictionary) {
      return dictionary.label;
    }
  }
  return dictionaryKey;
}

function addSearchHistory(term, dictionaryKey) {
  const trimmed = term.trim();
  if (!trimmed) return;
  const existingIndex = searchHistory.findIndex(
    (item) => item.term === trimmed && item.dictionaryKey === dictionaryKey
  );
  if (existingIndex !== -1) {
    searchHistory.splice(existingIndex, 1);
  }
  searchHistory.push({ term: trimmed, dictionaryKey, timestamp: Date.now() });
  if (searchHistory.length > 60) {
    searchHistory.splice(0, searchHistory.length - 60);
  }
  saveSearchHistory();
  updateClearHistoryState();
  notifyAccount('history');
}

// SK Hub Systems アカウントとの連携（account.js）に知らせる（検索履歴の同期・単語帳のボタン）
function notifyAccount(what) {
  if (window.MALU && typeof window.MALU.onChange === 'function') window.MALU.onChange(what);
}

function renderSearchHistory() {
  if (!historyContainer) return;
  historyContainer.innerHTML = '';

  const category = categories[selectedCategory];
  const categoryKeys = category.dictionaries.map((dict) => dict.key);
  const categoryHistory = searchHistory.filter((item) => categoryKeys.includes(item.dictionaryKey));

  const title = document.createElement('p');
  title.className = 'search-history-title';
  title.textContent = t('検索履歴');
  historyContainer.appendChild(title);

  if (!categoryHistory.length) {
    const empty = document.createElement('p');
    empty.className = 'history-empty';
    empty.textContent = t('このカテゴリの検索履歴はまだありません。');
    historyContainer.appendChild(empty);
    return;
  }

  const historyByDictionary = categoryHistory.reduce((acc, item) => {
    const label = getDictionaryLabel(item.dictionaryKey);
    if (!acc[label]) acc[label] = [];
    acc[label].push(item);
    return acc;
  }, {});

  Object.entries(historyByDictionary).forEach(([label, items]) => {
    const group = document.createElement('div');
    group.className = 'history-group';

    const groupLabel = document.createElement('div');
    groupLabel.className = 'history-group-label';
    groupLabel.textContent = label;
    group.appendChild(groupLabel);

    const list = document.createElement('div');
    list.className = 'history-list';

    items
      .slice()
      .reverse()
      .slice(0, 6)
      .forEach((item) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'history-item';
        button.dataset.term = item.term;
        button.dataset.dictionary = item.dictionaryKey;
        button.addEventListener('click', () => {
          queryInput.value = item.term;
          selectedDictionary = item.dictionaryKey;
          setAccent(getSelectedAccentColor());
          renderDictionaryButtons();
          notifyAccount('selection');
          queryInput.focus();
        });

        const termSpan = document.createElement('span');
        termSpan.className = 'history-item-term';
        termSpan.textContent = item.term;
        button.appendChild(termSpan);

        const dictSpan = document.createElement('span');
        dictSpan.className = 'history-item-dict';
        dictSpan.textContent = label;
        button.appendChild(dictSpan);

        list.appendChild(button);
      });

    group.appendChild(list);
    historyContainer.appendChild(group);
  });
}

const categories = {
  kokugo: {
    label: t('国語辞典'),
    color: '#1b4b8d',
    dictionaries: [
      { key: 'weblio', label: 'Weblio' },
      { key: 'goo', label: t('goo 辞書') },
      { key: 'kotobank', label: t('コトバンク') },
      { key: 'daijirin', label: t('大辞林') }
    ]
  },
  eigo: {
    label: t('英語辞書'),
    color: '#1a73e8',
    dictionaries: [
      { key: 'oxford', label: 'Oxford' },
      { key: 'cambridge', label: 'Cambridge' },
      { key: 'longman', label: 'Longman' },
      { key: 'macmillan', label: 'Macmillan' }
    ]
  },
  kankoku: {
    label: t('韓国語辞書'),
    color: '#d93025',
    dictionaries: [
      { key: 'naver_kr', label: t('NAVER 韓国語') },
      { key: 'daum_kr', label: t('Daum 韓国語') },
      { key: 'papago_ko', label: t('Papago 翻訳') },
      { key: 'google_ko', label: t('Google 翻訳') }
    ]
  },
  chinese: {
    label: t('中国語辞典'),
    color: '#ff6f00',
    dictionaries: [
      { key: 'naver_zh', label: t('NAVER 中国語') },
      { key: 'baidu_zh', label: t('Baidu 中国語') },
      { key: 'google_zh', label: t('Google 翻訳') },
      { key: 'papago_zh', label: t('Papago 翻訳') }
    ]
  },
  eij: {
    label: t('英和・和英辞典'),
    color: '#0f9d58',
    dictionaries: [
      { key: 'jisho', label: 'Jisho' },
      { key: 'alc', label: t('英辞郎') },
      { key: 'weblio_ej', label: t('Weblio 英和') },
      { key: 'deepl_ej', label: 'DeepL' }
    ]
  },
  nikankoku: {
    label: t('日韓・韓日辞典'),
    color: '#fbbc05',
    dictionaries: [
      { key: 'naver_ja_ko', label: t('NAVER 日韓') },
      { key: 'daum_ja_ko', label: t('Daum 日韓') },
      { key: 'papago_jk', label: t('Papago 翻訳') },
      { key: 'google_jk', label: t('Google 翻訳') }
    ]
  }
};

const dictionaryUrls = {
  weblio: (term) => `https://www.weblio.jp/content/${encodeURIComponent(term)}`,
  goo: (term) => `https://dictionary.goo.ne.jp/srch/jn/${encodeURIComponent(term)}/m0u/`,
  kotobank: (term) => `https://kotobank.jp/word/${encodeURIComponent(term)}`,
  daijirin: (term) => `https://www.weblio.jp/content/${encodeURIComponent(term)}`,
  oxford: (term) => `https://www.oxfordlearnersdictionaries.com/definition/english/${encodeURIComponent(term)}`,
  cambridge: (term) => `https://dictionary.cambridge.org/dictionary/english/${encodeURIComponent(term)}`,
  longman: (term) => `https://www.ldoceonline.com/dictionary/${encodeURIComponent(term)}`,
  macmillan: (term) => `https://www.macmillandictionary.com/dictionary/british/${encodeURIComponent(term)}`,
  google_trans: (term, from, to) => `https://translate.google.com/?sl=${from}&tl=${to}&text=${encodeURIComponent(term)}&op=translate`,
  deepl_trans: (term, from, to) => `https://www.deepl.com/translator#${from}/${to}/${encodeURIComponent(term)}`,
  papago_trans: (term, from, to) => `https://papago.naver.com/?sk=${from}&tk=${to}&st=${encodeURIComponent(term)}`,
  naver_kr: (term) => `https://ko.dict.naver.com/search.nhn?query=${encodeURIComponent(term)}`,
  daum_kr: (term) => `https://dic.daum.net/search.do?q=${encodeURIComponent(term)}`,
  papago_ko: (term) => `https://papago.naver.com/?sk=ja&tk=ko&st=${encodeURIComponent(term)}`,
  google_ko: (term) => `https://translate.google.com/?sl=ja&tl=ko&text=${encodeURIComponent(term)}&op=translate`,
  jisho: (term) => `https://jisho.org/search/${encodeURIComponent(term)}`,
  alc: (term) => `https://eow.alc.co.jp/search?q=${encodeURIComponent(term)}`,
  weblio_ej: (term) => `https://ejje.weblio.jp/content/${encodeURIComponent(term)}`,
  deepl_ej: (term) => `https://www.deepl.com/translator#ja/en/${encodeURIComponent(term)}`,
  naver_ja_ko: (term) => `https://ja.dict.naver.com/search.nhn?query=${encodeURIComponent(term)}`,
  daum_ja_ko: (term) => `https://dic.daum.net/search.do?q=${encodeURIComponent(term)}&dic=jp`,
  papago_jk: (term) => `https://papago.naver.com/?sk=ja&tk=ko&st=${encodeURIComponent(term)}`,
  google_jk: (term) => `https://translate.google.com/?sl=ja&tl=ko&text=${encodeURIComponent(term)}&op=translate`,
  naver_zh: (term) => `https://zh.dict.naver.com/search.nhn?query=${encodeURIComponent(term)}`,
  baidu_zh: (term) => `https://dict.baidu.com/s?wd=${encodeURIComponent(term)}`,
  google_zh: (term) => `https://translate.google.com/?sl=ja&tl=zh-CN&text=${encodeURIComponent(term)}&op=translate`,
  papago_zh: (term) => `https://papago.naver.com/?sk=ja&tk=zh-CN&st=${encodeURIComponent(term)}`
};

// ---- API モード専用のホーム ----
// 設定の「検索結果の取得元」が「MALU の画面」のとき、外部辞書のタブ・ボタンのかわりに、取得元（API）を選ぶ画面になる
const API_ACCENT = '#2563eb'; // SK's Blue
const API_SOURCES = [
  { key: 'auto', label: t('おまかせ'), hint: t('入力した文字に合わせて、ふさわしい取得元を自動で選びます。') },
  { key: 'wikt', label: t('ウィクショナリー（日本語版）'), hint: t('ほとんどの言語の語を、日本語の意味で引けます。') },
  { key: 'wp', label: t('ウィキペディア'), hint: t('人名・地名・用語などの要約を引けます。') },
  { key: 'en', label: t('英語の定義'), hint: t('英単語の発音・品詞・英語での定義と用例を引けます。') },
  { key: 'enwikt', label: t('Wiktionary（英語版）'), hint: t('英語で書かれた語義です。語源や活用までくわしく引けます。') }
];
const API_HISTORY_KEY = 'maluApiHistory';
const apiForm = document.getElementById('api-form');
const apiQuery = document.getElementById('api-query');
const apiSourceRow = document.getElementById('api-source-row');
const apiSourceHint = document.getElementById('api-source-hint');
const apiHistoryBox = document.getElementById('api-history');

function isApiMode() {
  return settings.resultSource === 'api';
}

function getApiSources() {
  const known = API_SOURCES.map((s) => s.key);
  const list = Array.isArray(settings.apiSources) ? settings.apiSources.filter((k) => known.includes(k)) : [];
  return list.length ? list : ['auto'];
}

function renderApiSources() {
  if (!apiSourceRow) return;
  const active = getApiSources();
  apiSourceRow.innerHTML = '';
  API_SOURCES.forEach((source) => {
    const on = active.includes(source.key);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `dict-pill${on ? ' active' : ''}`;
    button.setAttribute('aria-pressed', String(on));
    const label = document.createElement('span');
    label.textContent = source.label;
    button.appendChild(label);
    button.addEventListener('click', () => {
      let next;
      if (source.key === 'auto') {
        next = ['auto'];
      } else {
        const without = active.filter((k) => k !== 'auto' && k !== source.key);
        next = on ? without : without.concat(source.key);
      }
      settings.apiSources = next.length ? next : ['auto'];
      saveSettings();
      renderApiSources();
    });
    apiSourceRow.appendChild(button);
  });
  if (apiSourceHint) {
    const hints = active.map((k) => (API_SOURCES.find((s) => s.key === k) || {}).hint).filter(Boolean);
    apiSourceHint.textContent = hints.join(' ');
  }
}

function loadApiHistory() {
  try {
    const stored = JSON.parse(localStorage.getItem(API_HISTORY_KEY));
    return Array.isArray(stored) ? stored : [];
  } catch (error) {
    return [];
  }
}

function addApiHistory(term) {
  const list = loadApiHistory().filter((w) => w !== term);
  list.unshift(term);
  try { localStorage.setItem(API_HISTORY_KEY, JSON.stringify(list.slice(0, 30))); } catch (error) { /* 保存できなくても検索はできる */ }
}

function renderApiHistory() {
  if (!apiHistoryBox) return;
  apiHistoryBox.innerHTML = '';
  const title = document.createElement('p');
  title.className = 'search-history-title';
  title.textContent = t('検索履歴');
  apiHistoryBox.appendChild(title);
  const words = loadApiHistory().slice(0, 8);
  if (!words.length) {
    const empty = document.createElement('p');
    empty.className = 'history-empty';
    empty.textContent = t('検索履歴はまだありません。');
    apiHistoryBox.appendChild(empty);
    return;
  }
  const list = document.createElement('div');
  list.className = 'history-list';
  words.forEach((word) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'history-item';
    const span = document.createElement('span');
    span.className = 'history-item-term';
    span.textContent = word;
    button.appendChild(span);
    button.addEventListener('click', () => {
      apiQuery.value = word;
      apiQuery.focus();
    });
    list.appendChild(button);
  });
  apiHistoryBox.appendChild(list);
}

// ホームの中身を、上から順に入れ替わる動きで出す（切り替えは設定の裏で起きるので、設定を閉じたときに見せる）
let modeSwitchPending = false;
function playModeSwitch() {
  modeSwitchPending = false;
  const blocks = Array.from(document.querySelectorAll('.content > *')).filter((node) => node.offsetParent !== null);
  blocks.forEach((node, index) => {
    node.classList.remove('mode-switch');
    node.style.setProperty('--i', String(index));
  });
  void document.body.offsetWidth; // アニメーションを最初からやり直す
  blocks.forEach((node) => {
    node.classList.add('mode-switch');
    node.addEventListener('animationend', () => node.classList.remove('mode-switch'), { once: true });
  });
}

function applyApiMode() {
  document.body.classList.toggle('api-mode', isApiMode());
  if (isApiMode()) {
    renderApiSources();
    renderApiHistory();
  }
  applyColorScheme();
}

if (apiForm) {
  apiForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (isOffline) return;
    const text = apiQuery.value.trim();
    if (!text) { apiQuery.focus(); return; }
    addApiHistory(text);
    renderApiHistory();
    const query = new URLSearchParams({ q: text, src: getApiSources().join(',') });
    window.open('/dictionary/result/?' + query.toString(), getResultTarget());
  });
}

function getSelectedAccentColor() {
  if (isApiMode()) return API_ACCENT;
  return DICTIONARY_THEME_COLORS[selectedDictionary] || categories[selectedCategory].color;
}

function setAccent(color) {
  applyColorScheme(color);
}

function animateElement(element, className, duration = 320) {
  if (!element || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
  window.setTimeout(() => {
    element.classList.remove(className);
  }, duration);
}

function updateDictionaryButtonSelection() {
  const buttons = dictionarySelectRow.querySelectorAll('.dict-pill');
  buttons.forEach((button) => {
    const isActive = button.dataset.dictionary === selectedDictionary;
    const wasActive = button.classList.contains('active');
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
    if (isActive && !wasActive) {
      animateElement(button, 'dict-pill--selected');
    }
  });
}

function renderDictionaryButtons() {
  const category = categories[selectedCategory];
  dictionarySelectRow.innerHTML = '';
  dictionaryPanel.classList.remove('hide');
  dictionarySelectRow.setAttribute('aria-label', t('辞書選択'));

  category.dictionaries.forEach((dictionary) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `dict-pill ${dictionary.key}${dictionary.key === selectedDictionary ? ' active' : ''}`;
    button.setAttribute('aria-pressed', String(dictionary.key === selectedDictionary));
    if (isOffline) {
      button.classList.add('disabled');
      button.disabled = true;
    }
    button.dataset.dictionary = dictionary.key;

    const iconSpan = document.createElement('span');
    iconSpan.className = 'dict-pill-icon';
    iconSpan.setAttribute('aria-hidden', 'true');
    iconSpan.textContent = dictionary.icon || '';
    button.appendChild(iconSpan);

    const labelSpan = document.createElement('span');
    labelSpan.textContent = dictionary.label;
    button.appendChild(labelSpan);

    button.addEventListener('click', () => {
      if (isOffline) return;
      handleDictionarySelection(dictionary.key);
      queryInput.focus();
    });
    dictionarySelectRow.appendChild(button);
  });
  animateElement(dictionarySelectRow, 'dictionary-select--enter', 360);
}

function showInstallBanner() {
  if (installBanner) {
    installBanner.classList.remove('hide');
  }
}

function hideInstallBanner() {
  if (installBanner) {
    installBanner.classList.add('hide');
  }
}

function openSettings() {
  updateClearHistoryState();
  // スマホでは、開くたびにカテゴリの一覧から
  if (typeof showSettingsList === 'function') showSettingsList();
  if (settingsSearch) { settingsSearch.value = ''; filterSettings(); }
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    if (mainView) mainView.classList.add('hide');
    if (settingsOverlay) settingsOverlay.classList.remove('hide');
    if (settingsClose) settingsClose.focus();
    return;
  }

  if (mainView) {
    mainView.classList.add('view-exit');
  }
  window.setTimeout(() => {
    if (mainView) {
      mainView.classList.add('hide');
      mainView.classList.remove('view-exit');
    }
    if (settingsOverlay) {
      settingsOverlay.classList.remove('hide');
      animateElement(settingsOverlay, 'settings-view--enter', 360);
    }
    if (settingsClose) {
      settingsClose.focus();
    }
  }, 180);
}

function closeSettings() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    if (settingsOverlay) settingsOverlay.classList.add('hide');
    if (mainView) mainView.classList.remove('hide');
    if (settingsButton) settingsButton.focus();
    if (modeSwitchPending) playModeSwitch();
    return;
  }

  if (settingsOverlay) {
    settingsOverlay.classList.add('settings-view--leave');
  }
  window.setTimeout(() => {
    if (settingsOverlay) {
      settingsOverlay.classList.add('hide');
      settingsOverlay.classList.remove('settings-view--leave');
    }
    if (mainView) {
      mainView.classList.remove('hide');
      animateElement(mainView, 'view-enter', 320);
      if (modeSwitchPending) playModeSwitch();
    }
    if (settingsButton) {
      settingsButton.focus();
    }
  }, 220);
}

function showSettingsSection(sectionId) {
  settingsSections.forEach((section) => {
    section.classList.toggle('settings-section--active', section.id === sectionId);
  });

  settingsNavItems.forEach((navItem) => {
    navItem.classList.toggle('active', navItem.dataset.settingsTarget === sectionId);
  });
}

function clearSearchHistory() {
  if (!searchHistory.length) {
    alert(t('削除できる検索履歴がありません。'));
    updateClearHistoryState();
    return;
  }
  const shouldClear = window.confirm(t('検索履歴をすべて削除します。よろしいですか？'));
  if (!shouldClear) return;
  searchHistory = [];
  saveSearchHistory();
  renderSearchHistory();
  updateClearHistoryState();
  notifyAccount('clear');
  alert(t('検索履歴を削除しました。'));
}

function updateClearHistoryState() {
  const historyCount = searchHistory.length;
  if (clearHistoryStatus) {
    clearHistoryStatus.textContent = t('保存件数: {n}件', { n: historyCount });
  }
  if (clearHistoryButton) {
    clearHistoryButton.disabled = historyCount === 0;
  }
}

function resetCacheAndReload() {
  if ('caches' in window) {
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith('dictionary-'))
          .map((cacheName) => caches.delete(cacheName))
      ))
      .finally(() => {
        window.location.reload();
      });
  } else {
    window.location.reload();
  }
}

function updateNetworkStatusLabel() {
  if (networkStatus) {
    networkStatus.textContent = t('現在: {state}', { state: navigator.onLine ? t('オンライン') : t('オフライン') });
  }
}

function checkForUpdates() {
  if (aboutUpdateStatus) {
    aboutUpdateStatus.textContent = t('更新を確認しています...');
  }
  if (pwaUpdateStatus) {
    pwaUpdateStatus.textContent = t('更新を確認しています...');
  }

  window.setTimeout(() => {
    if (aboutUpdateStatus) {
      aboutUpdateStatus.textContent = t('MALU は最新です');
    }
    if (pwaUpdateStatus) {
      pwaUpdateStatus.textContent = t('MALU は最新です。');
    }
  }, 600);
}

async function checkForServiceWorkerUpdates() {
  if (aboutUpdateStatus) {
    aboutUpdateStatus.textContent = t('更新を確認しています...');
  }
  if (pwaUpdateStatus) {
    pwaUpdateStatus.textContent = t('更新を確認しています...');
  }

  if (!('serviceWorker' in navigator)) {
    if (aboutUpdateStatus) {
      aboutUpdateStatus.textContent = t('Service Worker は使用できません。');
    }
    if (pwaUpdateStatus) {
      pwaUpdateStatus.textContent = t('Service Worker は使用できません。');
    }
    return;
  }

  try {
    const registration = serviceWorkerRegistration || await navigator.serviceWorker.getRegistration();
    if (!registration) {
      throw new Error('Service Worker registration not found');
    }

    serviceWorkerRegistration = registration;
    await registration.update();

    const hasUpdate = Boolean(registration.waiting || registration.installing);
    const message = hasUpdate
      ? t('更新を見つけました。再読み込みで反映します。')
      : t('MALU は最新です。');

    if (aboutUpdateStatus) {
      aboutUpdateStatus.textContent = message;
    }
    if (pwaUpdateStatus) {
      pwaUpdateStatus.textContent = message;
    }
  } catch (error) {
    if (aboutUpdateStatus) {
      aboutUpdateStatus.textContent = t('更新の確認に失敗しました。');
    }
    if (pwaUpdateStatus) {
      pwaUpdateStatus.textContent = t('更新の確認に失敗しました。');
    }
    console.log('Service Worker update check failed:', error);
  }
}

function updateCategorySelection() {
  categoryButtons.forEach((button) => {
    const isActive = button.dataset.category === selectedCategory;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
  const category = categories[selectedCategory];
  if (!category.dictionaries.some((dict) => dict.key === selectedDictionary)) {
    selectedDictionary = category.dictionaries[0].key;
  }
  setAccent(getSelectedAccentColor());
  renderDictionaryButtons();
  renderSearchHistory();
}

function handleDictionarySelection(dictionaryKey) {
  if (selectedDictionary === dictionaryKey) return;
  selectedDictionary = dictionaryKey;
  setAccent(getSelectedAccentColor());
  updateDictionaryButtonSelection();
  notifyAccount('selection');
}

// 言葉と辞書を選んだ状態にする（単語帳・検索履歴から）
function useWord(term, dictionaryKey) {
  const category = findCategoryForDictionary(dictionaryKey);
  if (category) {
    selectedCategory = category;
    selectedDictionary = dictionaryKey;
    updateCategorySelection();
  }
  queryInput.value = term;
  notifyAccount('selection');
  queryInput.focus();
}

// SK Hub Systems アカウントとの連携（account.js）から使う入口
window.MALU = {
  t,
  getHistory: () => searchHistory.slice(),
  setHistory(list) {
    searchHistory = list;
    saveSearchHistory();
    renderSearchHistory();
    updateClearHistoryState();
  },
  current: () => ({ term: queryInput.value.trim(), dictionary: selectedDictionary }),
  dictionaryLabel: getDictionaryLabel,
  categoryLabel: (dictionaryKey) => {
    const key = findCategoryForDictionary(dictionaryKey);
    return key ? categories[key].label : '';
  },
  useWord,
  onChange: null
};

function setOfflineMode(value) {
  isOffline = value;
  if (offlineOverlay) {
    offlineOverlay.classList.toggle('hide', !value);
  }
  if (queryInput) {
    queryInput.disabled = value;
  }
  if (searchButton) {
    searchButton.disabled = value;
  }
  categoryButtons.forEach((button) => {
    button.disabled = value;
  });
  renderDictionaryButtons();
}

function updateOnlineStatus() {
  setOfflineMode(!navigator.onLine);
  updateNetworkStatusLabel();
}

window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);
const colorSchemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
const handleColorSchemeChange = () => {
  if (settings.theme === 'auto') {
    applyTheme();
  }
};
if (colorSchemeQuery.addEventListener) {
  colorSchemeQuery.addEventListener('change', handleColorSchemeChange);
} else if (colorSchemeQuery.addListener) {
  colorSchemeQuery.addListener(handleColorSchemeChange);
}


function updateTime() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const weekdayNames = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'];
  const weekday = weekdayNames[now.getDay()];
  const lang = window.SKI18N ? window.SKI18N.lang : 'ja';
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const currentDate = document.getElementById('current-date');
  if (currentDate) {
    // 日本語以外は、その言語の書き方（例: Saturday, September 26, 2026）
    currentDate.textContent = lang === 'ja'
      ? `${year}年${month}月${day}日 ${weekday}`
      : now.toLocaleDateString(window.SKI18N.locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }
  currentTime.textContent = `${hours}:${minutes}`;
}

categoryButtons.forEach((button) => {
  button.addEventListener('click', () => {
    selectedCategory = button.dataset.category;
    updateCategorySelection();
    notifyAccount('selection');
    queryInput.focus();
  });
});

queryInput.addEventListener('input', () => notifyAccount('selection'));

if (settingsButton) {
  settingsButton.addEventListener('click', openSettings);
}

// スマホ（せまい画面）: Android の設定アプリと同じく、最初はカテゴリの一覧だけ。押すと中身に切りかわり（is-detail）、戻るボタンで一覧に戻る
const settingsLayout = document.querySelector('.settings-layout');
const settingsSearch = document.getElementById('settings-search');
const isNarrow = () => window.matchMedia('(max-width: 820px)').matches;
function showSettingsList() {
  if (settingsLayout) settingsLayout.classList.remove('is-detail');
}
// 設定を検索: カテゴリの名前・要約と、そのページの中の文字で、一覧をしぼる
function filterSettings() {
  const v = settingsSearch ? settingsSearch.value.trim().toLowerCase() : '';
  let any = false;
  settingsNavItems.forEach((item) => {
    const sec = document.getElementById(item.dataset.settingsTarget);
    const hit = !v || `${item.textContent} ${sec ? sec.textContent : ''}`.toLowerCase().includes(v);
    item.hidden = !hit;
    if (hit) any = true;
  });
  const none = document.getElementById('settings-search-none');
  if (none) none.hidden = any;
}
if (settingsSearch) settingsSearch.addEventListener('input', filterSettings);

if (settingsClose) {
  settingsClose.addEventListener('click', () => {
    if (isNarrow() && settingsLayout && settingsLayout.classList.contains('is-detail')) { showSettingsList(); return; }
    closeSettings();
  });
}

settingsNavItems.forEach((item) => {
  item.addEventListener('click', (event) => {
    event.preventDefault();
    if (settingsLayout) settingsLayout.classList.add('is-detail');
    showSettingsSection(item.dataset.settingsTarget);
  });
});

if (clearHistoryButton) {
  clearHistoryButton.addEventListener('click', clearSearchHistory);
}

if (resetCacheButton) {
  resetCacheButton.addEventListener('click', resetCacheAndReload);
}

if (checkUpdateButton) {
  checkUpdateButton.addEventListener('click', checkForServiceWorkerUpdates);
}

if (pwaInstallButton) {
  pwaInstallButton.addEventListener('click', handleInstallPrompt);
}

if (pwaCheckUpdateButton) {
  pwaCheckUpdateButton.addEventListener('click', checkForServiceWorkerUpdates);
}

if (pwaResetCacheButton) {
  pwaResetCacheButton.addEventListener('click', resetCacheAndReload);
}

document.addEventListener('pointerdown', (event) => {
  const target = event.target.closest(RIPPLE_SELECTOR);
  if (!target || target.disabled || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const rect = target.getBoundingClientRect();
  const size = Math.hypot(rect.width, rect.height) * 2;
  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  ripple.style.width = `${size}px`;
  ripple.style.height = `${size}px`;
  ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
  ripple.style.top = `${event.clientY - rect.top - size / 2}px`;
  target.appendChild(ripple);
  ripple.addEventListener('animationend', () => ripple.remove());
});

window.addEventListener('scroll', () => {
  if (topAppBar) {
    topAppBar.classList.toggle('is-scrolled', window.scrollY > 0);
  }
}, { passive: true });

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && settingsOverlay && !settingsOverlay.classList.contains('hide')) {
    closeSettings();
  }
});

if (installButton) {
  installButton.addEventListener('click', handleInstallPrompt);
}

if (installDismiss) {
  installDismiss.addEventListener('click', hideInstallBanner);
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  showInstallBanner();
  updatePwaInstallState();
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  hideInstallBanner();
  updatePwaInstallState();
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (isOffline) {
    return;
  }
  const text = queryInput.value.trim();
  if (!text) {
    queryInput.focus();
    return;
  }
  addSearchHistory(text, selectedDictionary);
  renderSearchHistory();
  const urlBuilder = dictionaryUrls[selectedDictionary];
  if (!urlBuilder) {
    alert(t('辞書を選択してください。'));
    return;
  }
  const url = urlBuilder(text);
  window.open(url, getResultTarget());
});

window.addEventListener('DOMContentLoaded', () => {
  applySettings();
  applyTheme();
  populateDefaultDictionarySelect();
  updateOpenModeInputs();
  updateResultSourceInputs();
  updateThemeModeInputs();
  bindSettingsEvents();
  applyApiMode();
  updateClearHistoryState();
  if (appVersion) {
    appVersion.textContent = APP_VERSION;
    // ビルド … この端末に入っている Service Worker のキャッシュの番号（dictionary/sw.js の CACHE_NAME）
    if (window.caches && caches.keys) {
      caches.keys().then((names) => {
        let build = 0;
        names.forEach((n) => { const m = /^dictionary-v(\d+)$/.exec(n); if (m) build = Math.max(build, Number(m[1])); });
        if (build) appVersion.textContent = t('{version}（ビルド {build}）', { version: APP_VERSION, build });
      }).catch(() => {});
    }
  }
  updateCategorySelection();
  updatePwaInstallState();
  updateTime();
  setInterval(updateTime, 60_000);
  updateOnlineStatus();
  queryInput.focus();
  
  // Service Worker の登録
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then((registration) => {
      serviceWorkerRegistration = registration;
      console.log('Service Worker registered:', registration);
    }).catch((error) => {
      console.log('Service Worker registration failed:', error);
    });
  }
});
