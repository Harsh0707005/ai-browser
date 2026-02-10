const { app, BrowserWindow, BrowserView, ipcMain, globalShortcut } = require('electron/main')
const path = require('path')

let mainWindow
let browserView
let sidebarOpen = false

const updateBrowserViewBounds = () => {
  if (!mainWindow || !browserView) return
  const bounds = mainWindow.getContentBounds()
  const toolbarHeight = 90
  const sidebarWidth = sidebarOpen ? 400 : 0
  browserView.setBounds({
    x: 0,
    y: toolbarHeight,
    width: bounds.width - sidebarWidth,
    height: bounds.height - toolbarHeight
  })
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
  })

  browserView = new BrowserView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true
    }
  })

  mainWindow.setBrowserView(browserView)

  const bounds = mainWindow.getBounds()
  browserView.setBounds({
    x: 0,
    y: 90,
    width: bounds.width,
    height: bounds.height - 90
  })

  browserView.webContents.loadURL('https://www.google.com')

  mainWindow.on('resize', updateBrowserViewBounds)
  mainWindow.on('maximize', updateBrowserViewBounds)
  mainWindow.on('unmaximize', updateBrowserViewBounds)

  browserView.webContents.on('did-start-loading', () => {
    mainWindow.webContents.send('navigation-start')
  })

  browserView.webContents.on('did-finish-load', () => {
    const url = browserView.webContents.getURL()
    const title = browserView.webContents.getTitle()
    const canGoBack = browserView.webContents.canGoBack()
    const canGoForward = browserView.webContents.canGoForward()
    mainWindow.webContents.send('navigation-complete', { url, title, canGoBack, canGoForward })
  })

  browserView.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    mainWindow.webContents.send('navigation-error', { errorCode, errorDescription })
  })

  browserView.webContents.on('did-navigate', (event, url) => {
    mainWindow.webContents.send('url-changed', {
      url,
      canGoBack: browserView.webContents.canGoBack(),
      canGoForward: browserView.webContents.canGoForward()
    })
  })

  browserView.webContents.on('did-navigate-in-page', (event, url) => {
    mainWindow.webContents.send('url-changed', {
      url,
      canGoBack: browserView.webContents.canGoBack(),
      canGoForward: browserView.webContents.canGoForward()
    })
  })
}

ipcMain.on('navigate', (event, url) => {
  if (!browserView) return
  let targetUrl = url
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    if (url.includes('.') && !url.includes(' ')) {
      targetUrl = 'https://' + url
    } else {
      targetUrl = 'https://www.google.com/search?q=' + encodeURIComponent(url)
    }
  }
  browserView.webContents.loadURL(targetUrl)
})

ipcMain.on('get-navigation-state', () => {
  if (mainWindow && browserView) {
    mainWindow.webContents.send('navigation-state-changed', {
      canGoBack: browserView.webContents.canGoBack(),
      canGoForward: browserView.webContents.canGoForward()
    })
  }
})

ipcMain.on('go-back', () => { if (browserView) browserView.webContents.goBack() })
ipcMain.on('go-forward', () => { if (browserView) browserView.webContents.goForward() })
ipcMain.on('reload', () => { if (browserView) browserView.webContents.reload() })
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

ipcMain.handle('get-page-context', async () => {
  if (!browserView) return { title: '', url: '', headings: [], elements: [], mainText: '' }
  try {
    const context = await browserView.webContents.executeJavaScript(`
      /* Page context sent to Gemini – what is included and trimmed:
       * INCLUDED: Only interactive elements matching: a[href], button, input, textarea, select,
       *   [role="button"], [role="link"], [role="tab"], [type="submit"], [onclick].
       * TRIMMED OUT: script, style, iframes, full HTML, non-interactive nodes, invisible elements
       *   (rect width/height 0), disabled elements, input type="hidden".
       * PER ELEMENT we send only: id (our index), tag, type, name, id (DOM id), placeholder,
       *   href, aria-label, title, role, value (for input/textarea), text (innerText up to 80 chars).
       * TRIMMED: classes, data-* (except we set data-ai-id), child HTML, computed styles, events.
       * HEADINGS: h1/h2/h3 text only, up to 10 headings, each truncated to 100 chars.
       * VISIBLE TEXT EXCERPT: we also include a short plain-text excerpt from the main content area
       *   (main/article/#main/#content/body), trimmed to 4000 characters, whitespace collapsed.
       * CAP: 200 interactive elements max. */
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

ipcMain.handle('get-page-url', async () => {
  if (!browserView) return ''
  return browserView.webContents.getURL()
})

ipcMain.handle('execute-action', async (event, action) => {
  if (!browserView) return { success: false, error: 'No browser view' }

  try {
    if (action.action === 'navigate') {
      await browserView.webContents.loadURL(action.url)
      return { success: true }
    }

    if (action.action === 'click') {
      const eid = Number(action.elementId)
      const result = await browserView.webContents.executeJavaScript(`
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
      const result = await browserView.webContents.executeJavaScript(`
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

ipcMain.handle('wait-for-load', () => {
  return new Promise((resolve) => {
    if (!browserView) return resolve()

    if (!browserView.webContents.isLoading()) {
      setTimeout(resolve, 1500)
      return
    }

    const timeout = setTimeout(resolve, 10000)

    browserView.webContents.once('did-finish-load', () => {
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
