/**
 * TabNap i18n layer
 *
 * Chrome 的 chrome.i18n.getMessage() 始终读取浏览器 UI 语言，无法被代码覆盖。
 * 因此本模块提供「跟随浏览器(auto) / 中文(zh) / English(en)」三种语言模式：
 *   - auto: 直接走 chrome.i18n.getMessage()，由浏览器根据 UI 语言自动选 _locales
 *   - zh/en: 查询内嵌字典，缺失时回落到 chrome.i18n.getMessage()
 *
 * 作为经典脚本存在（无 import/export），可同时被以下两处加载：
 *   - popup.html 的 <script src="i18n.js">（经典脚本，先于 ES module 执行）
 *   - background.js 的 importScripts('i18n.js')（MV3 经典 service worker）
 * 挂载到 globalThis.TabNapI18n。
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'language';
  const DEFAULT_LANGUAGE = 'auto';
  const VALID_LANGUAGES = ['auto', 'zh', 'en'];

  // 缓存当前语言设置。getMessage 需要同步可用，因此启动时先 load 一次。
  let currentLanguage = DEFAULT_LANGUAGE;

  // 内嵌翻译字典（仅手动切换模式使用；auto 模式走 chrome.i18n）。
  // 与 _locales/*/messages.json 保持一致。
  const DICTIONARIES = {
    zh: {
      popupTitle: 'TabNap',
      searchPlaceholder: '搜索标签页...',
      openOptions: '打开设置',
      reloadAllTabs: '刷新所有标签页',
      optionsTitle: 'TabNap 设置',
      timeoutLabel: '自动休眠',
      autoCloseTimeoutLabel: '自动关闭',
      keepActiveLabel: '受保护标签页',
      timeoutHelp: '闲置 N 分钟的标签页将休眠，并归入休眠分组。',
      autoCloseHelp: '闲置 N 分钟的标签页将被自动关闭。',
      keepActiveHelp: '最近的 N 个标签页保持运行，不会被休眠或关闭。',
      excludeAudioLabel: '保留正在播放音频的标签页',
      whitelistLabel: '白名单',
      whitelistDescription: '每行一个关键词或域名',
      whitelistPlaceholder: '例如：youtube.com\ngmail.com\nmusic',
      statusSaved: '设置已保存。',
      minutes: '分钟',
      seconds: '秒',
      afterSleep: ' 后休眠',
      napGroupTitle: '☕',
      warningText: '即将休眠...',
      nappedFor: '已休眠',
      autoCloseIn: ' 后关闭',
      closeTab: '关闭标签页',
      tabActive: '运行中',
      tabNapped: '已休眠',
      back: '返回',
      closePanel: '关闭面板',
      pinnedStatus: '已固定',
      currentTabHover: '当前标签页',
      whitelistedTabHover: '白名单标签页',
      napSingleTab: '休眠',
      wakeUpSingleTab: '唤醒',
      addToWhitelist: '加入白名单',
      removeFromWhitelist: '移出白名单',
      languageLabel: '语言',
      languageAuto: '跟随浏览器'
    },
    en: {
      popupTitle: 'TabNap',
      searchPlaceholder: 'Search tabs...',
      openOptions: 'Open Options',
      reloadAllTabs: 'Refresh All Tabs',
      optionsTitle: 'TabNap Settings',
      timeoutLabel: 'Auto Nap',
      autoCloseTimeoutLabel: 'Auto Close',
      keepActiveLabel: 'Protected Tabs',
      timeoutHelp: 'Tabs idle for N minutes will nap and be archived under the Nap group.',
      autoCloseHelp: 'Tabs idle for N minutes will be closed automatically.',
      keepActiveHelp: 'The most recent N tabs stay running and will not nap or close.',
      excludeAudioLabel: 'Keep Tabs Playing Audio',
      whitelistLabel: 'Whitelist',
      whitelistDescription: 'One keyword or domain per line',
      whitelistPlaceholder: 'e.g.: youtube.com\ngmail.com\nmusic',
      statusSaved: 'Settings saved.',
      minutes: 'mins',
      seconds: 's',
      afterSleep: ' to nap',
      napGroupTitle: '☕',
      warningText: 'Napping soon...',
      nappedFor: 'Napped',
      autoCloseIn: ' to close',
      closeTab: 'Close Tab',
      tabActive: 'Running',
      tabNapped: 'Napped',
      back: 'Back',
      closePanel: 'Close Panel',
      pinnedStatus: 'Pinned',
      currentTabHover: 'Current Tab',
      whitelistedTabHover: 'Whitelisted Tab',
      napSingleTab: 'Nap',
      wakeUpSingleTab: 'Wake Up',
      addToWhitelist: 'Add to Whitelist',
      removeFromWhitelist: 'Remove from Whitelist',
      languageLabel: 'Language',
      languageAuto: 'Follow Browser'
    }
  };

  function normalizeLanguage(lang) {
    return VALID_LANGUAGES.includes(lang) ? lang : DEFAULT_LANGUAGE;
  }

  /**
   * 把 chrome.i18n.getUILanguage() 的结果映射到 zh / en。
   * 形如 "zh-CN" / "zh-TW" / "zh-HK" 都视为中文。
   */
  function detectLocale() {
    try {
      const ui = (chrome.i18n.getUILanguage() || '').toLowerCase();
      if (ui.startsWith('zh')) return 'zh';
    } catch (e) {
      // 忽略，回落到 en
    }
    return 'en';
  }

  /**
   * 解析当前应使用的 locale：'zh' 或 'en'。
   * auto 模式按浏览器 UI 语言判定。
   */
  function resolveLocale() {
    const lang = currentLanguage;
    if (lang === 'zh' || lang === 'en') return lang;
    return detectLocale();
  }

  /**
   * 获取当前语言设置（原始值：auto / zh / en）。
   */
  function getLanguage() {
    return currentLanguage;
  }

  /**
   * 同步设置当前语言（仅更新内存缓存）。持久化由调用方写 storage 后触发本方法。
   * @param {string} lang auto / zh / en
   */
  function setLanguage(lang) {
    currentLanguage = normalizeLanguage(lang);
  }

  /**
   * 从 storage 读取语言设置并缓存。各上下文启动时调用一次。
   * 返回 Promise<string>，resolve 为实际生效语言（auto/zh/en）。
   */
  function loadLanguage() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get({ [STORAGE_KEY]: DEFAULT_LANGUAGE }, (items) => {
          if (chrome.runtime.lastError) {
            resolve(currentLanguage);
            return;
          }
          currentLanguage = normalizeLanguage(items[STORAGE_KEY]);
          resolve(currentLanguage);
        });
      } catch (e) {
        resolve(currentLanguage);
      }
    });
  }

  /**
   * 取消息文案。
   *   - auto 模式：直接 chrome.i18n.getMessage（由浏览器按 UI 语言选 _locales）
   *   - 手动模式：先查内嵌字典，缺失则回落到 chrome.i18n.getMessage
   * @param {string} key 消息键
   * @param {string|string[]} [substitutions] 占位符替换（auto/回落时透传给 chrome）
   * @returns {string} 文案（无匹配时返回空串，行为与 chrome.i18n.getMessage 一致）
   */
  function getMessage(key, substitutions) {
    const lang = currentLanguage;
    if (lang !== 'auto') {
      const dict = DICTIONARIES[lang];
      const value = dict && dict[key];
      if (value !== undefined) {
        return applySubstitutions(value, substitutions);
      }
      // 字典缺失，回落到 chrome.i18n（至少能给出 en 或浏览器语言的结果）
    }
    try {
      return chrome.i18n.getMessage(key, substitutions) || '';
    } catch (e) {
      return '';
    }
  }

  function applySubstitutions(message, substitutions) {
    if (substitutions === undefined) return message;
    const subs = Array.isArray(substitutions) ? substitutions : [substitutions];
    // chrome.i18n 占位符语法为 $1, $2, ...
    return message.replace(/\$(\d+)/g, (match, index) => {
      const i = parseInt(index, 10) - 1;
      return i >= 0 && i < subs.length ? String(subs[i]) : match;
    });
  }

  /**
   * 返回休眠分组标题的基础前缀。统一为 emoji，中英文均显示 ☕，
   * 实际分组标题形如 "☕ (3)"。
   */
  function getNapGroupBaseTitle() {
    return '☕';
  }

  /**
   * 返回当前语言的「即将休眠」预警文案。
   */
  function getWarningText() {
    return getMessage('warningText') || 'Napping soon...';
  }

  /**
   * 判断某标题是否为休眠分组标题。
   * 当前格式统一为 "☕" 或 "☕ (N)"，中英文一致；
   * 同时兼容历史遗留的 "😴" / "♻️" 及其带语言文字的旧文案，
   * 以便升级后仍能识别既有分组并自动迁移到新格式。
   */
  function isNapGroupTitle(title) {
    if (!title) return false;
    // 新格式（仅 emoji）及其带计数版本，统一匹配。
    if (title === '☕' || /^☕\s*\(\d+\)$/.test(title)) return true;
    // 历史遗留文案：旧版会带语言文字或使用旧的 😴 / ♻️ 图标。
    const legacyKnown = new Set([
      '😴',
      '😴 Nap',
      '😴 小睡',
      '♻️',
      '♻️ Nap',
      '♻️ 小睡',
      'Nap'
    ]);
    if (legacyKnown.has(title)) return true;
    // 形如 "😴 Nap (3)" / "😴 小睡 (3)" / "♻️ Nap (3)" / "♻️ 小睡 (3)" 的旧版带计数标题
    return /^[😴♻️]\s*(Nap|小睡)?\s*\(\d+\)$/.test(title);
  }

  global.TabNapI18n = {
    getLanguage,
    setLanguage,
    loadLanguage,
    resolveLocale,
    getMessage,
    getNapGroupBaseTitle,
    getWarningText,
    isNapGroupTitle
  };
})(globalThis);
