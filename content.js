function mountPanel() {
  if (document.getElementById('tab-nap-root')) return;

  const root = document.createElement('div');
  root.id = 'tab-nap-root';

  const iframe = document.createElement('iframe');
  iframe.id = 'tab-nap-iframe';
  iframe.src = chrome.runtime.getURL('popup.html');

  root.appendChild(iframe);
  document.body.appendChild(root);

  function togglePanel(show) {
    const nextState = show === undefined ? !root.classList.contains('active') : show;
    root.classList.toggle('active', nextState);
  }

  function isRuntimeAlive() {
    return !!chrome.runtime?.id;
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action !== 'togglePanel') return;

    if (!isRuntimeAlive()) {
      root.classList.remove('active');
      return;
    }

    togglePanel();
    sendResponse({ status: 'done' });
  });

  window.addEventListener('message', (event) => {
    if (event.data === 'closeTabNapPanel') {
      togglePanel(false);
      return;
    }

    if (event.source === iframe.contentWindow && event.data?.type === 'tabNapRequestTabs') {
      if (!isRuntimeAlive()) {
        root.classList.remove('active');
        return;
      }

      chrome.runtime.sendMessage({ action: 'getPopupTabs' }, (response) => {
        if (chrome.runtime.lastError) {
          root.classList.remove('active');
          return;
        }

        iframe.contentWindow?.postMessage({
          type: 'tabNapTabsResponse',
          requestId: event.data.requestId,
          response
        }, '*');
      });
      return;
    }

    if (event.data?.type === 'tabNapResize') {
      const nextHeight = Math.min(Number(event.data.height) || 0, 550);
      if (nextHeight > 0) {
        root.style.height = `${nextHeight}px`;
        iframe.style.height = `${nextHeight}px`;
      }
    }
  });
}

if (document.body) {
  mountPanel();
} else {
  document.addEventListener('DOMContentLoaded', mountPanel, { once: true });
}
