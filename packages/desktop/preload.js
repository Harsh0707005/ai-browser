const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  navigate: (url) => ipcRenderer.send('navigate', url),
  goBack: () => ipcRenderer.send('go-back'),
  goForward: () => ipcRenderer.send('go-forward'),
  reload: () => ipcRenderer.send('reload'),
  closeWindow: () => ipcRenderer.send('close-window'),
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  maximizeWindow: () => ipcRenderer.send('maximize-window'),
  
  onNavigationStart: (callback) => ipcRenderer.on('navigation-start', callback),
  onNavigationComplete: (callback) => ipcRenderer.on('navigation-complete', (event, data) => callback(data)),
  onNavigationError: (callback) => ipcRenderer.on('navigation-error', (event, data) => callback(data)),
  onUrlChanged: (callback) => ipcRenderer.on('url-changed', (event, data) => callback(data)),
  onNavigationStateChanged: (callback) => ipcRenderer.on('navigation-state-changed', (event, data) => callback(data)),
  getNavigationState: () => ipcRenderer.send('get-navigation-state'),
  
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
})
