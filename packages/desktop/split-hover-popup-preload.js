const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('splitPopupAPI', {
  onOptions: (cb) => ipcRenderer.on('split-popup-options', (_e, opts) => cb(opts)),
  applySplitLayout: (preset, tabId) => ipcRenderer.invoke('apply-split-layout', { sourceTabId: tabId, preset }),
  removeFromSplit: (tabId) => ipcRenderer.invoke('remove-from-split', tabId),
  closeSplit: () => ipcRenderer.invoke('close-split'),
  closePopup: () => ipcRenderer.send('split-hover-popup-close'),
  sendMouseEnter: () => ipcRenderer.send('split-popup-mouse-enter'),
  sendMouseLeave: () => ipcRenderer.send('split-popup-mouse-leave')
})
