/*
 * 🆕 جسرٌ صغير بين صفحات coachlab.ma والبرنامج. لا Node داخل الصفحة (sandbox) — أربع وظائف فقط:
 *   CoachLabDesktop.toggleMini() · .download() · .show() · .info()
 */
'use strict';
const { contextBridge, ipcRenderer, webFrame } = require('electron');

const ours = /^https:\/\/([a-z0-9-]+\.)*coachlab\.ma$/i.test(location.origin);

contextBridge.exposeInMainWorld('CoachLabDesktop', {
  desktop: true,
  toggleMini: () => ipcRenderer.send('cl:mini'),
  download: () => ipcRenderer.send('cl:download'),
  show: () => ipcRenderer.send('cl:show'),
  info: () => ipcRenderer.invoke('cl:info'),
  install: () => ipcRenderer.send('cl:install'),   /* 🆕 27/10 — «حدّث الآن» */
});

/* 🆕 27/10 — window.clDesk لصفحات coachlab.ma فقط: حفظُ التسجيل الاحتياطي في Videos\CoachLab، وتنبيهُ النظام.
   saveFile(name, ArrayBuffer|Uint8Array) ⇒ المسار · وللملفّات الكبيرة: saveOpen(name) ⇒ id، saveWrite(id, chunk)، saveClose(id) ⇒ المسار.
   reveal(path) يُظهر الملفّ في المجلّد. الأمرُ من الاختصار العامّ (Ctrl+Shift+A) تنفّذه الصفحة عبر window.clDeskCmd. */
if (ours) {
  contextBridge.exposeInMainWorld('clDesk', {
    isDesktop: true,
    platform: process.platform,
    saveFile: (name, data) => ipcRenderer.invoke('cl:save', String(name || ''), data),
    saveOpen: name => ipcRenderer.invoke('cl:saveOpen', String(name || '')),
    saveWrite: (id, data) => ipcRenderer.invoke('cl:saveWrite', id, data),
    saveClose: id => ipcRenderer.invoke('cl:saveClose', id),
    reveal: p => ipcRenderer.invoke('cl:reveal', String(p || '')),
    openRecDir: () => ipcRenderer.invoke('cl:openRecDir'),   /* 🆕 28/10 — مجلّد التسجيلات */
    downloadUrl: (u, n) => ipcRenderer.invoke('cl:downloadUrl', String(u || ''), String(n || '')),
    notify: (title, body) => ipcRenderer.invoke('cl:notify', String(title || ''), String(body || '')),
    /* 🆕 28/10 — حالةُ المباشر للأزرار العائمة (main.js يفحصها ويقصّها) */
    state: s => { try { ipcRenderer.send('cl:state', JSON.parse(JSON.stringify(s || {}))); } catch (e) {} },
  });
}

/* 🩺 تنبيهات عامل الخدمة (reg.showNotification) لا تظهر في Electron: نحوّلها إلى Notification عادية،
   والضغط عليها يُظهر نافذة البرنامج ثمّ يفتح الرابط إن كان من الموقع. */
if (ours) {
  webFrame.executeJavaScript(`(function(){try{
    if(!window.ServiceWorkerRegistration||!window.Notification)return;
    ServiceWorkerRegistration.prototype.showNotification=function(title,opt){
      try{opt=opt||{};var n=new Notification(title,{body:opt.body||'',icon:opt.icon||'',tag:opt.tag||'',silent:!!opt.silent});
        n.onclick=function(){try{window.CoachLabDesktop&&window.CoachLabDesktop.show();window.focus();var u=opt.data&&opt.data.url;if(u&&u.indexOf(location.origin)===0&&u!==location.href)location.href=u;}catch(e){}n.close();};
      }catch(e){}
      return Promise.resolve();
    };
  }catch(e){}})();`).catch(() => {});
}
