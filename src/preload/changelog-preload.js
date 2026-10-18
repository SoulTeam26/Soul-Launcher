const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('soul', {
  readUpdateNotes: () => ipcRenderer.invoke('read-update-notes'),
  closeWindow: () => ipcRenderer.send('close-changelog'),
  windowClose: () => ipcRenderer.send('window-close'),
});