const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  navigate: (url) => ipcRenderer.send('navigate', url),
  goBack: () => ipcRenderer.send('go-back'),
  goForward: () => ipcRenderer.send('go-forward'),
  reload: () => ipcRenderer.send('reload'),
  closeWindow: () => ipcRenderer.send('close-window'),
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  maximizeWindow: () => ipcRenderer.send('maximize-window'),
  sidebarToggled: (isOpen) => ipcRenderer.send('sidebar-toggled', isOpen),
  getNavigationState: () => ipcRenderer.send('get-navigation-state'),

  createTab: (url) => ipcRenderer.send('create-tab', url),
  closeTab: (tabId) => ipcRenderer.send('close-tab', tabId),
  switchTab: (tabId) => ipcRenderer.send('switch-tab', tabId),

  createAgentTab: (url, background) => ipcRenderer.invoke('create-agent-tab', url, background),
  stopAgentControl: (tabId) => ipcRenderer.send('stop-agent-control', tabId),

  getPageContext: (tabId) => ipcRenderer.invoke('get-page-context', tabId),
  getPageURL: (tabId) => ipcRenderer.invoke('get-page-url', tabId),
  executeAction: (action, tabId) => ipcRenderer.invoke('execute-action', action, tabId),
  waitForLoad: (tabId) => ipcRenderer.invoke('wait-for-load', tabId),

  onNavigationStart: (callback) => ipcRenderer.on('navigation-start', callback),
  onNavigationComplete: (callback) => ipcRenderer.on('navigation-complete', (event, data) => callback(data)),
  onNavigationError: (callback) => ipcRenderer.on('navigation-error', (event, data) => callback(data)),
  onUrlChanged: (callback) => ipcRenderer.on('url-changed', (event, data) => callback(data)),
  onNavigationStateChanged: (callback) => ipcRenderer.on('navigation-state-changed', (event, data) => callback(data)),
  onOpenSidebar: (callback) => ipcRenderer.on('open-sidebar', callback),
  onTabsUpdated: (callback) => ipcRenderer.on('tabs-updated', (event, data) => callback(data)),
  onSelectionAction: (callback) => ipcRenderer.on('selection-action', (event, data) => callback(data)),

  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
})
