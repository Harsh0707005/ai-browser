const { app, BrowserWindow, BrowserView, ipcMain } = require('electron/main')
const path = require('path')

let mainWindow
let browserView

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

  mainWindow.loadFile('index.html')

  // Create BrowserView for web content
  browserView = new BrowserView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true
    }
  })

  mainWindow.setBrowserView(browserView)
  
  // Set BrowserView bounds (accounting for title bar 30px + toolbar 60px = 90px)
  const bounds = mainWindow.getBounds()
  const toolbarHeight = 90 // title bar (30px) + toolbar (60px)
  browserView.setBounds({
    x: 0,
    y: toolbarHeight,
    width: bounds.width,
    height: bounds.height - toolbarHeight
  })

  // Load initial page
  browserView.webContents.loadURL('https://www.google.com')

  // Handle window resize and maximize
  const updateBrowserViewBounds = () => {
    const bounds = mainWindow.getBounds()
    const toolbarHeight = 90 // title bar (30px) + toolbar (60px)
    browserView.setBounds({
      x: 0,
      y: toolbarHeight,
      width: bounds.width,
      height: bounds.height - toolbarHeight
    })
  }

  mainWindow.on('resize', updateBrowserViewBounds)
  mainWindow.on('maximize', updateBrowserViewBounds)
  mainWindow.on('unmaximize', updateBrowserViewBounds)

  // Handle navigation events
  browserView.webContents.on('did-start-loading', () => {
    mainWindow.webContents.send('navigation-start')
  })

  browserView.webContents.on('did-finish-load', () => {
    const url = browserView.webContents.getURL()
    const title = browserView.webContents.getTitle()
    const canGoBack = browserView.webContents.canGoBack()
    const canGoForward = browserView.webContents.canGoForward()
    mainWindow.webContents.send('navigation-complete', { 
      url, 
      title,
      canGoBack,
      canGoForward
    })
  })

  browserView.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    mainWindow.webContents.send('navigation-error', { errorCode, errorDescription })
  })

  // Handle URL changes
  browserView.webContents.on('did-navigate', (event, url) => {
    const canGoBack = browserView.webContents.canGoBack()
    const canGoForward = browserView.webContents.canGoForward()
    mainWindow.webContents.send('url-changed', { 
      url,
      canGoBack,
      canGoForward
    })
  })

  browserView.webContents.on('did-navigate-in-page', (event, url) => {
    const canGoBack = browserView.webContents.canGoBack()
    const canGoForward = browserView.webContents.canGoForward()
    mainWindow.webContents.send('url-changed', { 
      url,
      canGoBack,
      canGoForward
    })
  })
}

// IPC handlers for browser controls
ipcMain.on('navigate', (event, url) => {
  if (browserView) {
    // Add protocol if missing
    let targetUrl = url
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      // Check if it's a search query or URL
      if (url.includes('.') && !url.includes(' ')) {
        targetUrl = 'https://' + url
      } else {
        targetUrl = 'https://www.google.com/search?q=' + encodeURIComponent(url)
      }
    }
    browserView.webContents.loadURL(targetUrl)
  }
})

// Handler to get current navigation state
ipcMain.on('get-navigation-state', () => {
  if (mainWindow && browserView) {
    const canGoBack = browserView.webContents.canGoBack()
    const canGoForward = browserView.webContents.canGoForward()
    mainWindow.webContents.send('navigation-state-changed', {
      canGoBack,
      canGoForward
    })
  }
})

ipcMain.on('go-back', () => {
  if (browserView) {
    browserView.webContents.goBack()
  }
})

ipcMain.on('go-forward', () => {
  if (browserView) {
    browserView.webContents.goForward()
  }
})

ipcMain.on('reload', () => {
  if (browserView) {
    browserView.webContents.reload()
  }
})

ipcMain.on('close-window', () => {
  if (mainWindow) {
    mainWindow.close()
  }
})

ipcMain.on('minimize-window', () => {
  if (mainWindow) {
    mainWindow.minimize()
  }
})

ipcMain.on('maximize-window', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow.maximize()
    }
    // Update BrowserView bounds after maximize/unmaximize
    setTimeout(() => {
      const bounds = mainWindow.getBounds()
      const toolbarHeight = 90
      browserView.setBounds({
        x: 0,
        y: toolbarHeight,
        width: bounds.width,
        height: bounds.height - toolbarHeight
      })
    }, 100)
  }
})

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})