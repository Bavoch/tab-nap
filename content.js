  import './content.css';

(function() {
  if (window.tabNapInitialized) return;
  window.tabNapInitialized = true;

  function debugLog(...args) {
    console.debug('[TabNap:content]', ...args);
  }

  function debugWarn(...args) {
    console.warn('[TabNap:content]', ...args);
  }

  const root = document.createElement('div');
  root.id = 'tab-nap-root';
  
  const iframe = document.createElement('iframe');
  iframe.id = 'tab-nap-iframe';
  iframe.src = chrome.runtime.getURL('popup.html');

  root.appendChild(iframe);
  document.body.appendChild(root);

  function togglePanel(show) {
    if (show === undefined) {
      show = !root.classList.contains('active');
    }

    if (show) {
      root.classList.add('active');
    } else {
      root.classList.remove('active');
    }
  }

  function isContextValid() {
    return !!chrome.runtime?.id;
  }

  function handleInvalidContext() {
    debugWarn('Runtime context is invalid; hiding panel.');
    root.classList.remove('active');
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!isContextValid()) {
      debugWarn('Ignoring runtime message because context is invalid.', request);
      return;
    }
    
    if (request.action === 'togglePanel') {
      debugLog('Received togglePanel message.');
      togglePanel();
      sendResponse({ status: 'done' });
    }
  });

  // Listen for messages from the iframe (e.g. to close the panel)
  window.addEventListener('message', (event) => {
    if (event.data === 'closeTabNapPanel') {
      togglePanel(false);
      return;
    }

    if (event.source === iframe.contentWindow && event.data?.type === 'tabNapRequestTabs') {
      debugLog('Received tab request from popup iframe.', { requestId: event.data.requestId });
      try {
        if (!isContextValid()) {
          handleInvalidContext();
          return;
        }

        chrome.runtime.sendMessage({ action: 'getPopupTabs' }, (response) => {
          if (chrome.runtime.lastError) {
            debugWarn('getPopupTabs runtime error.', chrome.runtime.lastError.message);
            handleInvalidContext();
            return;
          }

          debugLog('Forwarding tabs response to popup iframe.', {
            requestId: event.data.requestId,
            tabCount: Array.isArray(response?.tabs) ? response.tabs.length : null,
            windowId: response?.windowId,
            error: response?.error
          });

          iframe.contentWindow?.postMessage({
            type: 'tabNapTabsResponse',
            requestId: event.data.requestId,
            response
          }, '*');
        });
      } catch (error) {
        if (error instanceof Error && error.message.includes('Extension context invalidated')) {
          debugWarn('Caught Extension context invalidated while handling iframe request.');
          handleInvalidContext();
          return;
        }

        console.error('[TabNap:content] Unexpected iframe request error:', error);
        throw error;
      }
      return;
    }

    if (event.data && event.data.type === 'tabNapResize') {
      const nextHeight = Math.min(Number(event.data.height) || 0, 550);
      if (nextHeight > 0) {
        root.style.height = `${nextHeight}px`;
        iframe.style.height = `${nextHeight}px`;
      }
    }
  });
})();
