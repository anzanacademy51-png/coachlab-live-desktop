/* 🆕 جسر النوافذ الداخلية (اختيار الشاشة، تأكيد المغادرة) — قنوات محدّدة فقط */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');
/* 🆕 28/10 — bar:cmd (أوامرُ الأزرار العائمة ولوحاتها) */
const OUT = ['picker:choice', 'confirm:answer', 'bar:cmd'];
contextBridge.exposeInMainWorld('clUI', {
  send: (ch, v) => { if (OUT.includes(ch)) ipcRenderer.send(ch, v); },
  onInit: cb => ipcRenderer.on('ui:init', (_e, d) => cb(d)),
  onState: cb => ipcRenderer.on('ui:state', (_e, d) => cb(d)),
});
