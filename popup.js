const DEFAULT_TIMEOUT = 10;
const DEFAULT_EXCLUDE_AUDIO = true;
const DEFAULT_WHITELIST = '';
const DEFAULT_KEEP_ACTIVE = 5;
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
  const activeTabsToKeep = parseInt(document.getElementById('activeTabsToKeep').value, 10);
  const excludeAudio = document.getElementById('excludeAudio').checked;
  const whitelist = document.getElementById('whitelist').value;
  
  if (isNaN(timeout) || timeout < 1) {
    const errorMsg = chrome.i18n.getMessage('invalidTimeout') || 'Please enter a valid number of minutes (at least 1)';
    alert(errorMsg);
    return;
  }

  chrome.storage.local.set({
    timeout: timeout,
    activeTabsToKeep: activeTabsToKeep,
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
    activeTabsToKeep: DEFAULT_KEEP_ACTIVE,
    excludeAudio: DEFAULT_EXCLUDE_AUDIO,
    whitelist: DEFAULT_WHITELIST
  }, (items) => {
    document.getElementById('timeout').value = items.timeout;
    document.getElementById('activeTabsToKeep').value = items.activeTabsToKeep;
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
  
  if (isCompact) {
    tabItem.style.padding = '8px 10px';
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
    info.style.gap = '10px';
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
        // Shorten the message for compact view
        const nappedForMsg = chrome.i18n.getMessage('nappedFor') || 'Napped';
        timeSpan.textContent = `${nappedForMsg}: ${formatTime(now - nappedAt)}`;
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
      const nappingInMsg = chrome.i18n.getMessage('nappingIn') || 'In';
      timeSpan.textContent = `${nappingInMsg}: ${formatTime(remaining)}`;
      timeSpan.classList.add('countdown');
    }
  }
  
  const actions = document.createElement('div');
  actions.className = 'tab-actions';

  if (isNapped) {
    // 已休眠列表：立即激活按钮
    const wakeBtn = document.createElement('button');
    wakeBtn.className = 'action-btn wake-btn';
    // Use icon for compact view
    wakeBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>';
    wakeBtn.title = chrome.i18n.getMessage('wakeUpSingleTab') || 'Wake Up';
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
      // Use icon for compact view
      napBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path><line x1="12" y1="2" x2="12" y2="12"></line></svg>';
      napBtn.title = chrome.i18n.getMessage('napSingleTab') || 'Nap';
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
  // Use icon for compact view
  wlBtn.innerHTML = isWhitelisted 
    ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>'
    : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20v-8m0 0V4m0 8h8m-8 0H4"></path></svg>';
  wlBtn.title = isWhitelisted 
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

  const whitelist = settings.whitelist.split('\n').map(s => s.trim()).filter(s => s.length > 0);
  
  const [allTabs, currentWindow] = await Promise.all([
    chrome.tabs.query({}),
    chrome.windows.getCurrent()
  ]);
  
  const tabListContainer = document.getElementById('tab-list');
  const activeTabContainer = document.getElementById('active-tab-container');
  const activeTabSection = document.getElementById('active-tab-section');
  const searchInput = document.getElementById('tab-search');
  const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
  
  const now = Date.now();

  // 预先分类和过滤
  const nappedTabs = allTabs.filter(t => t.discarded && !t.pinned);
  const activeTabs = allTabs.filter(t => !t.discarded && !t.pinned);
  
  // 更新标签栏标题和数量
  const nappedLabel = chrome.i18n.getMessage('tabNapped') || 'Hibernated';
  const activeLabel = chrome.i18n.getMessage('tabActive') || 'Running';
  document.getElementById('tab-napped').textContent = `${nappedLabel} (${nappedTabs.length})`;
  document.getElementById('tab-active').textContent = `${activeLabel} (${activeTabs.length})`;

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

  // 搜索过滤
  if (searchTerm) {
    // 搜索时，如果在当前分类找不到结果，但另一分类有结果，可能需要提示或自动切换（此处简单实现仅过滤当前视图）
    // 或者，更友好的体验是搜索时显示所有匹配结果，无论休眠状态。
    // 但为了保持 UI 结构，我们先仅过滤当前列表。
    // 用户需求是“搜索所有标签页”，所以这里我们应该合并搜索。
    
    // 如果有搜索词，忽略 currentTabType，显示所有匹配项
    // 并且隐藏 tab-switcher 以避免混淆，或者高亮所有匹配项
    // 这里我们采用：搜索时显示所有匹配项，不分 napped/active
    
    // 隐藏 tab switcher 和 active tab section 当搜索时
    document.querySelector('.tab-switcher').classList.add('hidden');
    document.getElementById('active-tab-section').classList.add('hidden');
    document.getElementById('wake-up-all').style.display = 'none';

    displayTabs = allTabs.filter(t => {
      const title = (t.title || '').toLowerCase();
      const url = (t.url || '').toLowerCase();
      return title.includes(searchTerm) || url.includes(searchTerm);
    });
  } else {
    // 无搜索词，恢复默认显示
    document.querySelector('.tab-switcher').classList.remove('hidden');
    if (currentTab) {
      document.getElementById('active-tab-section').classList.remove('hidden');
    }
    // 恢复 wake up all 按钮显示逻辑 (将在下面处理)
  }
  
  // 排序：按最后访问时间降序（最近访问的在前）
  displayTabs.sort((a, b) => {
    const aTime = a.lastAccessed || 0;
    const bTime = b.lastAccessed || 0;
    return bTime - aTime;
  });

  tabListContainer.innerHTML = '';
  if (displayTabs.length === 0 && searchTerm) {
      const noResult = document.createElement('div');
      noResult.style.textAlign = 'center';
      noResult.style.padding = '20px';
      noResult.style.color = 'var(--text-secondary)';
      noResult.textContent = 'No tabs found';
      tabListContainer.appendChild(noResult);
  } else {
      for (const tab of displayTabs) {
        tabListContainer.appendChild(createTabItem(tab, settings, currentWindow, now, whitelist, timeoutMs));
      }
  }

  // 控制“立即激活所有”按钮的显示
  const wakeUpAllBtn = document.getElementById('wake-up-all');
  if (!searchTerm && currentTabType === 'napped' && nappedTabs.length > 0) {
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

  document.getElementById('tab-search').addEventListener('input', () => {
    updatePopup();
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
