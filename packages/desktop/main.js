const { app, BrowserWindow, BrowserView, ipcMain, globalShortcut } = require('electron/main')
const path = require('path')

let mainWindow
let sidebarOpen = false

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
  const sidebarWidth = sidebarOpen ? 400 : 0
  
  const activeTab = tabs.get(activeTabId)
  const isAgent = activeTab?.isAgent
  const borderWidth = isAgent ? 6 : 0

  view.setBounds({
    x: borderWidth,
    y: TOOLBAR_HEIGHT + borderWidth,
    width: bounds.width - sidebarWidth - (borderWidth * 2),
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

ipcMain.handle('get-page-context', async (event, tabId) => {
  const view = getViewForTab(tabId)
  if (!view) return { title: '', url: '', headings: [], elements: [], mainText: '' }
  try {
    const context = await view.webContents.executeJavaScript(`
      (function() {
        var elements = [];
        var id = 0;
        var MAX = 200;
        var selectors = 'a[href], button, input, textarea, select, [role="button"], [role="link"], [role="tab"], [type="submit"], [onclick]';
        var els = document.querySelectorAll(selectors);

        for (var i = 0; i < els.length && id < MAX; i++) {
          var el = els[i];
          var rect = el.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) continue;
          if (el.disabled) continue;
          if (el.type === 'hidden') continue;

          el.setAttribute('data-ai-id', id);

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

          elements.push(info);
          id++;
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
