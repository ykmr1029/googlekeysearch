/**
 * GoogleKeySearch - Popup Settings Script
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

const SUGGESTION_FIELDS = [
  { id: 'nextSuggestion', label: '検索候補を下に移動' },
  { id: 'prevSuggestion', label: '検索候補を上に移動' },
];

const TAB_FIELDS = [
  { id: 'tabAll',      label: 'すべてタブ' },
  { id: 'tabImages',   label: '画像タブ' },
  { id: 'tabVideos',   label: '動画タブ' },
  { id: 'tabMaps',     label: '地図タブ' },
  { id: 'tabShopping', label: 'ショッピングタブ' },
  { id: 'tabNews',     label: 'ニュースタブ' },
];

const PAGE_FIELDS = [
  { id: 'nextPage', label: '次のページ' },
  { id: 'prevPage', label: '前のページ' },
];

const ALL_FIELDS = [...SUGGESTION_FIELDS, ...TAB_FIELDS, ...PAGE_FIELDS];

let currentKeys = { ...DEFAULT_KEYS };
let activeInput = null;  // 現在キャプチャ中の input 要素

// 初期化：ストレージから設定を読み込む
chrome.storage.sync.get('keys', (data) => {
  if (data.keys) {
    currentKeys = { ...DEFAULT_KEYS, ...data.keys };
  }
  renderFields('suggestionKeys', SUGGESTION_FIELDS);
  renderFields('tabKeys', TAB_FIELDS);
  renderFields('pageKeys', PAGE_FIELDS);
});

/**
 * フィールドグループをレンダリングする
 * @param {string} containerId
 * @param {{ id: string, label: string }[]} fields
 */
function renderFields(containerId, fields) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  fields.forEach(({ id, label }) => {
    const row = document.createElement('div');
    row.className = 'key-row';

    const labelEl = document.createElement('span');
    labelEl.className = 'key-label';
    labelEl.textContent = label;

    const wrapper = document.createElement('div');
    wrapper.className = 'key-input-wrapper';

    const input = document.createElement('input');
    input.className = 'key-input';
    input.dataset.id = id;
    input.value = currentKeys[id] || DEFAULT_KEYS[id];
    input.readOnly = true;
    input.title = 'クリックして新しいキーを押してください';

    // クリックでキャプチャモード開始
    input.addEventListener('click', () => startCapture(input));
    input.addEventListener('focus', () => startCapture(input));

    // キャプチャ中のキー入力を処理
    input.addEventListener('keydown', (e) => {
      if (!input.classList.contains('capturing')) return;
      e.preventDefault();
      e.stopPropagation();

      // Escape でキャプチャキャンセル
      if (e.key === 'Escape') {
        stopCapture(input);
        return;
      }

      // 無効なキー（修飾キー単体、特殊キーなど）は無視
      if (isIgnoredKey(e.key)) return;

      // 単一文字のみ許可
      if (e.key.length !== 1) {
        showStatus('使用できないキーです。単一の文字キーを押してください。', 'error');
        stopCapture(input);
        return;
      }

      applyKey(input, e.key);
      stopCapture(input);
    });

    wrapper.appendChild(input);
    row.appendChild(labelEl);
    row.appendChild(wrapper);
    container.appendChild(row);
  });
}

/**
 * 修飾キーや無視すべき特殊キーかどうかを判定
 */
function isIgnoredKey(key) {
  const ignored = [
    'Shift', 'Control', 'Alt', 'Meta',
    'CapsLock', 'Tab', 'Enter',
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'Backspace', 'Delete', 'Home', 'End', 'PageUp', 'PageDown',
    'F1', 'F2', 'F3', 'F4', 'F5', 'F6',
    'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
  ];
  return ignored.includes(key);
}

/**
 * キャプチャモードを開始する
 */
function startCapture(input) {
  // 別の input のキャプチャを解除
  if (activeInput && activeInput !== input) {
    stopCapture(activeInput);
  }
  activeInput = input;
  input.classList.add('capturing');
  input.value = '?';
}

/**
 * キャプチャモードを終了する
 */
function stopCapture(input) {
  input.classList.remove('capturing');
  const id = input.dataset.id;
  input.value = currentKeys[id] || DEFAULT_KEYS[id];
  if (activeInput === input) activeInput = null;
  input.blur();
}

/**
 * input にキーを適用してバリデーションする
 */
function applyKey(input, key) {
  const id = input.dataset.id;

  // 重複チェック
  const duplicate = findDuplicate(id, key);
  if (duplicate) {
    showStatus(
      `「${key}」は「${duplicate.label}」に既に使われています。`,
      'error'
    );
    input.classList.add('duplicate');
    setTimeout(() => input.classList.remove('duplicate'), 1500);
    return;
  }

  currentKeys[id] = key;
  input.value = key;
  clearStatus();
}

/**
 * 同じキーが他のフィールドで使われているか調べる
 * @returns {{ id: string, label: string } | null}
 */
function findDuplicate(excludeId, key) {
  for (const field of ALL_FIELDS) {
    if (field.id !== excludeId && currentKeys[field.id] === key) {
      return field;
    }
  }
  return null;
}

// 保存ボタン
document.getElementById('saveBtn').addEventListener('click', () => {
  // 保存前に全フィールドの重複チェック
  const allInputs = document.querySelectorAll('.key-input');
  const keyMap = {};
  let hasDuplicate = false;

  for (const input of allInputs) {
    const id = input.dataset.id;
    const val = input.value;
    if (keyMap[val]) {
      showStatus(`キーが重複しています: 「${val}」`, 'error');
      hasDuplicate = true;
      break;
    }
    keyMap[val] = id;
  }

  if (hasDuplicate) return;

  chrome.storage.sync.set({ keys: currentKeys }, () => {
    showStatus('設定を保存しました ✓', 'success');
    // 開いている Google タブのキーマップバーをリアルタイム更新
    chrome.tabs.query(
      { url: ['*://www.google.com/*', '*://www.google.co.jp/*'] },
      (tabs) => {
        for (const tab of tabs) {
          chrome.tabs.sendMessage(tab.id, { type: 'kws:keysUpdated', keys: currentKeys })
            .catch(() => { /* コンテンツスクリプト未注入のタブは無視 */ });
        }
      }
    );
  });
});

// デフォルトに戻すボタン
document.getElementById('resetBtn').addEventListener('click', () => {
  currentKeys = { ...DEFAULT_KEYS };
  // 全フィールドを再描画
  renderFields('suggestionKeys', SUGGESTION_FIELDS);
  renderFields('tabKeys', TAB_FIELDS);
  renderFields('pageKeys', PAGE_FIELDS);
  showStatus('デフォルト設定に戻しました', 'success');
});

/**
 * ステータスメッセージを表示する
 * @param {string} message
 * @param {'success'|'error'} type
 */
function showStatus(message, type = 'success') {
  const el = document.getElementById('status');
  el.textContent = message;
  el.className = type === 'error' ? 'error' : '';
  // success の場合は 2 秒後に消す
  if (type === 'success') {
    setTimeout(clearStatus, 2000);
  }
}

function clearStatus() {
  const el = document.getElementById('status');
  el.textContent = '';
  el.className = '';
}

// popup 全体でフォーカスが外れたらキャプチャを解除
document.addEventListener('click', (e) => {
  if (activeInput && !activeInput.contains(e.target)) {
    stopCapture(activeInput);
  }
});
