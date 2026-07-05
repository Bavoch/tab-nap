// 加载共享 i18n 层（经典脚本，挂到 globalThis.TabNapI18n）
importScripts('i18n.js');
const i18n = globalThis.TabNapI18n;

// 默认配置
const DEFAULT_TIMEOUT = 30; // 30 分钟
const DEFAULT_AUTO_CLOSE_TIMEOUT = 300; // 默认 300 分钟后自动关闭
const DEFAULT_KEEP_ACTIVE = 10; // 默认保留最近活跃的 10 个标签页不休眠
// 休眠分组标题与预警文案随语言变化，通过 i18n 动态获取，不再缓存为常量。
const CHECK_INTERVAL = 1; // 生产环境最小间隔为 1 分钟
const WARNING_THRESHOLD = 10 * 1000; // 10 秒

function debugLog(...args) {
  console.debug('[TabNap:background]', ...args);
}

function debugWarn(...args) {
  console.warn('[TabNap:background]', ...args);
}

// 记录原始标题，用于恢复
const tabOriginalTitles = new Map();
// 记录即将休眠的定时器，用于精确控制 10 秒倒计时
const tabNapTimeouts = new Map();

// 休眠分组标题基础文案（随当前语言变化）
function getNapGroupBaseTitle() {
  return i18n.getNapGroupBaseTitle();
}

function isNapGroupTitle(title) {
  return i18n.isNapGroupTitle(title);
}

function clearNapTimeout(tabId) {
  const timeoutId = tabNapTimeouts.get(tabId);
  if (timeoutId) {
    clearTimeout(timeoutId);
    tabNapTimeouts.delete(tabId);
  }
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 获取第一个非固定标签页的索引
 * @param {number} windowId 窗口 ID
 * @returns {Promise<number>}
 */
async function getFirstNonPinnedIndex(windowId) {
  const pinnedTabs = await chrome.tabs.query({ windowId: windowId, pinned: true });
  return pinnedTabs.length;
}

async function activateReplacementTab(tab) {
  if (!tab.active) return;

  const tabs = await chrome.tabs.query({ windowId: tab.windowId });
  const candidates = tabs
    .filter(candidate => candidate.id !== tab.id && !candidate.discarded)
    .sort((a, b) => Math.abs(a.index - tab.index) - Math.abs(b.index - tab.index));

  const replacement = candidates.find(candidate => !candidate.pinned) || candidates[0];
  if (replacement) {
    await chrome.tabs.update(replacement.id, { active: true });
  } else {
    await chrome.tabs.create({
      windowId: tab.windowId,
      index: tab.index + 1,
      active: true
    });
  }

  await wait(75);
}

/**
 * 更新分组标题以显示标签数量，并确保其在最左侧（固定标签页之后）
 * @param {number} groupId 分组 ID
 */
async function updateGroupTitle(groupId) {
  try {
    const tabs = await chrome.tabs.query({ groupId: groupId });
    const count = tabs.length;
    
    // 如果分组中没有标签，它会自动消失，不需要更新
    if (count === 0) return;

    const group = await chrome.tabGroups.get(groupId);
    const newTitle = `${getNapGroupBaseTitle()} (${count})`;
    
    // 只有标题不同才更新，避免触发不必要的 onUpdated 事件
    if (group.title !== newTitle) {
      await chrome.tabGroups.update(groupId, { title: newTitle });
    }
    
    // 确保分组在最左侧（固定标签页之后）
    const targetIndex = await getFirstNonPinnedIndex(group.windowId);
    
    // 检查分组中索引最小的标签是否已经在目标位置
    const sortedTabs = [...tabs].sort((a, b) => a.index - b.index);
    if (sortedTabs[0].index !== targetIndex) {
      try {
        // 使用 tabGroups.move 一次性移动整个分组，比移动单个标签更稳定
        await chrome.tabGroups.move(groupId, { index: targetIndex });
      } catch (moveError) {
        console.warn('Could not move group:', moveError.message);
      }
    }
  } catch (e) {
    // 分组可能已经不存在
    console.debug('Group update failed (possibly already gone):', e.message);
  }
}

/**
 * 更新所有休眠分组的标题
 */
async function updateAllNapGroups() {
  try {
    const allGroups = await chrome.tabGroups.query({});
    for (const group of allGroups) {
      if (isNapGroupTitle(group.title)) {
        await updateGroupTitle(group.id);
      }
    }
  } catch (e) {
    // 忽略错误
  }
}

/**
 * 恢复当前窗口中休眠分组里的标签页，直到“唤醒中的标签页”数量达到保护阈值
 * @param {number} windowId 窗口 ID
 * @param {object} [settings]
 */
async function restoreProtectedTabsIfNeeded(windowId, settings = null, excludedTabIds = new Set()) {
  try {
    if (typeof windowId !== 'number' || windowId === chrome.windows.WINDOW_ID_NONE) {
      return;
    }

    const resolvedSettings = settings || await chrome.storage.local.get({
      activeTabsToKeep: DEFAULT_KEEP_ACTIVE,
      enableKeepActive: null,
      nappedTabsData: {}
    });

    const enableKeepActive = resolvedSettings.enableKeepActive ?? (resolvedSettings.activeTabsToKeep > 0);
    const protectedTabCount = resolvedSettings.activeTabsToKeep || 0;

    if (!enableKeepActive || protectedTabCount < 1) {
      return;
    }

    const tabs = await chrome.tabs.query({ windowId });
    const awakeTabCount = tabs.filter(tab => !tab.pinned && !tab.discarded).length;
    const deficit = protectedTabCount - awakeTabCount;

    if (deficit <= 0) {
      return;
    }

    const napGroupIds = new Set(
      (await chrome.tabGroups.query({ windowId }))
        .filter(group => isNapGroupTitle(group.title))
        .map(group => group.id)
    );

    const candidates = tabs
      .filter(tab => tab.discarded && !tab.pinned && napGroupIds.has(tab.groupId) && !excludedTabIds.has(tab.id))
      .sort((a, b) => {
        const aNappedAt = resolvedSettings.nappedTabsData[a.id]?.nappedAt || 0;
        const bNappedAt = resolvedSettings.nappedTabsData[b.id]?.nappedAt || 0;
        return bNappedAt - aNappedAt;
      });

    for (const tab of candidates.slice(0, deficit)) {
      await ungroupIfNapped(tab.id);
    }
  } catch (e) {
    console.debug('Failed to restore protected tabs:', e.message);
  }
}

// 初始化函数
async function initialize() {
  // 先加载语言设置，确保分组标题等文案使用正确语言
  await i18n.loadLanguage();
  const result = await chrome.storage.local.get(['timeout', 'autoCloseTimeout', 'excludeAudio', 'whitelist', 'activeTabsToKeep']);
  const defaults = {};
  if (result.timeout === undefined) defaults.timeout = DEFAULT_TIMEOUT;
  if (result.autoCloseTimeout === undefined || result.autoCloseTimeout === 0) defaults.autoCloseTimeout = DEFAULT_AUTO_CLOSE_TIMEOUT;
  if (result.excludeAudio === undefined) defaults.excludeAudio = true;
  if (result.whitelist === undefined) defaults.whitelist = '';
  if (result.activeTabsToKeep === undefined) defaults.activeTabsToKeep = DEFAULT_KEEP_ACTIVE;
  
  if (Object.keys(defaults).length > 0) {
    await chrome.storage.local.set(defaults);
  }

  // 清理过期的休眠数据和唤醒数据
  const data = await chrome.storage.local.get({ nappedTabsData: {}, awakenedTabsData: {} });
  const allTabs = await chrome.tabs.query({});
  const activeTabIds = new Set(allTabs.map(t => t.id));
  const nappedTabsData = data.nappedTabsData;
  const awakenedTabsData = data.awakenedTabsData;
  let changed = false;

  for (const tabId in nappedTabsData) {
    if (!activeTabIds.has(parseInt(tabId))) {
      delete nappedTabsData[tabId];
      changed = true;
    }
  }

  for (const tabId in awakenedTabsData) {
    if (!activeTabIds.has(parseInt(tabId))) {
      delete awakenedTabsData[tabId];
      changed = true;
    }
  }

  if (changed) {
    await chrome.storage.local.set({ nappedTabsData, awakenedTabsData });
  }

  // 设置定时检查闹钟
  const alarm = await chrome.alarms.get('checkIdleTabs');
  if (!alarm) {
    chrome.alarms.create('checkIdleTabs', { periodInMinutes: CHECK_INTERVAL });
  }

  // 更新所有分组标题
  await updateAllNapGroups();

  // 如果当前窗口的唤醒标签页数量不足，补回休眠标签页
  const lastFocusedWindow = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
  if (lastFocusedWindow?.id) {
    await restoreProtectedTabsIfNeeded(lastFocusedWindow.id);
  }
}

/**
 * 修改标签页标题
 * @param {number} tabId 标签页 ID
 * @param {string} title 新标题
 */
async function setTabTitle(tabId, title) {
  try {
    const tab = await chrome.tabs.get(tabId);
    // 只有在标题还没被记录过时才记录原始标题
    if (!tabOriginalTitles.has(tabId)) {
      tabOriginalTitles.set(tabId, tab.title);
    }
    
    // 如果当前标题已经是我们要设置的，就不再重复设置
    if (tab.title === title) return;

    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: (newTitle) => {
        document.title = newTitle;
      },
      args: [title]
    });
  } catch (e) {
    console.debug('Failed to set tab title:', e.message);
  }
}

/**
 * 恢复标签页原始标题
 * @param {number} tabId 标签页 ID
 */
async function restoreTabTitle(tabId) {
  try {
    if (tabOriginalTitles.has(tabId)) {
      const originalTitle = tabOriginalTitles.get(tabId);
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: (title) => {
          document.title = title;
        },
        args: [originalTitle]
      });
      tabOriginalTitles.delete(tabId);
    }
  } catch (e) {
    console.debug('Failed to restore tab title:', e.message);
  }
}

// 监听安装和启动
chrome.runtime.onInstalled.addListener(initialize);
chrome.runtime.onStartup.addListener(initialize);

// 立即运行初始化（对于扩展重载等情况）
initialize();

function canInjectIntoTab(tab) {
  if (!tab?.id || !tab.url) return false;
  return /^(https?|file):/i.test(tab.url);
}

// 监听扩展图标点击事件
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  if (!canInjectIntoTab(tab)) {
    console.debug('TabNap panel is not available on this page:', tab.url);
    return;
  }

  try {
    // 首先尝试发送消息
    await chrome.tabs.sendMessage(tab.id, { action: 'togglePanel' });
  } catch (err) {
    // 如果消息发送失败（通常是因为 content script 还没注入或上下文已失效）
    // 检查是否是因为扩展上下文失效
    if (err.message && (err.message.includes('Extension context invalidated') || err.message.includes('Could not establish connection'))) {
      console.log('Extension context invalidated or not loaded, attempting to re-inject...');
    }
    
    try {
      // 尝试重新注入 content script
      // 从 manifest 中获取正确的 content.js 和 content.css 路径（处理 Vite 混淆后的文件名）
      const manifest = chrome.runtime.getManifest();
      const contentScript = manifest.content_scripts?.[0];
      const contentJsPath = contentScript?.js?.[0];
      const contentCssPath = contentScript?.css?.[0];

      if (!contentJsPath) {
        throw new Error('No content script is configured in manifest.');
      }
      
      if (contentCssPath) {
        await chrome.scripting.insertCSS({
          target: { tabId: tab.id },
          files: [contentCssPath]
        });
      }

      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: [contentJsPath]
      });
      // 注入成功后再次尝试发送消息
      await chrome.tabs.sendMessage(tab.id, { action: 'togglePanel' });
    } catch (injectErr) {
      console.error('Failed to inject or communicate with content script:', injectErr.message);
    }
  }
});

/**
 * 如果标签页在休眠分组中，将其移出
 * @param {number} tabId 标签页 ID
 */
async function ungroupIfNapped(tabId) {
  try {
    // 清除可能存在的精确休眠定时器
    clearNapTimeout(tabId);

    // 恢复标题（如果之前被修改过）
    await restoreTabTitle(tabId);

    // 清理休眠时间记录，并记录唤醒时间以重置倒计时
    const data = await chrome.storage.local.get({ nappedTabsData: {}, awakenedTabsData: {} });
    let storageChanged = false;
    
    if (data.nappedTabsData[tabId]) {
      delete data.nappedTabsData[tabId];
      storageChanged = true;
    }
    
    // 记录唤醒时间，用于重置休眠倒计时
    data.awakenedTabsData[tabId] = { awakenedAt: Date.now() };
    storageChanged = true;

    if (storageChanged) {
      await chrome.storage.local.set({ 
        nappedTabsData: data.nappedTabsData,
        awakenedTabsData: data.awakenedTabsData 
      });
      // 这里的 storage 变化会触发 popup 的 updatePopup
    }

    const tab = await chrome.tabs.get(tabId);

    // 先移出休眠分组，再处理唤醒。
    // 顺序很重要：如果先 reload，会和 Chrome 自身唤醒被点击的 discarded 标签页产生竞争，
    // 一旦 reload 失败，外层 catch 会跳过后续的 ungroup，导致标签页卡在休眠分组里。
    if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
      const group = await chrome.tabGroups.get(tab.groupId);
      if (isNapGroupTitle(group.title)) {
        await chrome.tabs.ungroup(tab.id);
        // 更新分组标题（若分组已空会自动消失，这里只是保险）
        await updateGroupTitle(group.id);
        // 立即收起分组
        try {
          await chrome.tabGroups.update(group.id, { collapsed: true });
        } catch (groupError) {
          // 如果分组已经没有其他标签页而消失，忽略错误
        }
      }
    }

    // 移出分组后再唤醒：仅在仍是丢弃状态时才 reload，
    // 避免与 Chrome 自身唤醒产生竞争
    if (tab.discarded) {
      try {
        await chrome.tabs.reload(tab.id);
      } catch (reloadError) {
        // 标签页可能已经被 Chrome 自动唤醒或被用户关闭
        console.debug('Failed to reload discarded tab:', reloadError.message);
      }
    }
  } catch (e) {
    // 不要静默吞错，否则类似问题将无从排查
    console.warn('[TabNap:background] ungroupIfNapped failed:', e);
  }
}

// 监听标签页激活
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  // 如果激活的标签页在“休眠”分组中，将其移出分组
  await ungroupIfNapped(activeInfo.tabId);
});

// 监听标签页更新（如刷新、固定状态变化）
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    // URL 变化了，清除记录的原始标题，让下一次预警重新记录
    tabOriginalTitles.delete(tabId);
  }

  if (changeInfo.pinned !== undefined) {
    // 固定状态变化了
    if (changeInfo.pinned) {
      // 如果被固定了，确保它不在休眠分组中
      await ungroupIfNapped(tabId);
    }
    // 可能影响休眠分组的位置
    await updateAllNapGroups();
  }

  if (tab.active) {
    // 兜底：点击休眠分组里的 discarded 标签页时，Chrome 会并发唤醒它，
    // onActivated 里的首次 ungroup 可能因与唤醒竞争而失败。
    // 这里在标签页真正被唤醒（onUpdated 触发）后再尝试一次移出分组。
    await ungroupIfNapped(tabId);
  }
});

// 监听窗口焦点变化，处理切换窗口时活跃标签还在休眠分组的情况
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  
  try {
    const tabs = await chrome.tabs.query({ active: true, windowId: windowId });
    if (tabs.length > 0) {
      const tab = tabs[0];
      await ungroupIfNapped(tab.id);
    }
  } catch (e) {
    // 忽略错误
  }
});

// 监听标签页关闭
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  tabOriginalTitles.delete(tabId);
  clearNapTimeout(tabId);
  
  // 清理休眠时间记录和唤醒时间记录
  const data = await chrome.storage.local.get({ nappedTabsData: {}, awakenedTabsData: {} });
  let storageChanged = false;
  if (data.nappedTabsData[tabId]) {
    delete data.nappedTabsData[tabId];
    storageChanged = true;
  }
  if (data.awakenedTabsData[tabId]) {
    delete data.awakenedTabsData[tabId];
    storageChanged = true;
  }
  if (storageChanged) {
    await chrome.storage.local.set({ 
      nappedTabsData: data.nappedTabsData,
      awakenedTabsData: data.awakenedTabsData 
    });
  }

  if (!removeInfo?.isWindowClosing) {
    await restoreProtectedTabsIfNeeded(removeInfo.windowId);
  }
  updateAllNapGroups();
});

// 监听分组移动，确保休眠分组始终在最左侧
chrome.tabGroups.onMoved.addListener(async (group) => {
  if (isNapGroupTitle(group.title)) {
    await updateGroupTitle(group.id);
  }
});

// 监听标签页创建，确保休眠分组始终在最左侧
chrome.tabs.onCreated.addListener(async () => {
  await updateAllNapGroups();
});

// 监听标签页移动，确保休眠分组始终在最左侧
chrome.tabs.onMoved.addListener(async () => {
  await updateAllNapGroups();
});

// 监听标签页附着到窗口，确保休眠分组始终在最左侧
chrome.tabs.onAttached.addListener(async () => {
  await updateAllNapGroups();
});

// 监听设置变化
chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== 'local') return;

  if (changes.timeout && changes.timeout.newValue !== changes.timeout.oldValue) {
    console.log('Timeout setting changed, resetting all timers...');
    await resetAllTimers();
  }

  // 语言切换：同步内存缓存并刷新所有休眠分组标题
  if (changes.language && changes.language.newValue !== changes.language.oldValue) {
    i18n.setLanguage(changes.language.newValue);
    await updateAllNapGroups();
  }
});

/**
 * 重置所有标签页的休眠计时
 */
async function resetAllTimers() {
  try {
    // 获取当前活跃窗口
    const lastFocusedWindow = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    if (!lastFocusedWindow) return;

    const tabs = await chrome.tabs.query({ discarded: false, windowId: lastFocusedWindow.id });
    const data = await chrome.storage.local.get({ awakenedTabsData: {} });
    const now = Date.now();
    
    for (const tab of tabs) {
      // 1. 清除预警倒计时
      clearNapTimeout(tab.id);
      
      // 2. 恢复标题
      await restoreTabTitle(tab.id);
      
      // 3. 更新唤醒时间，从而重置倒计时
      data.awakenedTabsData[tab.id] = { awakenedAt: now };
    }
    
    await chrome.storage.local.set({ awakenedTabsData: data.awakenedTabsData });
    console.log('All timers have been reset.');
  } catch (e) {
    console.error('Error resetting timers:', e);
  }
}

// 闹钟触发：检查并休眠标签页
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkIdleTabs') {
    checkAndNapTabs();
  }
});

// 监听来自 popup 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'napNow':
      checkAndNapTabs(true);
      return false;
    case 'napSingleTab':
      (async () => {
        try {
          const tab = await chrome.tabs.get(request.tabId);
          if (tab) await napTab(tab);
        } catch (e) {
          console.error('[TabNap:background] Error napping single tab:', e);
        }
        sendResponse({});
      })();
      return true;
    case 'wakeUpSingleTab':
      ungroupIfNapped(request.tabId);
      return false;
    case 'wakeUpAll':
      wakeUpAllTabs();
      return false;
    case 'wakeUpByWhitelist':
      wakeUpByWhitelist();
      return false;
    case 'getPopupTabs':
      (async () => {
        const senderWindowId = sender.tab?.windowId;
        debugLog('getPopupTabs requested.', {
          senderWindowId,
          senderTabId: sender.tab?.id,
          senderUrl: sender.tab?.url,
          hasSenderTab: Boolean(sender.tab)
        });

        if (typeof senderWindowId === 'number') {
          const tabs = await chrome.tabs.query({ windowId: senderWindowId });
          debugLog('Queried tabs by sender window.', {
            windowId: senderWindowId,
            tabCount: tabs.length
          });
          if (tabs.length > 0) {
            sendResponse({ tabs, windowId: senderWindowId });
            return;
          }
        }

        const lastFocusedWindow = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
        if (lastFocusedWindow?.id) {
          const tabs = await chrome.tabs.query({ windowId: lastFocusedWindow.id });
          debugLog('Queried tabs by last focused window.', {
            windowId: lastFocusedWindow.id,
            tabCount: tabs.length
          });
          if (tabs.length > 0) {
            sendResponse({ tabs, windowId: lastFocusedWindow.id });
            return;
          }
        }

        const tabs = await chrome.tabs.query({});
        debugWarn('Falling back to all tabs query.', {
          tabCount: tabs.length,
          senderWindowId,
          lastFocusedWindowId: lastFocusedWindow?.id
        });
        sendResponse({ tabs, windowId: senderWindowId || lastFocusedWindow?.id || null });
      })().catch(error => {
        console.error('[TabNap:background] Failed to resolve popup tabs:', error);
        sendResponse({ tabs: [], windowId: sender.tab?.windowId || null, error: error.message });
      });
      return true;
    default:
      return false;
  }
});

/**
 * 检查所有丢弃的标签页，如果符合白名单则唤醒
 */
async function wakeUpByWhitelist() {
  try {
    const settings = await chrome.storage.local.get({ whitelist: '' });
    const whitelist = settings.whitelist.split('\n')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    if (whitelist.length === 0) return;

    // 获取当前活跃窗口
    const lastFocusedWindow = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    if (!lastFocusedWindow) return;

    // 获取当前窗口所有丢弃的标签页
    const tabs = await chrome.tabs.query({ discarded: true, windowId: lastFocusedWindow.id });
    for (const tab of tabs) {
      const isWhitelisted = whitelist.some(pattern => {
        return (tab.url && tab.url.includes(pattern)) || (tab.title && tab.title.includes(pattern));
      });
      
      if (isWhitelisted) {
        await ungroupIfNapped(tab.id);
      }
    }
  } catch (e) {
    console.error('Error waking up tabs by whitelist:', e);
  }
}

/**
 * 唤醒所有已休眠的标签页
 */
async function wakeUpAllTabs() {
  try {
    // 获取当前活跃窗口
    const lastFocusedWindow = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    if (!lastFocusedWindow) return;

    const tabs = await chrome.tabs.query({ discarded: true, windowId: lastFocusedWindow.id });
    for (const tab of tabs) {
      await ungroupIfNapped(tab.id);
    }
  } catch (e) {
    console.error('Error waking up all tabs:', e);
  }
}

/**
 * 检查所有非活动标签页并休眠
 */
async function checkAndNapTabs(force = false) {
  const settings = await chrome.storage.local.get({
    timeout: DEFAULT_TIMEOUT,
    autoCloseTimeout: DEFAULT_AUTO_CLOSE_TIMEOUT,
    excludeAudio: true,
    whitelist: '',
    awakenedTabsData: {},
    activeTabsToKeep: DEFAULT_KEEP_ACTIVE,
    enableAutoSleep: null,
    enableAutoClose: null,
    enableKeepActive: null
  });
  
  const timeoutMs = settings.timeout * 60 * 1000;
  const autoCloseTimeoutMs = settings.autoCloseTimeout * 60 * 1000;
  const now = Date.now();
  const whitelist = settings.whitelist.split('\n')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  // 开关状态（兼容旧配置：如果未设置开关，则按原数值判断）
  const enableAutoSleep = settings.enableAutoSleep ?? true;
  const enableAutoClose = settings.enableAutoClose ?? false;
  const enableKeepActive = settings.enableKeepActive ?? (settings.activeTabsToKeep > 0);

  // 获取当前活跃窗口
  const lastFocusedWindow = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
  const currentWindowId = lastFocusedWindow ? lastFocusedWindow.id : null;

  // 获取所有非活动、非固定标签页
  let tabs = await chrome.tabs.query({ 
    active: false, 
    pinned: false
  });
  const nappedThisRun = new Set();

  // 如果设置了保留最近活跃的标签页
  if (enableKeepActive && settings.activeTabsToKeep > 0) {
    // 按最后访问时间降序排序（最近访问的在前）
    tabs.sort((a, b) => {
      const aAwakenedAt = settings.awakenedTabsData[a.id]?.awakenedAt || 0;
      const aLastActive = Math.max(a.lastAccessed || 0, aAwakenedAt);
      
      const bAwakenedAt = settings.awakenedTabsData[b.id]?.awakenedAt || 0;
      const bLastActive = Math.max(b.lastAccessed || 0, bAwakenedAt);
      
      return bLastActive - aLastActive;
    });

    // 排除掉最近活跃的前 N 个标签页
    // 只有非休眠标签页才受此保护，已休眠的如果达到自动关闭时间应该关闭
    const protectedTabIds = new Set(tabs.slice(0, settings.activeTabsToKeep).map(t => t.id));
    tabs = tabs.filter(t => !protectedTabIds.has(t.id));
  }

  for (const tab of tabs) {
    // 如果插件设置为仅管理当前窗口，则跳过非当前窗口的标签页
    // 并且确保清除这些标签页可能存在的预警状态
    if (tab.windowId !== currentWindowId) {
      clearNapTimeout(tab.id);
      await restoreTabTitle(tab.id);
      continue;
    }

    // 再次检查是否为固定标签页（双重保险）
    if (tab.pinned) {
      continue;
    }

    // 检查音频过滤
    if (settings.excludeAudio && tab.audible) {
      continue;
    }

    // 检查白名单过滤
    if (whitelist.length > 0) {
      const isWhitelisted = whitelist.some(pattern => {
        return (tab.url && tab.url.includes(pattern)) || (tab.title && tab.title.includes(pattern));
      });
      if (isWhitelisted) {
        continue;
      }
    }

    // 计算空闲时间：取 (最近访问时间) 和 (最近唤醒时间) 中的较大值
    const awakenedAt = settings.awakenedTabsData[tab.id]?.awakenedAt || 0;
    const lastActive = Math.max(tab.lastAccessed || 0, awakenedAt);
    const timeSinceActive = now - lastActive;

    // 优先处理自动关闭
    if (enableAutoClose && settings.autoCloseTimeout > 0 && timeSinceActive > autoCloseTimeoutMs) {
      try {
        await chrome.tabs.remove(tab.id);
        console.log(`Tab ${tab.id} auto-closed due to inactivity.`);
        continue; // 标签已关闭，跳过后续休眠检查
      } catch (e) {
        console.debug('Failed to auto-close tab:', e.message);
      }
    }

    // 如果还没被关闭，再检查是否需要休眠 (仅针对非 discarded 标签)
    if (!tab.discarded) {
      // 如果是强制触发，或者超过了时间
      if (enableAutoSleep && (force || (timeSinceActive > timeoutMs))) {
        await napTab(tab);
        nappedThisRun.add(tab.id);
      } else if (enableAutoSleep && timeSinceActive > timeoutMs - WARNING_THRESHOLD) {
        // 如果即将进入休眠（10秒内）
        await setTabTitle(tab.id, i18n.getWarningText());
        
        // 如果还没有设置精确倒计时，则设置一个
        if (!tabNapTimeouts.has(tab.id)) {
          const remainingMs = timeoutMs - timeSinceActive;
          const timeoutId = setTimeout(async () => {
            tabNapTimeouts.delete(tab.id);
            // 重新获取标签页状态，确保它仍然符合休眠条件
            try {
              const currentTab = await chrome.tabs.get(tab.id);
              if (!currentTab.active && !currentTab.discarded) {
                // 在精确倒计时结束时，也要先检查一次是否应该直接关闭
                const settingsNow = await chrome.storage.local.get({ autoCloseTimeout: DEFAULT_AUTO_CLOSE_TIMEOUT, enableAutoClose: null });
                const currentNow = Date.now();
                const currentAwakenedAt = (await chrome.storage.local.get({ awakenedTabsData: {} })).awakenedTabsData[tab.id]?.awakenedAt || 0;
                const currentLastActive = Math.max(currentTab.lastAccessed || 0, currentAwakenedAt);
                const enableCloseNow = settingsNow.enableAutoClose ?? false;
                if (enableCloseNow && settingsNow.autoCloseTimeout > 0 && (currentNow - currentLastActive) > (settingsNow.autoCloseTimeout * 60 * 1000)) {
                  await chrome.tabs.remove(currentTab.id);
                  return;
                }
                await napTab(currentTab);
              }
            } catch (e) {
              // 标签页可能已关闭
            }
          }, remainingMs);
          tabNapTimeouts.set(tab.id, timeoutId);
        }
      } else {
        // 还没到休眠时间，且不在预警范围内
        await restoreTabTitle(tab.id);
        // 如果有正在运行的倒计时，清除它
        clearNapTimeout(tab.id);
      }
    }
  }

  await restoreProtectedTabsIfNeeded(currentWindowId, settings, nappedThisRun);
}

async function napTab(tab) {
  try {
    if (tab.pinned) return;

    // 如果该标签页有正在运行的精确倒计时，清除它
    clearNapTimeout(tab.id);
    await activateReplacementTab(tab);

    const targetIndex = await getFirstNonPinnedIndex(tab.windowId);
    
    // 1. 移动到目标位置 (固定标签页之后)
    try {
      if (tab.index !== targetIndex) {
        await chrome.tabs.move(tab.id, { index: targetIndex });
      }
    } catch (moveError) {
      console.warn('Could not move tab to target index:', moveError.message);
    }

    // 2. 尝试加入“休眠”分组
    // 查找当前窗口中是否已有休眠分组
    const groups = await chrome.tabGroups.query({ windowId: tab.windowId });
    const napGroup = groups.find(g => isNapGroupTitle(g.title));
    
    let groupId;
    if (napGroup) {
      groupId = napGroup.id;
      await chrome.tabs.group({ tabIds: [tab.id], groupId: groupId });
      await updateGroupTitle(groupId);
      await chrome.tabGroups.update(groupId, { collapsed: true });
    } else {
      // 创建新分组
      groupId = await chrome.tabs.group({
        tabIds: [tab.id],
        createProperties: { windowId: tab.windowId }
      });
      await chrome.tabGroups.update(groupId, {
        title: `${getNapGroupBaseTitle()} (1)`,
        color: 'grey',
        collapsed: true // 自动折叠，像个文件夹
      });
      // 确保新分组在正确位置
      await updateGroupTitle(groupId);
    }

    // 3. 恢复原始标题（在休眠前恢复，确保丢弃状态显示正确标题）
    await restoreTabTitle(tab.id);

    // 4. 丢弃标签页以释放内存
    await chrome.tabs.discard(tab.id);
    await chrome.tabGroups.update(groupId, { collapsed: true });
    
    // 5. 记录休眠时间，并清理唤醒时间记录
    const data = await chrome.storage.local.get({ nappedTabsData: {}, awakenedTabsData: {} });
    data.nappedTabsData[tab.id] = { nappedAt: Date.now() };
    if (data.awakenedTabsData[tab.id]) {
      delete data.awakenedTabsData[tab.id];
    }
    await chrome.storage.local.set({ 
      nappedTabsData: data.nappedTabsData,
      awakenedTabsData: data.awakenedTabsData
    });
    
    console.log(`Tab ${tab.id} has been napped and moved to archive.`);
  } catch (e) {
    console.error('Error napping tab:', e);
  }
}
