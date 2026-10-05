const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('focusApp', {
  version: () => ipcRenderer.invoke('updater:version'),
  checkUpdate: () => ipcRenderer.invoke('updater:check'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  onUpdateStatus: (cb) => {
    const h = (_e, s) => cb(s)
    ipcRenderer.on('updater:status', h)
    return () => ipcRenderer.removeListener('updater:status', h)
  }
})
