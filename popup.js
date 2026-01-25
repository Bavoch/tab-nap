const DEFAULT_TIMEOUT = 10;
const DEFAULT_EXCLUDE_AUDIO = true;
const DEFAULT_WHITELIST = '';
let updateInterval;
let currentTabType = 'napped'; // 'active' or 'napped'

function translatePage() {
  // Translate text content
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const message = chrome.i18n.getMessage(key);
    if (message) {
      el.textContent = message;
    }
  });

  // Translate titles/tooltips
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    const message = chrome.i18n.getMessage(key);
    if (message) {
      el.title = message;
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

function showMainView() {
  document.getElementById('main-view').classList.remove('hidden');
  document.getElementById('settings-view').classList.add('hidden');
  updatePopup();
}

function showSettingsView() {
  document.getElementById('main-view').classList.add('hidden');
  document.getElementById('settings-view').classList.remove('hidden');
  restoreOptions();
}

// 保存设置
function saveOptions() {
  const timeoutInput = document.getElementById('timeout');
  const timeout = parseInt(timeoutInput.value, 10);
  const excludeAudio = document.getElementById('excludeAudio').checked;
  const whitelist = document.getElementById('whitelist').value;
  
  if (isNaN(timeout) || timeout < 1) {
    const errorMsg = chrome.i18n.getMessage('invalidTimeout') || 'Please enter a valid number of minutes (at least 1)';
    alert(errorMsg);
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
    // 同时更新主页面的显示
    updatePopup();
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
  const settings = await chrome.storage.local.get({ whitelist: DEFAULT_WHITELIST });
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

  let addedToWhitelist = false;
  if (isWhitelisted) {
    // 移除
    whitelist = whitelist.filter(item => item !== domain && !tab.url.includes(item));
  } else {
    // 添加
    if (!whitelist.includes(domain)) {
      whitelist.push(domain);
      addedToWhitelist = true;
    }
  }
  
  await chrome.storage.local.set({ whitelist: whitelist.join('\n') });
  
  if (addedToWhitelist) {
    // 发送消息通知 background 唤醒符合新白名单的标签页
    chrome.runtime.sendMessage({ action: 'wakeUpByWhitelist' });
  }

  updatePopup();
}

function createTabItem(tab, settings, currentWindow, now, whitelist, timeoutMs, isCompact = false) {
  const isNapped = tab.discarded;
  const isWhitelisted = whitelist.some(pattern => tab.url.includes(pattern) || tab.title.includes(pattern));
  const isCurrentViewing = tab.active && tab.windowId === currentWindow.id;
  
  const tabItem = document.createElement('div');
  tabItem.className = 'tab-item';
  if (isCurrentViewing) {
    tabItem.style.backgroundColor = 'var(--bg-secondary)'; // 高亮当前标签页
    tabItem.style.border = '1px solid var(--border-color)';
  }
  
  if (isCompact) {
    tabItem.style.padding = '8px 12px';
  }
  
  // Favicon container
  const faviconContainer = document.createElement('div');
  faviconContainer.className = 'tab-favicon';
  
  if (tab.favIconUrl) {
    const img = document.createElement('img');
    img.src = tab.favIconUrl;
    faviconContainer.appendChild(img);
  } else {
    // Use a simple letter or icon if no favicon
    const letter = document.createElement('span');
    letter.textContent = tab.title ? tab.title.charAt(0).toUpperCase() : '?';
    letter.style.fontSize = '12px';
    letter.style.fontWeight = 'bold';
    letter.style.color = 'var(--text-secondary)';
    faviconContainer.appendChild(letter);
  }
  tabItem.appendChild(faviconContainer);

  const info = document.createElement('div');
  info.className = 'tab-info';
  
  if (isCompact) {
    info.style.display = 'flex';
    info.style.alignItems = 'center';
    info.style.justifyContent = 'space-between';
    info.style.gap = '12px';
  }
  
  const title = document.createElement('div');
  title.className = 'tab-title';
  title.textContent = tab.title;
  title.title = tab.title;
  
  if (isCompact) {
    title.style.marginBottom = '0';
  }
  
  const meta = document.createElement('div');
  meta.className = 'tab-meta';
  
  const timeSpan = document.createElement('span');
  timeSpan.className = 'tab-time';
  
  if (!isCompact) {
    if (isNapped) {
      timeSpan.classList.add('napped');
      const nappedAt = settings.nappedTabsData[tab.id]?.nappedAt;
      if (nappedAt) {
        timeSpan.textContent = `${chrome.i18n.getMessage('nappedFor')}: ${formatTime(now - nappedAt)}`;
      } else {
        timeSpan.textContent = chrome.i18n.getMessage('nappedFor');
      }
    } else if (isCurrentViewing) {
      timeSpan.textContent = chrome.i18n.getMessage('tabActive') || 'Running';
      timeSpan.classList.add('active');
    } else if (isWhitelisted) {
      timeSpan.textContent = 'Whitelisted';
      timeSpan.style.color = 'var(--text-secondary)';
    } else {
      const awakenedAt = settings.awakenedTabsData[tab.id]?.awakenedAt || 0;
      const lastActive = Math.max(tab.lastAccessed || now, awakenedAt);
      const remaining = timeoutMs - (now - lastActive);
      timeSpan.textContent = `${chrome.i18n.getMessage('nappingIn')}: ${formatTime(remaining)}`;
      timeSpan.classList.add('countdown');
    }
  }
  
  const actions = document.createElement('div');
  actions.className = 'tab-actions';

  if (isNapped) {
    // 已休眠列表：立即激活按钮
    const wakeBtn = document.createElement('button');
    wakeBtn.className = 'action-btn wake-btn';
    wakeBtn.textContent = chrome.i18n.getMessage('wakeUpSingleTab') || 'Wake Up';
    wakeBtn.onclick = (e) => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ action: 'wakeUpSingleTab', tabId: tab.id });
      setTimeout(updatePopup, 100);
    };
    actions.appendChild(wakeBtn);
  } else {
    // 当前激活列表（且不是正在查看的）：立即休眠
    // 如果是 compact 模式，强制显示休眠按钮
    if (!isCurrentViewing || isCompact) {
      const napBtn = document.createElement('button');
      napBtn.className = 'action-btn nap-btn';
      napBtn.textContent = chrome.i18n.getMessage('napSingleTab') || 'Nap';
      napBtn.onclick = (e) => {
        e.stopPropagation();
        chrome.runtime.sendMessage({ action: 'napSingleTab', tabId: tab.id });
        setTimeout(updatePopup, 100);
      };
      actions.appendChild(napBtn);
    }
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

  if (isCompact) {
    info.appendChild(title);
    actions.appendChild(wlBtn);
    info.appendChild(actions);
  } else {
    meta.appendChild(timeSpan);
    actions.appendChild(wlBtn);
    meta.appendChild(actions);
    info.appendChild(title);
    info.appendChild(meta);
  }
  
  tabItem.appendChild(info);
  
  // 点击跳转到该标签页
  tabItem.onclick = () => {
    chrome.tabs.update(tab.id, { active: true });
    chrome.windows.update(tab.windowId, { focused: true });
  };

  return tabItem;
}

async function updatePopup() {
  const settings = await chrome.storage.local.get({
    timeout: DEFAULT_TIMEOUT,
    nappedTabsData: {},
    awakenedTabsData: {},
    whitelist: DEFAULT_WHITELIST
  });
  
  const timeoutMs = settings.timeout * 60 * 1000;
  const timeoutText = settings.timeout === 0 
    ? chrome.i18n.getMessage('never')
    : `${settings.timeout} ${chrome.i18n.getMessage('minutes')}`;
  
  document.getElementById('timeout-val').textContent = timeoutText;

  const whitelist = settings.whitelist.split('\n').map(s => s.trim()).filter(s => s.length > 0);
  
  const [allTabs, currentWindow] = await Promise.all([
    chrome.tabs.query({}),
    chrome.windows.getCurrent()
  ]);
  
  const tabListContainer = document.getElementById('tab-list');
  const activeTabContainer = document.getElementById('active-tab-container');
  const activeTabSection = document.getElementById('active-tab-section');
  
  const now = Date.now();

  // 预先分类和过滤
  const nappedTabs = allTabs.filter(t => t.discarded && !t.pinned);
  const activeTabs = allTabs.filter(t => !t.discarded && !t.pinned);
  
  document.getElementById('napped-count').textContent = nappedTabs.length;

  // 找到当前激活的标签页
  const currentTab = allTabs.find(t => t.active && t.windowId === currentWindow.id);
  
  // 渲染当前激活标签页
  if (currentTab) {
    activeTabSection.classList.remove('hidden');
    activeTabContainer.innerHTML = '';
    activeTabContainer.appendChild(createTabItem(currentTab, settings, currentWindow, now, whitelist, timeoutMs, true));
  } else {
    activeTabSection.classList.add('hidden');
  }

  // 决定显示哪些标签页
  let displayTabs = currentTabType === 'active' ? activeTabs : nappedTabs;
  
  // 如果当前激活的标签页在列表中，将其移除（因为它已经单独显示在上面了）
  if (currentTab) {
    displayTabs = displayTabs.filter(t => t.id !== currentTab.id);
  }

  // 排序：按最后访问时间降序（最近访问的在前）
  displayTabs.sort((a, b) => {
    const aTime = a.lastAccessed || 0;
    const bTime = b.lastAccessed || 0;
    return bTime - aTime;
  });

  tabListContainer.innerHTML = '';
  for (const tab of displayTabs) {
    tabListContainer.appendChild(createTabItem(tab, settings, currentWindow, now, whitelist, timeoutMs));
  }

  // 控制“立即激活所有”按钮的显示
  const wakeUpAllBtn = document.getElementById('wake-up-all');
  if (currentTabType === 'napped' && nappedTabs.length > 0) {
    wakeUpAllBtn.style.display = 'block';
  } else {
    wakeUpAllBtn.style.display = 'none';
  }
}

document.getElementById('wake-up-all').addEventListener('click', async () => {
  chrome.runtime.sendMessage({ action: 'wakeUpAll' });
  // 立即刷新一次
  setTimeout(updatePopup, 500);
});

document.getElementById('open-settings').addEventListener('click', showSettingsView);
document.getElementById('back-to-main').addEventListener('click', showMainView);
document.getElementById('save-settings').addEventListener('click', saveOptions);
document.getElementById('close-popup').addEventListener('click', () => {
  if (window.parent !== window) {
    window.parent.postMessage('closeTabNapPanel', '*');
  } else {
    window.close();
  }
});

document.getElementById('tab-active').addEventListener('click', () => {
  currentTabType = 'active';
  document.getElementById('tab-active').classList.add('active');
  document.getElementById('tab-napped').classList.remove('active');
  updatePopup();
});

document.getElementById('tab-napped').addEventListener('click', () => {
  currentTabType = 'napped';
  document.getElementById('tab-napped').classList.add('active');
  document.getElementById('tab-active').classList.remove('active');
  updatePopup();
});

document.addEventListener('DOMContentLoaded', () => {
  if (window.parent !== window) {
    document.body.classList.add('is-iframe');
  }
  translatePage();
  updatePopup();
  // 每秒更新一次计时器
  updateInterval = setInterval(updatePopup, 1000);
});

// 当窗口关闭时清除定时器
window.onunload = () => {
  if (updateInterval) clearInterval(updateInterval);
};
