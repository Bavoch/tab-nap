const DEFAULT_TIMEOUT = 10;
let updateInterval;

function translatePage() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const message = chrome.i18n.getMessage(key);
    if (message) {
      el.textContent = message;
    }
  });
}

function formatTime(ms) {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  
  const minStr = chrome.i18n.getMessage('minutes');
  const secStr = chrome.i18n.getMessage('seconds');
  
  if (minutes > 0) {
    return `${minutes}${minStr}${seconds}${secStr}`;
  }
  return `${seconds}${secStr}`;
}

async function toggleWhitelist(tab, isWhitelisted) {
  const settings = await chrome.storage.local.get({ whitelist: '' });
  let whitelist = settings.whitelist.split('\n').map(s => s.trim()).filter(s => s.length > 0);
  
  let domain = '';
  try {
    const url = new URL(tab.url);
    domain = url.hostname;
    if (!domain && tab.url.startsWith('chrome://')) {
      domain = tab.url.split('/')[2];
    }
  } catch (e) {
    domain = tab.url;
  }

  if (!domain) return;

  if (isWhitelisted) {
    // 移除
    whitelist = whitelist.filter(item => item !== domain && !tab.url.includes(item));
  } else {
    // 添加
    if (!whitelist.includes(domain)) {
      whitelist.push(domain);
    }
  }
  
  await chrome.storage.local.set({ whitelist: whitelist.join('\n') });
  updatePopup();
}

async function updatePopup() {
  const settings = await chrome.storage.local.get({
    timeout: DEFAULT_TIMEOUT,
    nappedTabsData: {},
    whitelist: ''
  });
  
  const timeoutMs = settings.timeout * 60 * 1000;
  const timeoutText = settings.timeout === 0 
    ? chrome.i18n.getMessage('never')
    : `${settings.timeout} ${chrome.i18n.getMessage('minutes')}`;
  
  document.getElementById('timeout-val').textContent = timeoutText;

  const whitelist = settings.whitelist.split('\n').map(s => s.trim()).filter(s => s.length > 0);
  const napGroupTitle = chrome.i18n.getMessage('napGroupTitle') || '😴 Nap';
  
  const allTabs = await chrome.tabs.query({});
  const tabListContainer = document.getElementById('tab-list');
  const currentTabItems = Array.from(tabListContainer.children);
  
  let totalNapped = 0;
  const now = Date.now();

  // 清空并重新构建列表（或者优化为局部更新）
  tabListContainer.innerHTML = '';

  for (const tab of allTabs) {
    const isNapped = tab.discarded;
    if (isNapped) totalNapped++;

    const isWhitelisted = whitelist.some(pattern => tab.url.includes(pattern) || tab.title.includes(pattern));
    
    const tabItem = document.createElement('div');
    tabItem.className = 'tab-item';
    
    const info = document.createElement('div');
    info.className = 'tab-info';
    
    const title = document.createElement('div');
    title.className = 'tab-title';
    title.textContent = tab.title;
    title.title = tab.title;
    
    const meta = document.createElement('div');
    meta.className = 'tab-meta';
    
    const timeSpan = document.createElement('span');
    timeSpan.className = 'tab-time';
    
    if (isNapped) {
      timeSpan.classList.add('napped');
      const nappedAt = settings.nappedTabsData[tab.id]?.nappedAt;
      if (nappedAt) {
        timeSpan.textContent = `${chrome.i18n.getMessage('nappedFor')}: ${formatTime(now - nappedAt)}`;
      } else {
        timeSpan.textContent = chrome.i18n.getMessage('nappedFor');
      }
    } else if (tab.active) {
      timeSpan.textContent = 'Active';
      timeSpan.style.color = '#4CAF50';
    } else if (tab.pinned) {
      timeSpan.textContent = chrome.i18n.getMessage('pinnedStatus') || 'Pinned';
      timeSpan.style.color = '#9e9e9e';
    } else if (isWhitelisted) {
      timeSpan.textContent = 'Whitelisted';
      timeSpan.style.color = '#9e9e9e';
    } else {
      const lastActive = tab.lastAccessed || now;
      const remaining = timeoutMs - (now - lastActive);
      timeSpan.textContent = `${chrome.i18n.getMessage('nappingIn')}: ${formatTime(remaining)}`;
    }
    
    const wlBtn = document.createElement('button');
    wlBtn.className = `whitelist-btn ${isWhitelisted ? 'active' : ''}`;
    wlBtn.textContent = isWhitelisted 
      ? chrome.i18n.getMessage('removeFromWhitelist') 
      : chrome.i18n.getMessage('addToWhitelist');
    
    wlBtn.onclick = (e) => {
      e.stopPropagation();
      toggleWhitelist(tab, isWhitelisted);
    };

    meta.appendChild(timeSpan);
    meta.appendChild(wlBtn);
    info.appendChild(title);
    info.appendChild(meta);
    
    // Favicon
    if (tab.favIconUrl) {
      const img = document.createElement('img');
      img.src = tab.favIconUrl;
      img.width = 16;
      img.height = 16;
      tabItem.appendChild(img);
    } else {
      const placeholder = document.createElement('div');
      placeholder.style.width = '16px';
      placeholder.style.height = '16px';
      tabItem.appendChild(placeholder);
    }
    
    tabItem.appendChild(info);
    
    // 点击跳转到该标签页
    tabItem.onclick = () => {
      chrome.tabs.update(tab.id, { active: true });
      chrome.windows.update(tab.windowId, { focused: true });
    };

    tabListContainer.appendChild(tabItem);
  }
  
  document.getElementById('napped-count').textContent = totalNapped;
}

document.getElementById('nap-now').addEventListener('click', async () => {
  chrome.runtime.sendMessage({ action: 'napNow' });
  // 立即刷新一次
  setTimeout(updatePopup, 500);
});

document.getElementById('open-options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

document.addEventListener('DOMContentLoaded', () => {
  translatePage();
  updatePopup();
  // 每秒更新一次计时器
  updateInterval = setInterval(updatePopup, 1000);
});

// 当窗口关闭时清除定时器
window.onunload = () => {
  if (updateInterval) clearInterval(updateInterval);
};
