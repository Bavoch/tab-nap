// 默认设置
const DEFAULT_TIMEOUT = 10;
const DEFAULT_EXCLUDE_AUDIO = true;
const DEFAULT_WHITELIST = '';

function translatePage() {
  // Translate text content
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const message = chrome.i18n.getMessage(key);
    if (message) {
      el.textContent = message;
    }
  });

  // Translate placeholders
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    const message = chrome.i18n.getMessage(key);
    if (message) {
      el.placeholder = message;
    }
  });
}

// 保存设置
function saveOptions() {
  const timeoutInput = document.getElementById('timeout');
  const timeout = parseInt(timeoutInput.value, 10);
  const excludeAudio = document.getElementById('excludeAudio').checked;
  const whitelist = document.getElementById('whitelist').value;
  
  if (isNaN(timeout) || timeout < 1) {
    // Note: alert is hardcoded for now as it's a simple case, but could be i18n'd too
    alert('Please enter a valid number of minutes (at least 1)');
    return;
  }

  chrome.storage.local.set({
    timeout: timeout,
    excludeAudio: excludeAudio,
    whitelist: whitelist
  }, () => {
    const status = document.getElementById('status');
    status.textContent = chrome.i18n.getMessage('statusSaved');
    setTimeout(() => {
      status.textContent = '';
    }, 2000);
  });
}

// 加载设置
function restoreOptions() {
  chrome.storage.local.get({
    timeout: DEFAULT_TIMEOUT,
    excludeAudio: DEFAULT_EXCLUDE_AUDIO,
    whitelist: DEFAULT_WHITELIST
  }, (items) => {
    document.getElementById('timeout').value = items.timeout;
    document.getElementById('excludeAudio').checked = items.excludeAudio;
    document.getElementById('whitelist').value = items.whitelist;
  });
}

document.addEventListener('DOMContentLoaded', () => {
  translatePage();
  restoreOptions();
});
document.getElementById('save').addEventListener('click', saveOptions);
