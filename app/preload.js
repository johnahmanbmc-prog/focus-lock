// The only bridge between the window and the app. The window can read the
// state and ask for changes; the rules in core/rules.js decide what happens.
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('focusLock', {
  getState: () => ipcRenderer.invoke('getState'),
  change: change => ipcRenderer.invoke('change', change),
  confirm: (message, detail) => ipcRenderer.invoke('confirm', message, detail),
  onState: callback => ipcRenderer.on('state', (event, view) => callback(view))
});
