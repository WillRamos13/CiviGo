const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('civigoDesktop', Object.freeze({
  login: value => ipcRenderer.invoke('civigo:login', value),
  session: () => ipcRenderer.invoke('civigo:session'),
  logout: () => ipcRenderer.invoke('civigo:logout'),
  request: value => ipcRenderer.invoke('civigo:request', value),
  cancelRead: requestId => ipcRenderer.invoke('civigo:cancel-read', requestId),
  upload: value => ipcRenderer.invoke('civigo:upload', value),
  download: id => ipcRenderer.invoke('civigo:download', id),
  exportExcel: input => ipcRenderer.invoke('civigo:export-excel', input),
  previewImage: id => ipcRenderer.invoke('civigo:image-preview', id),
  openPublic: path => ipcRenderer.invoke('civigo:public', path),
  openImageReference: url => ipcRenderer.invoke('civigo:image-reference', url),
  onSession: listener => { const callback = (_event, user) => listener(user); ipcRenderer.on('civigo:session-changed', callback); return () => ipcRenderer.removeListener('civigo:session-changed', callback); },
}));
