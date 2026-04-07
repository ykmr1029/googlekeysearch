/**
 * GoogleKeySearch - Content Script
 * Google検索ページにキーボードショートカットを追加する
 */

const DEFAULT_KEYS = {
  nextSuggestion: 'j',
  prevSuggestion: 'k',
  tabAll:         'a',
  tabImages:      'i',
  tabVideos:      'v',
  tabMaps:        'm',
  tabShopping:    's',
  tabNews:        'n',
  nextPage:       'l',
  prevPage:       'h',
};

// タブのテキスト（日本語・英語対応）
const TAB_TEXTS = {
  tabAll:      ['すべて', 'All'],
  tabImages:   ['画像', 'Images'],
  tabVideos:   ['動画', 'Videos'],
  tabMaps:     ['地図', 'Maps'],
  tabShopping: ['ショッピング', 'Shopping'],
  tabNews:     ['ニュース', 'News'],
};

// キーマップバーに表示するラベル
const TAB_LABELS = {
  tabAll:      'すべて',
  tabImages:   '画像',
  tabVideos:   '動画',
  tabMaps:     '地図',
  tabShopping: 'ショッピング',
  tabNews:     'ニュース',
};

let keys = { ...DEFAULT_KEYS };

// 検索結果ナビゲーションの現在インデックス（-1 = 未選択）
let resultNavIndex = -1;

// 検索候補ナビゲーションの状態
let suggestionNavIndex   = -1;
let suggestionOrigValue  = '';  // j/k 押下前の入力値を保持する

// ストレージからキー設定を読み込む
chrome.storage.sync.get('keys', (data) => {
  if (data.keys) {
    keys = { ...DEFAULT_KEYS, ...data.keys };
  }
  injectStyles();
  setupSuggestionHighlight();
  setupKeymapInjection();
});

// 設定変更をリアルタイムに反映（ポップアップからのメッセージを優先）
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'kws:keysUpdated') {
    keys = { ...DEFAULT_KEYS, ...message.keys };
    updateKeymapEl();
  }
});

// storage.onChanged はバックアップとして残す
chrome.storage.onChanged.addListener((changes) => {
  if (changes.keys) {
    keys = { ...DEFAULT_KEYS, ...changes.keys.newValue };
    updateKeymapEl();
  }
});

document.addEventListener('keydown', handleKeydown, true);

// ---- キーボードハンドリング ----------------------------------------

function handleKeydown(e) {
  if (e.ctrlKey || e.altKey || e.metaKey) return;

  const activeEl = document.activeElement;
  const isInInput =
    activeEl &&
    (activeEl.tagName === 'INPUT' ||
      activeEl.tagName === 'TEXTAREA' ||
      activeEl.isContentEditable);

  const suggestionsOpen = isSuggestionsVisible();

  // 検索候補ナビゲーション (j/k) — 候補ドロップダウンが開いているときのみ
  if (suggestionsOpen) {
    if (e.key === keys.nextSuggestion) {
      e.preventDefault();
      e.stopPropagation();
      navigateSuggestion('down');
      return;
    }
    if (e.key === keys.prevSuggestion) {
      e.preventDefault();
      e.stopPropagation();
      navigateSuggestion('up');
      return;
    }
  }

  // 以降は入力フィールドにフォーカス中は無効
  if (isInInput) return;

  // 検索結果 Enter で開く
  if (e.key === 'Enter' && resultNavIndex >= 0) {
    e.preventDefault();
    openSelectedResult();
    return;
  }

  // 検索結果ナビゲーション (j/k) — 候補ドロップダウンが閉じているとき
  if (!suggestionsOpen) {
    if (e.key === keys.nextSuggestion) {
      e.preventDefault();
      navigateResult('down');
      return;
    }
    if (e.key === keys.prevSuggestion) {
      e.preventDefault();
      navigateResult('up');
      return;
    }
  }

  // ページ送り
  if (e.key === keys.nextPage) {
    e.preventDefault();
    navigatePage('next');
    return;
  }
  if (e.key === keys.prevPage) {
    e.preventDefault();
    navigatePage('prev');
    return;
  }

  // タブ切り替えショートカット
  const tabKeyMap = buildTabKeyMap();
  if (tabKeyMap[e.key]) {
    e.preventDefault();
    clickTab(tabKeyMap[e.key]);
  }
}

function buildTabKeyMap() {
  return {
    [keys.tabAll]:      TAB_TEXTS.tabAll,
    [keys.tabImages]:   TAB_TEXTS.tabImages,
    [keys.tabVideos]:   TAB_TEXTS.tabVideos,
    [keys.tabMaps]:     TAB_TEXTS.tabMaps,
    [keys.tabShopping]: TAB_TEXTS.tabShopping,
    [keys.tabNews]:     TAB_TEXTS.tabNews,
  };
}

/** 検索入力フィールドを返す */
function getSearchInput() {
  return (
    document.querySelector('input[name="q"]:not([type="hidden"])') ||
    document.querySelector('textarea[name="q"]')
  );
}

/**
 * 表示中の候補リストアイテムを返す。
 * Google の KeyboardEvent は isTrusted=false だと無視されることがあるため、
 * DOM を直接操作して候補ナビゲーションを行う。
 *
 * Google の候補 DOM は以下のような入れ子になることがある:
 *   <div role="option">          ← グループコンテナ（複数候補をまとめる）
 *     <li role="option">...</li> ← 個別候補アイテム
 *     <li role="option">...</li>
 *   </div>
 * querySelectorAll で全子孫を取得すると親コンテナも含まれ、
 * コンテナ選択時に複数候補がまとめてハイライトされてしまう。
 * そのため、子孫に role="option" を持たないリーフノードのみを対象とする。
 */
function getSuggestionItems() {
  const listboxSelectors = [
    '[role="listbox"]',
    '[jsname="aajZCb"]',
    '.erkvQe',
  ];
  for (const sel of listboxSelectors) {
    const listbox = document.querySelector(sel);
    if (!listbox) continue;
    const cs = window.getComputedStyle(listbox);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;

    const allOptions = [...listbox.querySelectorAll('[role="option"]')]
      .filter((el) => el.offsetParent !== null && el.offsetHeight > 0);

    // 子孫に role="option" を持たないリーフノードを優先する
    const leafItems = allOptions.filter((el) => !el.querySelector('[role="option"]'));
    if (leafItems.length > 0) return leafItems;

    // リーフノードが見つからない場合は全候補を返す（フォールバック）
    if (allOptions.length > 0) return allOptions;
  }
  return [];
}

/** 候補アイテムから検索クエリのテキストを抽出する */
function getSuggestionText(item) {
  // aria-label は "term, 検索" 形式のことが多いので末尾を除去
  const ariaLabel = item.getAttribute('aria-label') || '';
  if (ariaLabel) {
    return ariaLabel.replace(/[,、]\s*(検索|Search|ウェブ検索).*/i, '').trim();
  }
  // data-suggestion 属性
  const ds = item.dataset.suggestion || item.dataset.term;
  if (ds) return ds.trim();
  // aria-hidden でない最初の span のテキスト
  for (const span of item.querySelectorAll('span')) {
    if (span.getAttribute('aria-hidden') === 'true') continue;
    const t = span.textContent.trim();
    if (t) return t;
  }
  // フォールバック: 先頭行テキスト
  return item.textContent.trim().split('\n')[0].trim();
}

function isSuggestionsVisible() {
  return getSuggestionItems().length > 0;
}

/**
 * 検索候補を自前でナビゲートする。
 * Google の isTrusted チェックをバイパスするため、
 * DOM から候補を取得して直接選択状態を管理する。
 */
function navigateSuggestion(direction) {
  const items = getSuggestionItems();
  if (items.length === 0) return;

  const searchInput = getSearchInput();

  // 初回ナビゲーション前の入力値を保存
  if (suggestionNavIndex === -1 && searchInput) {
    suggestionOrigValue = searchInput.value;
  }

  // 既存ハイライトをクリア
  document.querySelectorAll('.kws-selected')
    .forEach((el) => el.classList.remove('kws-selected'));

  if (direction === 'down') {
    suggestionNavIndex =
      suggestionNavIndex < items.length - 1 ? suggestionNavIndex + 1 : -1;
  } else {
    suggestionNavIndex =
      suggestionNavIndex > -1 ? suggestionNavIndex - 1 : items.length - 1;
  }

  if (suggestionNavIndex >= 0) {
    const selected = items[suggestionNavIndex];
    selected.classList.add('kws-selected');
    selected.scrollIntoView({ block: 'nearest' });

    // 入力フィールドに候補テキストを反映
    if (searchInput) {
      const text = getSuggestionText(selected);
      if (text) {
        searchInput.value = text;
        // React / Google の内部状態に変化を通知
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  } else {
    // インデックスが -1 に戻ったら元の入力値を復元
    if (searchInput) {
      searchInput.value = suggestionOrigValue;
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
}

// ---- 検索結果ナビゲーション ----------------------------------------

/**
 * Google 検索結果の各カードを取得する
 * Google の DOM は頻繁に変わるため、複数セレクタでフォールバック
 *
 * 2026年現在の Google DOM 構造:
 *   <div class="tF2Cxc">          ← 各検索結果コンテナ（旧 .g は廃止）
 *     <div class="yuRUbf">
 *       <a class="zReHs">
 *         <h3 class="LC20lb ...">タイトル</h3>  ← メインタイトル
 *       </a>
 *     </div>
 *     <table class="jmjoTe">      ← サイトリンク（存在する場合のみ）
 *       <h3 class="QnNiCc">...</h3>  ← サイトリンクの見出し
 *     </table>
 *   </div>
 *
 * メインタイトルは h3.LC20lb、サイトリンク見出しは h3.QnNiCc で区別できる。
 * tF2Cxc かつ h3.LC20lb を持つ要素が各検索結果カード。
 */
function getSearchResults() {
  // 手段 1: 現行 Google DOM — tF2Cxc がコンテナクラス、h3.LC20lb がメインタイトル
  let results = [...document.querySelectorAll('div.tF2Cxc')]
    .filter((el) => el.querySelector('h3.LC20lb'));

  if (results.length >= 2) {
    return results.filter((el) => el.getBoundingClientRect().height > 40);
  }

  // 手段 2: #rso 内の .g（旧 DOM 向けフォールバック）
  const rso = document.querySelector('#rso');
  if (rso) {
    results = [...rso.querySelectorAll('.g')]
      .filter((el) => !el.querySelector('.g'));

    if (results.length < 2) {
      results = [...rso.querySelectorAll('[data-hveid]')].filter(
        (el) => el.querySelector('h3') && !el.closest('[data-hveid] [data-hveid]')
      );
    }

    if (results.length < 2) {
      results = [...rso.children].filter((el) => el.querySelector('a h3, h3 a'));
    }
  }

  // 高さが十分あるものだけを対象にする（広告バナー等を除外）
  return results.filter((el) => el.getBoundingClientRect().height > 40);
}

/**
 * 検索結果を上下にナビゲートし、選択中カードを枠で囲む
 * @param {'down'|'up'} direction
 */
function navigateResult(direction) {
  const results = getSearchResults();
  if (results.length === 0) return;

  // 既存のハイライトを解除
  results.forEach((el) => el.classList.remove('kws-result-selected'));

  if (direction === 'down') {
    resultNavIndex = resultNavIndex < results.length - 1 ? resultNavIndex + 1 : 0;
  } else {
    resultNavIndex = resultNavIndex > 0 ? resultNavIndex - 1 : results.length - 1;
  }

  const selected = results[resultNavIndex];
  if (selected) {
    selected.classList.add('kws-result-selected');
    selected.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

/**
 * 選択中の検索結果のメインリンクを開く
 */
function openSelectedResult() {
  const results = getSearchResults();
  const selected = results[resultNavIndex];
  if (!selected) return;

  // メインタイトルリンクを取得（a.zReHs が現行 Google の標準クラス）
  const titleLink =
    selected.querySelector('a.zReHs') ||
    selected.querySelector('h3.LC20lb')?.closest('a') ||
    selected.querySelector('a:has(h3.LC20lb)') ||
    selected.querySelector('.yuRUbf a') ||
    selected.querySelector('a[href^="http"], a[href^="/url"]');

  if (titleLink) titleLink.click();
}

/**
 * 検索結果の次/前のページへ移動する。
 * DOM の次へ/前へリンクを優先し、見つからなければ URL の start パラメータで制御する。
 * @param {'next'|'prev'} direction
 */
function navigatePage(direction) {
  if (direction === 'next') {
    const link =
      document.getElementById('pnnext') ||
      document.querySelector(
        'a[aria-label*="次"], a[aria-label*="Next"], a[aria-label*="next"]'
      );
    if (link) { link.click(); return; }

    // URL フォールバック: start を 10 増やす
    const url = new URL(location.href);
    const start = parseInt(url.searchParams.get('start') || '0', 10);
    url.searchParams.set('start', String(start + 10));
    location.href = url.toString();

  } else {
    const link =
      document.getElementById('pnprev') ||
      document.querySelector(
        'a[aria-label*="前"], a[aria-label*="Previous"], a[aria-label*="previous"], a[aria-label*="Prev"]'
      );
    if (link) { link.click(); return; }

    // URL フォールバック: start を 10 減らす（0 未満にはしない）
    const url = new URL(location.href);
    const start = parseInt(url.searchParams.get('start') || '0', 10);
    if (start <= 0) return;
    const newStart = start - 10;
    if (newStart <= 0) {
      url.searchParams.delete('start');
    } else {
      url.searchParams.set('start', String(newStart));
    }
    location.href = url.toString();
  }
}

function clickTab(textOptions) {
  // すべてタブは DOM 検索より URL 操作を優先する。
  // 理由: 画像・動画タブ等では「すべて」リンクの DOM 構造が異なり
  //       クリックが効かない場合がある。URL から tbm/udm を削除するのが確実。
  const isAllTab = textOptions.some((t) => t === 'すべて' || t === 'All');
  if (isAllTab) {
    const url = new URL(location.href);
    url.searchParams.delete('tbm');
    url.searchParams.delete('udm');
    location.href = url.toString();
    return;
  }

  // その他のタブは DOM から探してクリック
  const navSelectors = [
    'a.nPDzT', 'a.LatpMc',
    '#hdtb-msb a', '#top_nav a',
    'div[role="navigation"] a', 'nav a',
  ];
  for (const navSel of navSelectors) {
    const target = findLinkByText(document.querySelectorAll(navSel), textOptions);
    if (target) { target.click(); return; }
  }

  // tbm= / udm= パラメータを持つリンクから探す（画像・動画・ニュース等）
  const paramLinks = document.querySelectorAll('a[href*="tbm="], a[href*="udm="]');
  const paramTarget = findLinkByText(paramLinks, textOptions);
  if (paramTarget) paramTarget.click();
}

function findLinkByText(links, textOptions) {
  for (const link of links) {
    const text = link.textContent.trim();
    if (textOptions.some((t) => text === t || text.includes(t))) return link;
  }
  return null;
}

// ---- 検索候補のハイライト ------------------------------------------

/**
 * aria-activedescendant を監視し、実キー（↑↓）での操作にも
 * .kws-selected ハイライトを追従させる（j/k は navigateSuggestion で直接適用）
 */
function setupSuggestionHighlight() {
  const watchInput = () => {
    const searchInput = getSearchInput();
    if (!searchInput || searchInput._kwsWatched) return;
    searchInput._kwsWatched = true;

    // ユーザーがタイプしたら候補ナビゲーション状態をリセット
    searchInput.addEventListener('input', (e) => {
      // 自前の input イベント（候補選択時）は無視する
      if (e.isTrusted) {
        suggestionNavIndex  = -1;
        suggestionOrigValue = '';
        document.querySelectorAll('.kws-selected')
          .forEach((el) => el.classList.remove('kws-selected'));
      }
    });

    // Escape でも状態をリセット
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        suggestionNavIndex  = -1;
        suggestionOrigValue = '';
      }
    });
  };

  watchInput();
  setTimeout(watchInput, 1000);
}

// ---- スタイル注入 ---------------------------------------------------

function injectStyles() {
  if (document.getElementById('kws-styles')) return;
  const style = document.createElement('style');
  style.id = 'kws-styles';
  style.textContent = `
    /* 選択中の検索結果カードを枠で囲む */
    .kws-result-selected {
      outline: 2px solid #1a73e8 !important;
      outline-offset: 6px !important;
      border-radius: 8px !important;
    }

    /*
     * 選択中の検索候補をボーダーで囲む
     * - outline: overflow:hidden の親でクリップされる場合がある
     * - box-shadow inset: 要素内側に描画されクリップされにくい
     * 両方を指定して確実に表示する
     */
    [role="listbox"] [aria-selected="true"],
    [role="option"][aria-selected="true"],
    .kws-selected {
      outline: 2px solid #1a73e8 !important;
      outline-offset: -2px !important;
      box-shadow: inset 0 0 0 2px #1a73e8 !important;
      border-radius: 4px !important;
    }

    /* キーマップバー本体 */
    #kws-keymap {
      display: flex !important;
      flex-direction: row !important;
      flex-wrap: wrap !important;
      align-items: center !important;
      gap: 10px !important;
      padding: 4px 10px !important;
      font-size: 11px !important;
      color: #5f6368 !important;
      user-select: none !important;
      box-sizing: border-box !important;
      width: 100% !important;
      /* 万一 flex アイテムになっても先頭に出る */
      order: -9999 !important;
      flex-basis: 100% !important;
      /* Google のスタイルをリセット */
      margin: 0 !important;
      background: transparent !important;
      border: none !important;
    }
    #kws-keymap-heading {
      font-size: 10px !important;
      color: #9aa0a6 !important;
      margin-right: 2px !important;
    }
    #kws-keymap .kws-item {
      display: inline-flex !important;
      align-items: center !important;
      gap: 4px !important;
    }
    #kws-keymap .kws-key {
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      min-width: 18px !important;
      height: 18px !important;
      padding: 0 4px !important;
      border: 1px solid #bdc1c6 !important;
      border-bottom: 2px solid #bdc1c6 !important;
      border-radius: 3px !important;
      font-size: 10px !important;
      font-family: "SF Mono", "Consolas", "Menlo", monospace !important;
      font-weight: 700 !important;
      color: #3c4043 !important;
      background: #fff !important;
      line-height: 1 !important;
    }
    #kws-keymap .kws-tab-name {
      color: #5f6368 !important;
      font-size: 11px !important;
    }
  `;
  document.head.appendChild(style);
}

// ---- キーマップバー ------------------------------------------------

let keymapObserver = null;

function setupKeymapInjection() {
  tryInjectKeymap();

  if (keymapObserver) return;
  keymapObserver = new MutationObserver(debounce(() => {
    if (!document.getElementById('kws-keymap')) {
      tryInjectKeymap();
    }
  }, 300));
  keymapObserver.observe(document.body, { childList: true, subtree: true });
}

function tryInjectKeymap() {
  if (document.getElementById('kws-keymap')) return;

  const container = findTabsContainer();
  if (!container) return;

  const keymap = createKeymapEl();
  container.parentElement.insertBefore(keymap, container);
}

/**
 * キーマップを「タブ行の上」に挿入するための正しいコンテナを探す。
 *
 * 問題: タブ行の親がフレックス行（flex-direction:row）の場合、
 *       その子として挿入すると「行の左端アイテム」になってしまう。
 *
 * 解決: タブリンクを 3 本以上含む祖先のうち、
 *       「その親が縦方向レイアウト（block / column-flex）」である
 *       最初のものを返す。これにより insertBefore が真上への挿入になる。
 */
function findTabsContainer() {
  const allTabTexts = Object.values(TAB_TEXTS).flat();

  // タブリンクを 1 つ特定する
  let tabLink = null;
  for (const a of document.querySelectorAll('a')) {
    if (allTabTexts.includes(a.textContent.trim())) {
      tabLink = a;
      break;
    }
  }
  if (!tabLink) return null;

  let el = tabLink.parentElement;
  let fallback = null; // どうしても見つからない場合の退避

  while (el && el !== document.body) {
    const tabCount = [...el.querySelectorAll('a')]
      .filter((a) => allTabTexts.includes(a.textContent.trim())).length;

    if (tabCount >= 3) {
      if (!fallback) fallback = el;

      const parent = el.parentElement;
      if (parent) {
        const ps = window.getComputedStyle(parent);
        const isVertical =
          ps.display === 'block' ||
          ps.display === 'flow-root' ||
          ps.display === 'list-item' ||
          (ps.display.includes('flex') &&
            (ps.flexDirection === 'column' || ps.flexDirection === 'column-reverse'));

        if (isVertical) return el;
      }
    }

    el = el.parentElement;
  }

  // フォールバック: 縦方向親が見つからなくてもタブを含む最小コンテナを返す
  return fallback;
}

/**
 * キーマップバー要素を生成する
 */
function createKeymapEl() {
  const bar = document.createElement('div');
  bar.id = 'kws-keymap';

  const heading = document.createElement('span');
  heading.id = 'kws-keymap-heading';
  heading.textContent = '⌨';
  bar.appendChild(heading);

  const allDefs = [
    { id: 'nextSuggestion', label: '候補↓' },
    { id: 'prevSuggestion', label: '候補↑' },
    { id: 'tabAll',         label: TAB_LABELS.tabAll },
    { id: 'tabImages',      label: TAB_LABELS.tabImages },
    { id: 'tabVideos',      label: TAB_LABELS.tabVideos },
    { id: 'tabMaps',        label: TAB_LABELS.tabMaps },
    { id: 'tabShopping',    label: TAB_LABELS.tabShopping },
    { id: 'tabNews',        label: TAB_LABELS.tabNews },
    { id: 'nextPage',       label: '次ページ' },
    { id: 'prevPage',       label: '前ページ' },
  ];

  for (const { id, label } of allDefs) {
    const item = document.createElement('span');
    item.className = 'kws-item';
    item.dataset.keyId = id;

    const keyBadge = document.createElement('span');
    keyBadge.className = 'kws-key';
    keyBadge.textContent = keys[id] || DEFAULT_KEYS[id];

    const name = document.createElement('span');
    name.className = 'kws-tab-name';
    name.textContent = label;

    item.appendChild(keyBadge);
    item.appendChild(name);
    bar.appendChild(item);
  }

  return bar;
}

/**
 * 既存のキーマップバーのキー表示を更新する
 */
function updateKeymapEl() {
  const bar = document.getElementById('kws-keymap');
  if (!bar) return;

  for (const item of bar.querySelectorAll('.kws-item')) {
    const id = item.dataset.keyId;
    const badge = item.querySelector('.kws-key');
    if (badge && id) {
      badge.textContent = keys[id] || DEFAULT_KEYS[id];
    }
  }
}

// ---- ユーティリティ ------------------------------------------------

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
