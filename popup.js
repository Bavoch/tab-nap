const DEFAULT_TIMEOUT = 10;
const DEFAULT_AUTO_CLOSE_TIMEOUT = 0;
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
      el.dataset.tooltip = message;
      el.removeAttribute('title');
    }
    
    el.onmouseenter = (e) => {
      const msg = el.dataset.tooltip || el.getAttribute('aria-label') || el.getAttribute('data-i18n-title') || '';
      if (msg) showTooltip(e, msg);
    };
    el.onmouseleave = hideTooltip;
    el.addEventListener('click', hideTooltip);
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
  translatePage();
  setTimeout(postPopupSize, 0);
}

// 保存设置
function saveOptions() {
  const timeoutInput = document.getElementById('timeout');
  const timeout = parseInt(timeoutInput.value, 10);
  const autoCloseTimeout = parseInt(document.getElementById('autoCloseTimeout').value, 10);
  const activeTabsToKeep = parseInt(document.getElementById('activeTabsToKeep').value, 10);
  const excludeAudio = document.getElementById('excludeAudio').checked;
  const enableAutoSleep = document.getElementById('enableAutoSleep').checked;
  const enableAutoClose = document.getElementById('enableAutoClose').checked;
  const enableKeepActive = document.getElementById('enableKeepActive').checked;
  const whitelist = document.getElementById('whitelist').value;
  
  if (enableAutoSleep && (isNaN(timeout) || timeout < 1)) {
    const errorMsg = chrome.i18n.getMessage('invalidTimeout') || 'Please enter a valid number of minutes (at least 1)';
    alert(errorMsg);
    return;
  }

  if (enableAutoClose && (isNaN(autoCloseTimeout) || autoCloseTimeout < 1)) {
    const errorMsg = 'Please enter a valid number for auto-close timeout';
    alert(errorMsg);
    return;
  }
  
  if (enableKeepActive && (isNaN(activeTabsToKeep) || activeTabsToKeep < 1)) {
    const errorMsg = 'Please enter a valid number for keeping active tabs';
    alert(errorMsg);
    return;
  }

  chrome.storage.local.set({
    timeout: timeout,
    autoCloseTimeout: autoCloseTimeout,
    activeTabsToKeep: activeTabsToKeep,
    excludeAudio: excludeAudio,
    whitelist: whitelist,
    enableAutoSleep,
    enableAutoClose,
    enableKeepActive
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
    autoCloseTimeout: DEFAULT_AUTO_CLOSE_TIMEOUT,
    activeTabsToKeep: DEFAULT_KEEP_ACTIVE,
    excludeAudio: DEFAULT_EXCLUDE_AUDIO,
    whitelist: DEFAULT_WHITELIST,
    enableAutoSleep: null,
    enableAutoClose: null,
    enableKeepActive: null
  }, (items) => {
    document.getElementById('timeout').value = items.timeout;
    document.getElementById('autoCloseTimeout').value = items.autoCloseTimeout;
    document.getElementById('activeTabsToKeep').value = items.activeTabsToKeep;
    document.getElementById('excludeAudio').checked = items.excludeAudio;
    document.getElementById('whitelist').value = items.whitelist;
    
    const enableAutoSleep = items.enableAutoSleep !== null ? items.enableAutoSleep : true;
    const enableAutoClose = items.enableAutoClose !== null ? items.enableAutoClose : (items.autoCloseTimeout > 0);
    const enableKeepActive = items.enableKeepActive !== null ? items.enableKeepActive : (items.activeTabsToKeep > 0);
    
    document.getElementById('enableAutoSleep').checked = enableAutoSleep;
    document.getElementById('enableAutoClose').checked = enableAutoClose;
    document.getElementById('enableKeepActive').checked = enableKeepActive;
    
    // 根据开关状态启用/禁用数值输入
    document.getElementById('timeout').disabled = !enableAutoSleep;
    document.getElementById('autoCloseTimeout').disabled = !enableAutoClose;
    document.getElementById('activeTabsToKeep').disabled = !enableKeepActive;
    
    // 绑定开关交互
    document.getElementById('enableAutoSleep').onchange = () => {
      document.getElementById('timeout').disabled = !document.getElementById('enableAutoSleep').checked;
    };
    document.getElementById('enableAutoClose').onchange = () => {
      document.getElementById('autoCloseTimeout').disabled = !document.getElementById('enableAutoClose').checked;
    };
    document.getElementById('enableKeepActive').onchange = () => {
      document.getElementById('activeTabsToKeep').disabled = !document.getElementById('enableKeepActive').checked;
    };
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

// Tooltip logic
function showTooltip(e, text) {
  const tooltip = document.getElementById('tooltip');
  if (!tooltip) return;
  
  tooltip.textContent = text;
  tooltip.classList.add('visible');
  
  const rect = e.currentTarget.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  
  // Position above the button, centered
  let top = rect.top - tooltipRect.height - 8;
  let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
  
  // Boundary checks
  if (top < 0) top = rect.bottom + 8;
  if (left < 0) left = 8;
  if (left + tooltipRect.width > window.innerWidth) left = window.innerWidth - tooltipRect.width - 8;
  
  tooltip.style.top = `${top}px`;
  tooltip.style.left = `${left}px`;
}

function hideTooltip() {
  const tooltip = document.getElementById('tooltip');
  if (tooltip) {
    tooltip.classList.remove('visible');
  }
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

// 获取安全的 Favicon URL
function getFaviconUrl(tab) {
  // 如果是本地开发环境的 HTTP 图标，为了避免 Mixed Content 错误，
  // 我们在插件弹窗（HTTPS 环境）中强制使用 Chrome 的 favicon 服务来代理
  if (tab.favIconUrl && 
      !tab.favIconUrl.startsWith('chrome-extension://') && 
      tab.favIconUrl.startsWith('https://')) {
    return tab.favIconUrl;
  }
  
  if (!tab.url) return null;
  
  try {
    // 使用 Chrome 的 favicon 服务，这会通过浏览器底层处理图标获取，
    // 能够安全地在扩展页面显示，并解决跨域和 Mixed Content 问题。
    const url = new URL(`chrome-extension://${chrome.runtime.id}/_favicon/`);
    url.searchParams.set('pageUrl', tab.url);
    url.searchParams.set('size', '32');
    return url.toString();
  } catch (e) {
    return null;
  }
}

function createTabItem(tab, settings, currentWindow, now, whitelist, timeoutMs, enableAutoSleep) {
  const isNapped = tab.discarded;
  const isWhitelisted = whitelist.some(pattern => tab.url.includes(pattern) || tab.title.includes(pattern));
  const isCurrentViewing = tab.active && tab.windowId === currentWindow.id;
  
  const tabItem = document.createElement('div');
  tabItem.className = 'tab-item';
  tabItem.dataset.tabId = tab.id;
  
  // Favicon container
  const faviconContainer = document.createElement('div');
  faviconContainer.className = 'tab-favicon';
  
  const safeFaviconUrl = getFaviconUrl(tab);
  if (safeFaviconUrl) {
    const img = document.createElement('img');
    img.src = safeFaviconUrl;
    img.onerror = () => {
      if (img.src !== safeFaviconUrl) return;
      img.style.display = 'none';
      const letter = document.createElement('span');
      letter.textContent = tab.title ? tab.title.charAt(0).toUpperCase() : '?';
      letter.style.fontSize = '10px';
      letter.style.fontWeight = 'bold';
      letter.style.color = 'var(--text-secondary)';
      faviconContainer.appendChild(letter);
    };
    faviconContainer.appendChild(img);
  } else {
    const letter = document.createElement('span');
    letter.textContent = tab.title ? tab.title.charAt(0).toUpperCase() : '?';
    letter.style.fontSize = '10px';
    letter.style.fontWeight = 'bold';
    letter.style.color = 'var(--text-secondary)';
    faviconContainer.appendChild(letter);
  }
  tabItem.appendChild(faviconContainer);

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
  timeSpan.dataset.tabId = tab.id;
  timeSpan.dataset.lastAccessed = tab.lastAccessed || 0;
  timeSpan.dataset.isNapped = isNapped;
  timeSpan.dataset.isCurrentViewing = isCurrentViewing;
  timeSpan.dataset.isWhitelisted = isWhitelisted;
  
  updateTimeSpan(timeSpan, settings, now, timeoutMs, enableAutoSleep);
  
  const actions = document.createElement('div');
  actions.className = 'tab-actions';

  if (isNapped) {
    const wakeBtn = document.createElement('button');
    wakeBtn.className = 'action-btn wake-btn';
    wakeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>';
    const wakeTitle = chrome.i18n.getMessage('wakeUpSingleTab') || 'Wake Up';
    wakeBtn.onmouseenter = (e) => showTooltip(e, wakeTitle);
    wakeBtn.onmouseleave = hideTooltip;
    wakeBtn.onclick = async (e) => {
      e.stopPropagation();
      hideTooltip();
      await safeUpdate(async () => {
        chrome.runtime.sendMessage({ action: 'wakeUpSingleTab', tabId: tab.id });
        setTimeout(updatePopup, 100);
      });
    };
    actions.appendChild(wakeBtn);
  } else if (!isCurrentViewing) {
    const napBtn = document.createElement('button');
    napBtn.className = 'action-btn nap-btn';
    napBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path><line x1="12" y1="2" x2="12" y2="12"></line></svg>';
    const napTitle = chrome.i18n.getMessage('napSingleTab') || 'Nap';
    napBtn.onmouseenter = (e) => showTooltip(e, napTitle);
    napBtn.onmouseleave = hideTooltip;
    napBtn.onclick = async (e) => {
      e.stopPropagation();
      hideTooltip();
      await safeUpdate(async () => {
        chrome.runtime.sendMessage({ action: 'napSingleTab', tabId: tab.id });
        setTimeout(updatePopup, 100);
      });
    };
    actions.appendChild(napBtn);
  }

  const wlBtn = document.createElement('button');
  wlBtn.className = `whitelist-btn ${isWhitelisted ? 'active' : ''}`;
  wlBtn.innerHTML = isWhitelisted 
    ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>'
    : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20v-8m0 0V4m0 8h8m-8 0H4"></path></svg>';
  
  const wlTitle = isWhitelisted 
    ? chrome.i18n.getMessage('removeFromWhitelist') 
    : chrome.i18n.getMessage('addToWhitelist');
  
  wlBtn.onmouseenter = (e) => showTooltip(e, wlTitle);
  wlBtn.onmouseleave = hideTooltip;
  
  wlBtn.onclick = async (e) => {
    e.stopPropagation();
    hideTooltip();
    await safeUpdate(async () => {
      toggleWhitelist(tab, isWhitelisted);
    });
  };
  actions.appendChild(wlBtn);

  meta.appendChild(timeSpan);
  info.appendChild(title);
  info.appendChild(meta);
  tabItem.appendChild(info);
  tabItem.appendChild(actions);
  
  tabItem.onclick = () => {
    chrome.tabs.update(tab.id, { active: true });
    chrome.windows.update(tab.windowId, { focused: true });
  };

  return tabItem;
}

function updateTimeSpan(timeSpan, settings, now, timeoutMs, enableAutoSleep) {
  const isNapped = timeSpan.dataset.isNapped === 'true';
  const isCurrentViewing = timeSpan.dataset.isCurrentViewing === 'true';
  const isWhitelisted = timeSpan.dataset.isWhitelisted === 'true';
  const tabId = parseInt(timeSpan.dataset.tabId);
  
  timeSpan.classList.remove('napped', 'active', 'countdown');
  timeSpan.style.color = '';
  timeSpan.textContent = '';

  if (isNapped) {
    timeSpan.classList.add('napped');
    const nappedAt = settings.nappedTabsData[tabId]?.nappedAt;
    if (nappedAt) {
      timeSpan.textContent = formatTime(now - nappedAt);
    }
  } else if (isCurrentViewing) {
    timeSpan.classList.add('active');
  } else if (isWhitelisted) {
    timeSpan.style.color = 'var(--text-secondary)';
  } else {
    if (!enableAutoSleep) {
      // 禁用自动休眠时不显示倒计时
      return;
    }
    const awakenedAt = settings.awakenedTabsData[tabId]?.awakenedAt || 0;
    const lastActive = Math.max(parseFloat(timeSpan.dataset.lastAccessed) || 0, awakenedAt);
    const remaining = timeoutMs - (now - lastActive);
    
    if (remaining > 0) {
      timeSpan.textContent = formatTime(remaining);
      timeSpan.classList.add('countdown');
    }
  }
}

async function safeUpdate(fn) {
  try {
    // 检查扩展上下文是否有效
    if (!chrome.runtime?.id) {
      if (updateInterval) clearInterval(updateInterval);
      return;
    }
    await fn();
  } catch (e) {
    if (e.message.includes('Extension context invalidated')) {
      if (updateInterval) clearInterval(updateInterval);
    } else {
      console.error('Update error:', e);
    }
  }
}

async function updateTimersOnly() {
  await safeUpdate(async () => {
    const settings = await chrome.storage.local.get({ 
      timeout: DEFAULT_TIMEOUT,
      nappedTabsData: {},
      awakenedTabsData: {},
      enableAutoSleep: null
    });
    const timeoutMs = settings.timeout * 60 * 1000;
    const now = Date.now();
    const enableAutoSleep = settings.enableAutoSleep !== null ? settings.enableAutoSleep : true;
    
    const timeSpans = document.querySelectorAll('.tab-time');
    timeSpans.forEach(span => {
      updateTimeSpan(span, settings, now, timeoutMs, enableAutoSleep);
    });
  });
}

function postPopupSize() {
  if (window.parent === window) return;
  const height = Math.ceil(document.documentElement.scrollHeight);
  window.parent.postMessage({ type: 'tabNapResize', height }, '*');
}

async function updatePopup() {
  await safeUpdate(async () => {
    const settings = await chrome.storage.local.get({
      timeout: DEFAULT_TIMEOUT,
      nappedTabsData: {},
      awakenedTabsData: {},
      whitelist: DEFAULT_WHITELIST,
      enableAutoSleep: null
    });
    
    const timeoutMs = settings.timeout * 60 * 1000;
    const enableAutoSleep = settings.enableAutoSleep !== null ? settings.enableAutoSleep : true;

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
      const fragment = document.createDocumentFragment();
      fragment.appendChild(createTabItem(currentTab, settings, currentWindow, now, whitelist, timeoutMs, enableAutoSleep));
      activeTabContainer.innerHTML = '';
      activeTabContainer.appendChild(fragment);
    } else {
      activeTabSection.classList.add('hidden');
    }

    // 决定显示哪些标签页
    let displayTabs = currentTabType === 'active' ? activeTabs : nappedTabs;

    // 搜索过滤
    if (searchTerm) {
      // 隐藏 tab switcher 和 active tab section 当搜索时
      const switcher = document.querySelector('.tab-switcher');
      if (switcher) switcher.classList.add('hidden');
      
      activeTabSection.classList.add('hidden');
      document.getElementById('wake-up-all').style.display = 'none';

      displayTabs = allTabs.filter(t => {
        const title = (t.title || '').toLowerCase();
        const url = (t.url || '').toLowerCase();
        return title.includes(searchTerm) || url.includes(searchTerm);
      });
    } else {
      // 无搜索词，恢复默认显示
      const switcher = document.querySelector('.tab-switcher');
      if (switcher) switcher.classList.remove('hidden');
      
      if (currentTab) {
        activeTabSection.classList.remove('hidden');
      }
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
        const fragment = document.createDocumentFragment();
        for (const tab of displayTabs) {
          fragment.appendChild(createTabItem(tab, settings, currentWindow, now, whitelist, timeoutMs, enableAutoSleep));
        }
        tabListContainer.appendChild(fragment);
    }

    // 控制“立即激活所有”按钮的显示
    const wakeUpAllBtn = document.getElementById('wake-up-all');
    if (!searchTerm && currentTabType === 'napped' && nappedTabs.length > 0) {
      wakeUpAllBtn.style.display = 'block';
    } else {
      wakeUpAllBtn.style.display = 'none';
    }
    postPopupSize();
  });
}

document.getElementById('wake-up-all').addEventListener('click', async () => {
  await safeUpdate(async () => {
    chrome.runtime.sendMessage({ action: 'wakeUpAll' });
    setTimeout(updatePopup, 500);
  });
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

  let searchTimeout;
  document.getElementById('tab-search').addEventListener('input', () => {
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(updatePopup, 150);
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

document.addEventListener('DOMContentLoaded', async () => {
  if (window.parent !== window) {
    document.body.classList.add('is-iframe');
  }
  await safeUpdate(async () => {
    translatePage();
    updatePopup();
  });
  // 每秒更新一次计时器，而不是重建整个列表
  updateInterval = setInterval(updateTimersOnly, 1000);
});

// 当窗口关闭时清除定时器
window.onunload = () => {
  if (updateInterval) clearInterval(updateInterval);
};
