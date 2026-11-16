const { contextBridge, ipcRenderer } = require('electron');
const request = (method, args = {}) => ipcRenderer.invoke('automation-v1', { method, args });
contextBridge.exposeInMainWorld('automation', Object.freeze({
  state: () => request('state'),
  login: () => request('login'),
  split: (paneId, axis) => request('split', { paneId, axis }),
  navigate: (paneId, url) => request('navigate', { paneId, url }),
  history: (paneId, direction) => request('history', { paneId, direction }),
  closePane: paneId => request('closePane', { paneId }),
  maximize: paneId => request('maximize', { paneId }),
  move: paneId => request('move', { paneId }),
  resize: (paneId, ratio) => request('resize', { paneId, ratio }),
  layout: rectangles => request('layout', { rectangles }),
  focus: paneId => request('focus', { paneId }),
  start: (paneId, input) => request('start', { paneId, input }),
  stop: paneId => request('stop', { paneId }),
  memory: (paneId, operation, args) => request('memory', { paneId, operation, arguments: args }),
}));
