const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('civigoDesktop', Object.freeze({
  login: value => ipcRenderer.invoke('civigo:login', value),
  session: () => ipcRenderer.invoke('civigo:session'),
  logout: () => ipcRenderer.invoke('civigo:logout'),
  request: value => ipcRenderer.invoke('civigo:request', value),
  cancelRead: requestId => ipcRenderer.invoke('civigo:cancel-read', requestId),
  upload: value => ipcRenderer.invoke('civigo:upload', value),
  download: id => ipcRenderer.invoke('civigo:download', id),
  openPublic: path => ipcRenderer.invoke('civigo:public', path),
  onSession: listener => { const callback = (_event, user) => listener(user); ipcRenderer.on('civigo:session-changed', callback); return () => ipcRenderer.removeListener('civigo:session-changed', callback); },
}));
