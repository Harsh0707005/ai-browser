const { app, BrowserWindow, BrowserView, ipcMain, globalShortcut } = require('electron/main')
const path = require('path')
const { injectClickableOverlays } = require('./image-based')

let mainWindow
let sidebarOpen = false
let sidebarWidth = 0

const tabs = new Map()
let activeTabId = null
let nextTabId = 1

const TOOLBAR_HEIGHT = 128

const getActiveView = () => activeTabId ? tabs.get(activeTabId)?.view : null
const getViewForTab = (tabId) => tabId ? tabs.get(tabId)?.view : getActiveView()

const updateBrowserViewBounds = () => {
  const view = getActiveView()
  if (!mainWindow || !view) return
  const bounds = mainWindow.getContentBounds()
  const reserved = sidebarOpen ? sidebarWidth : 0
  
  const activeTab = tabs.get(activeTabId)
  const isAgent = activeTab?.isAgent
  const borderWidth = isAgent ? 6 : 0

  view.setBounds({
    x: borderWidth,
    y: TOOLBAR_HEIGHT + borderWidth,
    width: bounds.width - reserved - (borderWidth * 2),
    height: bounds.height - TOOLBAR_HEIGHT - (borderWidth * 2)
  })
}

function sendTabsUpdate() {
  if (!mainWindow) return
  const tabList = []
  for (const [id, tab] of tabs) {
    tabList.push({ id, title: tab.title, url: tab.url })
  }
  mainWindow.webContents.send('tabs-updated', { tabs: tabList, activeTabId })
}

function wireViewEvents(tabId, view) {
  view.webContents.on('did-start-loading', () => {
    if (tabId === activeTabId && mainWindow) {
      mainWindow.webContents.send('navigation-start')
    }
  })

  view.webContents.on('did-finish-load', () => {
    const tab = tabs.get(tabId)
    if (tab) {
      tab.url = view.webContents.getURL()
      tab.title = view.webContents.getTitle() || tab.url
      sendTabsUpdate()
    }
    if (tabId === activeTabId && mainWindow) {
      mainWindow.webContents.send('navigation-complete', {
        url: view.webContents.getURL(),
        title: view.webContents.getTitle(),
        canGoBack: view.webContents.canGoBack(),
        canGoForward: view.webContents.canGoForward()
      })
    }
    
    view.webContents.insertCSS(`
      #ai-sel-popup {
        position: fixed;
        z-index: 2147483646;
        background: #1a1a1a;
        border: 1px solid #444;
        border-radius: 12px;
        padding: 14px 18px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
        min-width: 240px;
        box-shadow: 0 4px 24px rgba(0,0,0,0.5);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.15s ease;
      }
      #ai-sel-popup.visible {
        opacity: 1;
        pointer-events: auto;
      }
      #ai-sel-popup .ai-sel-summarize {
        padding: 8px 20px;
        border-radius: 8px;
        border: none;
        background: linear-gradient(135deg, #3a3a4a 0%, #2d2d3a 100%);
        color: #e8e8e8;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        letter-spacing: 0.3px;
        transition: background 0.2s, transform 0.1s;
        box-shadow: 0 1px 3px rgba(0,0,0,0.3);
      }
      #ai-sel-popup .ai-sel-summarize:hover {
        background: linear-gradient(135deg, #4a4a5a 0%, #3d3d4a 100%);
        transform: translateY(-1px);
      }
      #ai-sel-popup .ai-sel-summarize:active {
        transform: translateY(0);
      }
      #ai-sel-popup .ai-sel-or {
        font-size: 11px;
        color: #888;
        letter-spacing: 0.5px;
        text-transform: uppercase;
      }
      #ai-sel-popup .ai-sel-input-wrap {
        width: 100%;
        display: flex;
        align-items: center;
        border: 1px solid #444;
        border-radius: 8px;
        background: #252526;
        overflow: hidden;
      }
      #ai-sel-popup .ai-sel-input-wrap:focus-within {
        border-color: #555;
      }
      #ai-sel-popup .ai-sel-input-wrap input {
        flex: 1;
        min-width: 0;
        padding: 8px 12px;
        border: none;
        background: transparent;
        color: #e0e0e0;
        font-size: 12px;
        font-family: inherit;
        outline: none;
      }
      #ai-sel-popup .ai-sel-input-wrap input::placeholder {
        color: #666;
      }
      #ai-sel-popup .ai-sel-send {
        flex-shrink: 0;
        width: 36px;
        height: 36px;
        border: none;
        background: transparent;
        color: #888;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        transition: color 0.15s, background 0.15s;
      }
      #ai-sel-popup .ai-sel-send:hover {
        color: #e0e0e0;
        background: #333;
      }
    `)
    view.webContents.executeJavaScript(`
      (function() {
        if (document.getElementById('ai-sel-popup')) return;
        var popup = document.createElement('div');
        popup.id = 'ai-sel-popup';
        var btnS = document.createElement('button');
        btnS.className = 'ai-sel-summarize';
        btnS.textContent = 'Summarize';
        var orLabel = document.createElement('div');
        orLabel.className = 'ai-sel-or';
        orLabel.textContent = 'or';
        var wrap = document.createElement('div');
        wrap.className = 'ai-sel-input-wrap';
        var inp = document.createElement('input');
        inp.type = 'text';
        inp.placeholder = 'Ask about this...';
        var sendBtn = document.createElement('button');
        sendBtn.className = 'ai-sel-send';
        sendBtn.type = 'button';
        sendBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8h12M9 4l4 4-4 4"/></svg>';
        wrap.appendChild(inp);
        wrap.appendChild(sendBtn);
        popup.appendChild(btnS);
        popup.appendChild(orLabel);
        popup.appendChild(wrap);
        document.body.appendChild(popup);
        var selText = '';
        function hide() {
          popup.classList.remove('visible');
          inp.value = '';
        }
        function show(centerX, y) {
          popup.style.left = centerX + 'px';
          popup.style.top = y + 'px';
          popup.style.transform = 'translateX(-50%)';
          popup.classList.add('visible');
          inp.value = '';
          setTimeout(function() { inp.focus(); }, 50);
        }
        function sendAsk() {
          var q = inp.value.trim();
          console.log('__AI_ACTION__:' + JSON.stringify({ type: 'ask', text: selText, query: q }));
          hide();
          window.getSelection().removeAllRanges();
        }
        document.addEventListener('mouseup', function(e) {
          if (popup.contains(e.target)) return;
          setTimeout(function() {
            var sel = window.getSelection();
            var t = (sel ? sel.toString() : '').trim();
            if (t.length > 3) {
              selText = t;
              var range = sel.getRangeAt(0);
              var rect = range.getBoundingClientRect();
              var centerX = rect.left + rect.width / 2;
              var py = rect.top - 120;
              if (py < 8) py = rect.bottom + 8;
              show(Math.max(120, Math.min(window.innerWidth - 120, centerX)), py);
            } else { hide(); }
          }, 10);
        });
        document.addEventListener('mousedown', function(e) {
          if (!popup.contains(e.target)) hide();
        });
        document.addEventListener('scroll', hide, true);
        btnS.addEventListener('click', function() {
          console.log('__AI_ACTION__:' + JSON.stringify({ type: 'summarize', text: selText }));
          hide();
          window.getSelection().removeAllRanges();
        });
        inp.addEventListener('keydown', function(e) {
          if (e.key === 'Enter') {
            e.preventDefault();
            sendAsk();
          }
        });
        sendBtn.addEventListener('click', sendAsk);
      })()
    `)

    injectClickableOverlays(view.webContents)

    if (tab && tab.isAgent) {
      view.webContents.insertCSS(`
        #agent-toast-pill {
          position: fixed;
          top: 24px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 2147483647;
          padding: 8px 24px;
          border-radius: 30px;
          background: linear-gradient(135deg, #6366f1, #8b5cf6);
          color: white;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          font-size: 13px;
          font-weight: 500;
          letter-spacing: 0.3px;
          box-shadow: 0 4px 20px rgba(139, 92, 246, 0.4);
          border: 1px solid rgba(255, 255, 255, 0.2);
          backdrop-filter: blur(8px);
          pointer-events: none;
          opacity: 0;
          transition: opacity 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);
          animation: agent-float 3s ease-in-out infinite;
        }
        #agent-toast-pill.visible {
          opacity: 1;
        }
        @keyframes agent-float {
          0%, 100% { transform: translate(-50%, 0); }
          50% { transform: translate(-50%, -6px); }
        }
      `)
      view.webContents.executeJavaScript(`
        if (!document.getElementById('agent-toast-pill')) {
          const el = document.createElement('div');
          el.id = 'agent-toast-pill';
          el.textContent = 'AI Assistant is working...';
          document.body.appendChild(el);
          // Force reflow
          void el.offsetWidth;
          el.classList.add('visible');
        }
      `)
    }
  })

  view.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    if (tabId === activeTabId && mainWindow) {
      mainWindow.webContents.send('navigation-error', { errorCode, errorDescription })
    }
  })

  view.webContents.on('did-navigate', (event, url) => {
    const tab = tabs.get(tabId)
    if (tab) {
      tab.url = url
      tab.title = view.webContents.getTitle() || url
      sendTabsUpdate()
    }
    if (tabId === activeTabId && mainWindow) {
      mainWindow.webContents.send('url-changed', {
        url,
        canGoBack: view.webContents.canGoBack(),
        canGoForward: view.webContents.canGoForward()
      })
    }
  })

  view.webContents.on('did-navigate-in-page', (event, url) => {
    const tab = tabs.get(tabId)
    if (tab) {
      tab.url = url
      sendTabsUpdate()
    }
    if (tabId === activeTabId && mainWindow) {
      mainWindow.webContents.send('url-changed', {
        url,
        canGoBack: view.webContents.canGoBack(),
        canGoForward: view.webContents.canGoForward()
      })
    }
    injectClickableOverlays(view.webContents)
  })

  view.webContents.on('console-message', (event, level, message) => {
    if (message.startsWith('__AI_ACTION__:')) {
      try {
        const data = JSON.parse(message.substring('__AI_ACTION__:'.length))
        if (mainWindow) {
          mainWindow.webContents.send('selection-action', data)
          mainWindow.webContents.focus()
        }
      } catch (e) {}
    }
  })

  view.webContents.on('page-title-updated', (event, title) => {
    const tab = tabs.get(tabId)
    if (tab) {
      tab.title = title
      sendTabsUpdate()
    }
  })
}

function createTab(url, options = {}) {
  const tabId = nextTabId++
  const targetUrl = url || 'https://www.google.com'
  const isAgent = options.isAgent || false
  const background = options.background || false

  const view = new BrowserView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true
    }
  })

  tabs.set(tabId, { view, title: 'New Tab', url: targetUrl, isAgent })
  wireViewEvents(tabId, view)
  view.webContents.loadURL(targetUrl)
  if (!background) switchTab(tabId)
  else sendTabsUpdate()
  return tabId
}

function switchTab(tabId) {
  if (!tabs.has(tabId) || !mainWindow) return

  if (activeTabId && tabs.has(activeTabId)) {
    mainWindow.removeBrowserView(tabs.get(activeTabId).view)
  }

  activeTabId = tabId
  const tab = tabs.get(tabId)
  mainWindow.addBrowserView(tab.view)
  updateBrowserViewBounds()
  sendTabsUpdate()

  mainWindow.webContents.send('url-changed', {
    url: tab.view.webContents.getURL() || tab.url,
    canGoBack: tab.view.webContents.canGoBack(),
    canGoForward: tab.view.webContents.canGoForward()
  })
}

function closeTab(tabId) {
  if (!tabs.has(tabId)) return

  const tab = tabs.get(tabId)
  if (activeTabId === tabId) {
    mainWindow.removeBrowserView(tab.view)
  }

  tab.view.webContents.close()
  tabs.delete(tabId)

  if (tabs.size === 0) {
    activeTabId = null
    createTab()
    return
  }

  if (activeTabId === tabId) {
    const ids = [...tabs.keys()]
    switchTab(ids[ids.length - 1])
  } else {
    sendTabsUpdate()
  }
}

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    titleBarStyle: 'hidden',
    frame: false
  })

  mainWindow.loadFile('index.html').then(() => {
    mainWindow.maximize()
    createTab()
  })

  mainWindow.on('resize', updateBrowserViewBounds)
  mainWindow.on('maximize', updateBrowserViewBounds)
  mainWindow.on('unmaximize', updateBrowserViewBounds)
}

ipcMain.on('create-tab', (event, url) => { createTab(url || undefined) })
ipcMain.on('close-tab', (event, tabId) => { closeTab(tabId) })
ipcMain.on('switch-tab', (event, tabId) => { switchTab(tabId) })
ipcMain.handle('create-agent-tab', (event, url, background) => createTab(url || 'https://www.google.com', { isAgent: true, background: !!background }))

ipcMain.on('stop-agent-control', (event, tabId) => {
  const tab = tabs.get(tabId)
  if (tab && tab.isAgent) {
    tab.isAgent = false
    tab.view.webContents.executeJavaScript(`
      (function() {
        const el = document.getElementById('agent-toast-pill');
        if (el) el.remove();
      })()
    `).catch(() => {})
    updateBrowserViewBounds()
  }
})

ipcMain.on('navigate', (event, url) => {
  const view = getActiveView()
  if (!view) return
  let targetUrl = url
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    if (url.includes('.') && !url.includes(' ')) {
      targetUrl = 'https://' + url
    } else {
      targetUrl = 'https://www.google.com/search?q=' + encodeURIComponent(url)
    }
  }
  view.webContents.loadURL(targetUrl)
})

ipcMain.on('get-navigation-state', () => {
  const view = getActiveView()
  if (mainWindow && view) {
    mainWindow.webContents.send('navigation-state-changed', {
      canGoBack: view.webContents.canGoBack(),
      canGoForward: view.webContents.canGoForward()
    })
  }
})

ipcMain.on('go-back', () => { const v = getActiveView(); if (v) v.webContents.goBack() })
ipcMain.on('go-forward', () => { const v = getActiveView(); if (v) v.webContents.goForward() })
ipcMain.on('reload', () => { const v = getActiveView(); if (v) v.webContents.reload() })
ipcMain.on('close-window', () => { if (mainWindow) mainWindow.close() })
ipcMain.on('minimize-window', () => { if (mainWindow) mainWindow.minimize() })

ipcMain.on('maximize-window', () => {
  if (!mainWindow) return
  if (mainWindow.isMaximized()) mainWindow.unmaximize()
  else mainWindow.maximize()
  setTimeout(updateBrowserViewBounds, 100)
})

ipcMain.on('sidebar-toggled', (event, isOpen) => {
  sidebarOpen = isOpen
  updateBrowserViewBounds()
})

ipcMain.on('sidebar-width-changed', (event, width) => {
  sidebarWidth = width
  updateBrowserViewBounds()
})

ipcMain.handle('get-page-context', async (event, tabId) => {
  const view = getViewForTab(tabId)
  if (!view) return { title: '', url: '', headings: [], elements: [], mainText: '' }
  try {
    const context = await view.webContents.executeJavaScript(`
      (function() {
        function buildInfo(el, id) {
          var info = { id: id, tag: el.tagName.toLowerCase() };
          if (el.type) info.type = el.type;
          if (el.name) info.name = el.name;
          if (el.id) info.elementId = el.id;
          if (el.placeholder) info.placeholder = el.placeholder;
          if (el.href) info.href = el.href;
          if (el.getAttribute('aria-label')) info.ariaLabel = el.getAttribute('aria-label');
          if (el.title) info.title = el.title;
          if (el.getAttribute('role')) info.role = el.getAttribute('role');
          if (el.value && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) info.value = el.value;
          var text = (el.innerText || el.textContent || '').trim();
          if (text && text.length > 0) info.text = text.substring(0, 80);
          return info;
        }
        var elements = [];
        var MAX = 200;
        var withIds = document.querySelectorAll('[data-ai-id]');
        var seen = new Set();
        for (var i = 0; i < withIds.length && elements.length < MAX; i++) {
          var el = withIds[i];
          if (el.id === 'ai-clickable-overlays' || el.classList.contains('ai-clickable-badge')) continue;
          var rid = el.getAttribute('data-ai-id');
          if (seen.has(rid)) continue;
          seen.add(rid);
          var rect = el.getBoundingClientRect();
          if (rect.width < 2 || rect.height < 2) continue;
          elements.push(buildInfo(el, parseInt(rid, 10)));
        }
        if (elements.length === 0) {
          var selectors = 'a[href], button, input, textarea, select, [role="button"], [role="link"], [role="tab"], [type="submit"], [onclick]';
          var els = document.querySelectorAll(selectors);
          for (var j = 0; j < els.length && elements.length < MAX; j++) {
            var e = els[j];
            var r = e.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) continue;
            if (e.disabled) continue;
            if (e.type === 'hidden') continue;
            e.setAttribute('data-ai-id', elements.length);
            elements.push(buildInfo(e, elements.length));
          }
        }

        var headings = [];
        var hs = document.querySelectorAll('h1, h2, h3');
        for (var j = 0; j < hs.length && j < 10; j++) {
          var t = hs[j].textContent.trim();
          if (t) headings.push(t.substring(0, 100));
        }

        function getMainText() {
          var root =
            document.querySelector('main') ||
            document.querySelector('article') ||
            document.querySelector('#main') ||
            document.querySelector('#content') ||
            document.body;
          var text = (root && root.innerText) ? root.innerText : (document.body ? document.body.innerText : '');
          text = (text || '').replace(/\\s+/g, ' ').trim();
          if (text.length > 4000) text = text.substring(0, 4000);
          return text;
        }

        return {
          title: document.title,
          url: window.location.href,
          headings: headings,
          elements: elements,
          mainText: getMainText()
        };
      })()
    `)
    return context
  } catch (e) {
    return { title: '', url: '', headings: [], elements: [], mainText: '' }
  }
})

ipcMain.handle('get-page-url', async (event, tabId) => {
  const view = getViewForTab(tabId)
  if (!view) return ''
  return view.webContents.getURL()
})

ipcMain.handle('execute-action', async (event, action, tabId) => {
  const view = getViewForTab(tabId)
  if (!view) return { success: false, error: 'No browser view' }

  try {
    if (action.action === 'navigate') {
      await view.webContents.loadURL(action.url)
      return { success: true }
    }

    if (action.action === 'click') {
      const eid = Number(action.elementId)
      const result = await view.webContents.executeJavaScript(`
        (function() {
          var el = document.querySelector('[data-ai-id="${eid}"]');
          if (el) { el.click(); return true; }
          return false;
        })()
      `)
      return { success: result, error: result ? null : 'Element [' + eid + '] not found' }
    }

    if (action.action === 'type') {
      const eid = Number(action.elementId)
      const text = JSON.stringify(action.text)
      const result = await view.webContents.executeJavaScript(`
        (function() {
          var el = document.querySelector('[data-ai-id="${eid}"]');
          if (el) {
            el.focus();
            el.value = ${text};
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
          return false;
        })()
      `)
      return { success: result, error: result ? null : 'Element [' + eid + '] not found' }
    }

    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('wait-for-load', (event, tabId) => {
  return new Promise((resolve) => {
    const view = getViewForTab(tabId)
    if (!view) return resolve()

    if (!view.webContents.isLoading()) {
      setTimeout(resolve, 1500)
      return
    }

    const timeout = setTimeout(resolve, 10000)

    view.webContents.once('did-finish-load', () => {
      clearTimeout(timeout)
      setTimeout(resolve, 1500)
    })
  })
})

app.whenReady().then(() => {
  createWindow()

  globalShortcut.register('Command+Shift+B', () => {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
      mainWindow.webContents.send('open-sidebar')
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
