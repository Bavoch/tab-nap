import './content.css';

(function() {
  if (window.tabNapInitialized) return;
  window.tabNapInitialized = true;

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

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'togglePanel') {
      togglePanel();
      sendResponse({ status: 'done' });
    }
  });

  // Listen for messages from the iframe (e.g. to close the panel)
  window.addEventListener('message', (event) => {
    if (event.data === 'closeTabNapPanel') {
      togglePanel(false);
    }
  });
})();
