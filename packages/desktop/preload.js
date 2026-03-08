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
  sidebarWidthChanged: (width) => ipcRenderer.send('sidebar-width-changed', width),
  getNavigationState: () => ipcRenderer.send('get-navigation-state'),

  createTab: (url) => ipcRenderer.send('create-tab', url),
  createPrivateWindow: () => ipcRenderer.send('create-private-window'),
  createWindow: () => ipcRenderer.send('create-window'),
  closeTab: (tabId) => ipcRenderer.send('close-tab', tabId),
  switchTab: (tabId) => ipcRenderer.send('switch-tab', tabId),
  reopenClosedTab: () => ipcRenderer.send('reopen-closed-tab'),
  scrollPageToTop: () => ipcRenderer.send('scroll-page', 'top'),
  scrollPageToBottom: () => ipcRenderer.send('scroll-page', 'bottom'),
  stopLoading: () => ipcRenderer.send('stop-loading'),
  zoomIn: () => ipcRenderer.send('zoom', 'in'),
  zoomOut: () => ipcRenderer.send('zoom', 'out'),
  zoomReset: () => ipcRenderer.send('zoom', 'reset'),
  toggleDevTools: () => ipcRenderer.send('toggle-devtools'),
  findInPage: (text, findNext) => ipcRenderer.send('find-in-page', text, findNext),
  findBarOpen: () => ipcRenderer.send('find-bar-open'),
  findBarClosed: () => ipcRenderer.send('find-bar-closed'),

  createAgentTab: (url, background) => ipcRenderer.invoke('create-agent-tab', url, background),
  startAgentControl: (tabId) => ipcRenderer.send('start-agent-control', tabId),
  stopAgentControl: (tabId) => ipcRenderer.send('stop-agent-control', tabId),

  getPageContext: (tabId) => ipcRenderer.invoke('get-page-context', tabId),
  getPageURL: (tabId) => ipcRenderer.invoke('get-page-url', tabId),
  executeAction: (action, tabId) => ipcRenderer.invoke('execute-action', action, tabId),
  waitForLoad: (tabId) => ipcRenderer.invoke('wait-for-load', tabId),

  getAllCredentials: () => ipcRenderer.invoke('get-all-credentials'),
  saveCredential: (domain, credential) => ipcRenderer.invoke('save-domain-credential', domain, credential),
  deleteCredential: (domain, credentialId) => ipcRenderer.invoke('delete-domain-credential', domain, credentialId),

  getAllContacts: () => ipcRenderer.invoke('get-all-contacts'),
  saveContact: (contact) => ipcRenderer.invoke('save-contact', contact),
  deleteContact: (contactId) => ipcRenderer.invoke('delete-contact', contactId),

  onNavigationStart: (callback) => ipcRenderer.on('navigation-start', callback),
  onNavigationComplete: (callback) => ipcRenderer.on('navigation-complete', (event, data) => callback(data)),
  onNavigationError: (callback) => ipcRenderer.on('navigation-error', (event, data) => callback(data)),
  onUrlChanged: (callback) => ipcRenderer.on('url-changed', (event, data) => callback(data)),
  onNavigationStateChanged: (callback) => ipcRenderer.on('navigation-state-changed', (event, data) => callback(data)),
  onOpenSidebar: (callback) => ipcRenderer.on('open-sidebar', callback),
  onShortcutToggleSidebar: (callback) => ipcRenderer.on('shortcut-toggle-sidebar', callback),
  leftChromeWidthChanged: (width) => ipcRenderer.send('left-chrome-width-changed', width),
  chromeLayoutChanged: (payload) => ipcRenderer.send('chrome-layout-changed', payload),
  onTabsUpdated: (callback) => ipcRenderer.on('tabs-updated', (event, data) => callback(data)),
  onSelectionAction: (callback) => ipcRenderer.on('selection-action', (event, data) => callback(data)),

  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),

  hideBrowserView: () => ipcRenderer.send('hide-browser-view'),
  showBrowserView: () => ipcRenderer.send('show-browser-view'),

  onCredModalOpen: (cb) => ipcRenderer.on('cred-modal-open', cb),
  onCredModalClosed: (cb) => ipcRenderer.on('cred-modal-closed', cb),
  onPrivateWindowMode: (cb) => ipcRenderer.on('private-window-mode', cb),

  onShortcutFocusAddressBar: (cb) => ipcRenderer.on('shortcut-focus-address-bar', cb),
  onShortcutOpenFind: (cb) => ipcRenderer.on('shortcut-open-find', cb),

  whatsappGetStatus: () => ipcRenderer.invoke('whatsapp-get-status'),
  whatsappConnect: () => ipcRenderer.invoke('whatsapp-connect'),
  whatsappSendMessage: (phone, message) => ipcRenderer.invoke('whatsapp-send-message', phone, message),
  whatsappDisconnect: () => ipcRenderer.invoke('whatsapp-disconnect'),
  onWhatsappStatus: (cb) => ipcRenderer.on('whatsapp-status', (event, data) => cb(data))
})
