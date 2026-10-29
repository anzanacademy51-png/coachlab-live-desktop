/*
 * 🆕 CoachLab Live — برنامج المباشر لويندوز (Electron).
 * لماذا: المتصفّح يُبطئ الصفحة حين تُصغَّر أو تختفي خلف نافذةٍ أخرى ⇒ الصوت والبثّ يتقطّعان.
 * البرنامج يفتح coachlab.ma نفسه (لا نسخة ثانية من الموقع) مع:
 *   جلسة دخول محفوظة · إذن الكاميرا/الميكروفون لـcoachlab.ma وحده · مشاركة الشاشة بنافذة اختيار عربية ·
 *   لا إبطاء في الخلفية · أيقونة في شريط المهام (إظهار / خروج) · سؤال قبل الإغلاق أثناء المباشر ·
 *   الوضع المصغّر فوق كلّ النوافذ (Ctrl+Shift+M) · الروابط الخارجية في المتصفّح · رابط coachlab:// ·
 *   إعلان النسخة الجديدة (بلا تحديث تلقائي: الاستضافة مجانية والبرنامج غير موقّع).
 * 🆕 27/10 (طلب Anzan): تحديثٌ تلقائيّ في ويندوز (electron-updater) · تذكيرٌ قبل الحصص وعند البدء ·
 *   البقاءُ في شريط المهام والتشغيلُ مع ويندوز · Ctrl+Shift+A لكتم الميكروفون من أيّ برنامج ·
 *   حفظُ التسجيل الاحتياطي في Videos\CoachLab · نسخةُ ماك (dmg غير موقّع، إعلانٌ يدويّ للتحديث).
 * 🆕 28/10 (طلب Anzan): أزرارٌ عائمة أثناء المباشر (ui/toolbar.html + ui/panel.html) لا تظهر في البثّ ولا في مشاركة الشاشة
 *   (setContentProtection) · والوضعُ المصغّر ونافذةُ اختيار الشاشة محميّان كذلك.
 */
'use strict';
const { app, BrowserWindow, session, desktopCapturer, ipcMain, shell, Tray, Menu, nativeImage, screen, powerSaveBlocker, Notification, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');

const HOME = 'https://coachlab.ma';
const START = HOME + '/live-hub/';   /* 🔄 v7.7.5468 — «مركز المباشر» بدل /live-sessions/ (كانت تقول «لا توجد جلسات» والحصصُ في الأكاديميات) */
const LATEST = HOME + '/wp-content/uploads/cl-app/desktop-latest.json';
const PARTITION = 'persist:coachlab';
const UA_MARK = ' CoachLabDesktop/1';
const ICON = path.join(__dirname, 'icon.png');
const UI = path.join(__dirname, 'ui');

let win = null, tray = null, picker = null, confirmWin = null;
let bar = null, panel = null, panelKind = '', LIVE = null, barW = 440, minByShare = false, wasSharing = false;   /* 🆕 28/10 — الأزرارُ العائمة */
let quitting = false, mini = null, update = null, blocker = -1, pendingTo = null;
let ready = null;   /* 🆕 تحديثٌ نُزِّل وجاهزٌ للتثبيت (electron-updater) */
const IS_WIN = process.platform === 'win32', IS_MAC = process.platform === 'darwin';
/* 🆕 28/10 — نسخةُ Microsoft Store (appx): Store يوقّعها ويحدّثها ⇒ لا electron-updater ولا شريطَ «حمّلها» ولا «شغّل مع ويندوز» (يلزمه StartupTask في الحزمة). */
const IS_STORE = !!process.windowsStore;
const HIDDEN = process.argv.includes('--hidden');   /* 🆕 تشغيلٌ مع ويندوز ⇒ يبدأ في شريط المهام */

/* 🆕 27/10 — إعداداتٌ صغيرة محفوظة على الجهاز (userData/settings.json) */
const SETF = () => path.join(app.getPath('userData'), 'settings.json');
let SET = null;
function sget(k, d) { if (!SET) { try { SET = JSON.parse(fs.readFileSync(SETF(), 'utf8')) || {}; } catch (e) { SET = {}; } } return k in SET ? SET[k] : d; }
function sset(k, v) { sget(k); SET[k] = v; try { fs.mkdirSync(path.dirname(SETF()), { recursive: true }); fs.writeFileSync(SETF(), JSON.stringify(SET)); } catch (e) {} }

/* ── أدوات الروابط ── */
function parse(u) { try { return new URL(u); } catch (e) { return null; } }
function isOurs(u) {
  const x = typeof u === 'string' ? parse(u) : u;
  return !!x && x.protocol === 'https:' && (x.hostname === 'coachlab.ma' || x.hostname.endsWith('.coachlab.ma'));
}
/* الدخول بحساب Google/Facebook يمرّ بصفحاتهم ثمّ يعود: يبقى داخل البرنامج وإلّا ضاع الدخول */
function isAuth(u) {
  const x = typeof u === 'string' ? parse(u) : u;
  if (!x || x.protocol !== 'https:') return false;
  if (x.hostname === 'accounts.google.com' || x.hostname === 'oauth2.googleapis.com') return true;
  if (/(^|\.)facebook\.com$/.test(x.hostname) && /\/(dialog|login|oauth|v\d+\.\d+\/dialog)/.test(x.pathname)) return true;
  return false;
}
/* 🆕 v7.7.5468 — طلبُ Anzan: البرنامجُ للمباشر وحده. صفحاتُ الموقع الأخرى تُفتح في المتصفّح.
   🩺 القاعدةُ نفسُها في inc/live-hub.php (cl_lhub_app_allowed) — غيّرهما معاً. */
function isAppPath(u) {
  const x = typeof u === 'string' ? parse(u) : u;
  if (!x || !isOurs(x)) return false;
  const p = x.pathname, q = x.search;
  if (/^\/(live-hub|live-room|live-class|connect|rejoindre)(\/|$)/.test(p)) return true;
  /* 🆕 28/10 — طلبُ Anzan: ميقات ولِسان وأُستاذي (أماكنُ استعمال المباشر) تُفتح داخل البرنامج */
  if (/^\/(my-bookings|lisan|private-lessons)(\/|$)/.test(p)) return true;
  if (/^\/(wp-login\.php|wp-admin\/admin-ajax\.php|wp-json\/|wp-content\/|wp-includes\/)/.test(p)) return true;
  if ((p === '/' || p === '') && /[?&](cl_one|cl_app_login|loginSocial)=/.test(q)) return true;
  /* 🆕 27/10 — «برمجة حصّة» و«مباشر» من المركز يفتحان صفحةَ الأكاديمية بنموذجها: تبقى داخل البرنامج (طلبُ Anzan: «مخاصوش يخرج أصلاً») */
  return /[?&](cl_evadd|cl_golive)=1/.test(q);
}
function isInternal(u) { const x = parse(u); return !!x && x.protocol === 'file:' && decodeURIComponent(x.pathname).replace(/\\/g, '/').includes('/ui/'); }
function inLive() {
  if (!win || win.isDestroyed()) return false;
  const x = parse(win.webContents.getURL());
  return !!x && isOurs(x) && /^\/live-(room|class)\/\d+/.test(x.pathname);
}
const EXT_SCHEMES = ['https:', 'http:', 'mailto:', 'tel:', 'whatsapp:', 'zoommtg:', 'zoomus:', 'msteams:', 'skype:'];
/* 🆕 برنامج 27/10 — طلبُ Anzan: «بغيت يعطيني متصفح جوجل كيعطيني متصفح آخر» ⇒ روابطُ الويب (Meet، Zoom، صفحاتُ الموقع)
   تُفتح في Google Chrome إن كان مثبّتاً (فيه حسابُ Google والدخول)، وإلّا في المتصفّح الافتراضي. */
function findChrome() {
  if (IS_MAC) { const m = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; try { if (fs.existsSync(m)) return m; } catch (e) {} return ''; }
  if (!IS_WIN) return '';
  const roots = [process.env['PROGRAMFILES'], process.env['PROGRAMFILES(X86)'], process.env['LOCALAPPDATA']].filter(Boolean);
  for (const r of roots) {
    const f = path.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe');
    try { if (fs.existsSync(f)) return f; } catch (e) {}
  }
  return '';
}
function openOutside(u) {
  const x = parse(u);
  if (!x || !EXT_SCHEMES.includes(x.protocol)) return;
  if (x.protocol === 'https:' || x.protocol === 'http:') {
    const c = findChrome();
    if (c) {
      try {
        const p = require('child_process').spawn(c, [x.href], { detached: true, stdio: 'ignore' });
        p.on('error', () => shell.openExternal(x.href).catch(() => {}));
        p.unref();
        return;
      } catch (e) {}
    }
  }
  shell.openExternal(x.href).catch(() => {});
}

/* ── رابط coachlab:// ── مثال: coachlab://live?to=/live-room/123/ */
function deepLinkTo(argv) {
  const raw = (argv || []).find(a => typeof a === 'string' && a.toLowerCase().startsWith('coachlab://'));
  if (!raw) return null;
  const x = parse(raw);
  if (!x) return null;
  let to = x.searchParams.get('to') || '';
  if (!to && x.hostname === 'live' && /^\/\d+/.test(x.pathname)) to = '/live-room' + x.pathname.replace(/\/?$/, '/');
  if (!to) to = '/live-hub/';
  /* مسارٌ داخل الموقع فقط — لا «//موقع-آخر» ولا مخطّط */
  if (!/^\/(?!\/)[A-Za-z0-9\-._~\/?=&%#]*$/.test(to)) return null;
  return HOME + to;
}

/* ── نسخة واحدة فقط ── */
if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.on('second-instance', (_e, argv) => {
    const to = deepLinkTo(argv);
    if (win && !win.isDestroyed()) {
      if (to) win.loadURL(to);
      showWin();
    }
  });
}
if (process.defaultApp && process.argv.length >= 2) app.setAsDefaultProtocolClient('coachlab', process.execPath, [path.resolve(process.argv[1])]);
else app.setAsDefaultProtocolClient('coachlab');
app.on('open-url', (e, u) => { e.preventDefault(); const to = deepLinkTo([u]); if (to) { if (win) win.loadURL(to); else pendingTo = to; } });

/* 🩺 بدونه لا تظهر تنبيهات ويندوز (Toast) */
if (process.platform === 'win32') app.setAppUserModelId('ma.coachlab.desktop');
/* المباشر يحتاج الصوت دون لمسةٍ من المستخدم (المشاهد يدخل والصوت يعمل) */
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
/* 🩺 لا إبطاء للمؤقّتات حين تختفي النافذة (WebRTC/الدردشة) */
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

function showWin() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}

/* ── الجلسة: هويّة البرنامج + الأذونات + مشاركة الشاشة ── */
function setupSession() {
  const ses = session.fromPartition(PARTITION);
  /* 🩺 نحذف «Electron/…» و«CoachLab Live/…» من هويّة المتصفّح: Google يرفض الدخول من متصفّحٍ مُضمَّن يعلن عن نفسه */
  const ua = ses.getUserAgent().replace(/\s(Electron|coachlab-live|CoachLab Live)\/\S+/gi, '') + UA_MARK;
  ses.setUserAgent(ua);
  app.userAgentFallback = ua;

  const ALLOW = new Set(['media', 'notifications', 'display-capture', 'fullscreen', 'clipboard-sanitized-write', 'clipboard-read', 'speaker-selection', 'pointerLock', 'idle-detection', 'window-management']);
  /* 🆕 27/10 — بلاغ زبونة: «ديما كيطلب كلمة السرّ فالبرنامج». كوكي الدخول في ووردبريس بلا «تذكّرني» (أو بعد Google) كوكي جلسة
     يُمحى عند إغلاق البرنامج ⇒ نحوّل كوكيز الدخول لـcoachlab.ma إلى كوكيز دائمة (30 يوماً)، ونحفظ المخزن عند الخروج. */
  ses.cookies.on('changed', (ev, c, cause, removed) => {
    try {
      if (removed || !c || !c.session) return;
      const dom = String(c.domain || '').replace(/^\./, '');
      if (!(dom === 'coachlab.ma' || dom.endsWith('.coachlab.ma'))) return;
      if (!/^(wordpress_|wp-settings|cl_)/.test(c.name)) return;
      ses.cookies.set({ url: 'https://' + dom + (c.path || '/'), name: c.name, value: c.value, domain: c.hostOnly ? undefined : c.domain, path: c.path, secure: c.secure, httpOnly: c.httpOnly,
        sameSite: c.sameSite || 'lax', expirationDate: Math.floor(Date.now() / 1000) + 30 * 86400 }).catch(() => {});
    } catch (e) {}
  });
  app.on('before-quit', () => { try { ses.cookies.flushStore(); } catch (e) {} });
  ses.setPermissionRequestHandler((wc, perm, cb, details) => {
    const from = (details && (details.requestingUrl || details.securityOrigin)) || (wc && wc.getURL()) || '';
    cb(isOurs(from) && ALLOW.has(perm));
  });
  ses.setPermissionCheckHandler((wc, perm, origin) => isOurs(origin || (wc && wc.getURL()) || '') && ALLOW.has(perm));
  if (ses.setDevicePermissionHandler) ses.setDevicePermissionHandler(d => isOurs(d.origin || ''));

  ses.setDisplayMediaRequestHandler((request, callback) => {
    const deny = () => { try { callback({}); } catch (e) { /* 🩺 بعض النسخ ترفض {} — نتجاهل */ } };
    const origin = (request.frame && request.frame.url) || request.securityOrigin || '';
    if (origin && !isOurs(origin)) return deny();
    /* 🆕 28/10 — نوافذُنا العائمة لا تُعرض للاختيار (لا معنى لمشاركتها، وهي محميّة أصلاً) */
    const skip = new Set([bar, panel, picker, confirmWin].filter(w => w && !w.isDestroyed()).map(w => { try { return w.getMediaSourceId(); } catch (e) { return ''; } }));
    desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: true })
      .then(all => all.filter(x => !skip.has(x.id)))
      .then(sources => openPicker(sources).then(choice => {
        const src = choice && sources.find(s => s.id === choice.id);
        if (!src) return deny();
        const out = { video: src };
        if (choice.audio && process.platform === 'win32') out.audio = 'loopback';
        try { callback(out); } catch (e) { deny(); }
      }))
      .catch(() => deny());
  }, { useSystemPicker: false });
  return ses;
}

/* ── نافذة اختيار الشاشة ── */
function openPicker(sources) {
  return new Promise(resolve => {
    if (picker && !picker.isDestroyed()) picker.close();
    let done = false;
    const finish = v => { if (done) return; done = true; resolve(v); if (picker && !picker.isDestroyed()) picker.close(); };
    /* 🆕 28/10 — المشاركةُ قد تُطلب من الشريط العائم والنافذةُ مصغّرة/مخفيّة ⇒ لا أبَ مخفيّاً (وإلّا اختفت نافذةُ الاختيار معه) */
    const par = win && !win.isDestroyed() && win.isVisible() && !win.isMinimized() ? win : null;
    picker = new BrowserWindow({
      parent: par || undefined, modal: !!par, width: 760, height: 560, minWidth: 420, minHeight: 360,
      title: 'CoachLab Live', icon: ICON, backgroundColor: '#141414', autoHideMenuBar: true, show: false,
      webPreferences: { preload: path.join(__dirname, 'preload-ui.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    const list = sources.map(s => ({
      id: s.id, name: s.name, screen: s.id.startsWith('screen:'),
      thumb: s.thumbnail && !s.thumbnail.isEmpty() ? s.thumbnail.toDataURL() : '',
      icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : '',
    }));
    picker.setContentProtection(true);   /* 🆕 28/10 — نافذةُ الاختيار لا تظهر في البثّ */
    if (!par) picker.setAlwaysOnTop(true, 'screen-saver');
    const onChoice = (_e, v) => finish(v || null);
    ipcMain.once('picker:choice', onChoice);
    picker.on('closed', () => { ipcMain.removeListener('picker:choice', onChoice); picker = null; finish(null); });
    picker.webContents.once('did-finish-load', () => { picker.webContents.send('ui:init', { sources: list, win: process.platform === 'win32' }); picker.show(); });
    picker.loadFile(path.join(UI, 'picker.html'));
  });
}

/* ── نافذة «هل تغادر المباشر؟» ── */
function askLeave() {
  if (confirmWin && !confirmWin.isDestroyed()) { confirmWin.focus(); return; }
  showWin();
  confirmWin = new BrowserWindow({
    parent: win, modal: true, width: 420, height: 320, useContentSize: true, resizable: false, minimizable: false, maximizable: false,
    title: 'CoachLab Live', icon: ICON, backgroundColor: '#141414', autoHideMenuBar: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload-ui.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  const onAns = (_e, a) => {
    if (confirmWin && !confirmWin.isDestroyed()) confirmWin.close();
    if (a === 'leave') { quitting = true; app.quit(); }
    else if (a === 'tray') { if (win) win.hide(); }
  };
  ipcMain.once('confirm:answer', onAns);
  confirmWin.on('closed', () => { ipcMain.removeListener('confirm:answer', onAns); confirmWin = null; });
  confirmWin.once('ready-to-show', () => confirmWin.show());
  confirmWin.loadFile(path.join(UI, 'confirm.html'));
}

/* ── الوضع المصغّر: 360×640 في زاوية الشاشة وفوق كلّ النوافذ ── */
function toggleMini() {
  if (!win || win.isDestroyed()) return;
  if (mini) {
    win.setAlwaysOnTop(false);
    if (mini.max) win.maximize(); else win.setBounds(mini.bounds);
    mini = null;
  } else {
    mini = { bounds: win.getBounds(), max: win.isMaximized() };
    if (win.isMaximized()) win.unmaximize();
    if (win.isFullScreen()) win.setFullScreen(false);
    const wa = screen.getDisplayMatching(win.getBounds()).workArea;
    const w = 360, h = Math.min(640, wa.height - 24);
    win.setBounds({ x: wa.x + wa.width - w - 12, y: wa.y + wa.height - h - 12, width: w, height: h });
    win.setAlwaysOnTop(true, 'floating');
    showWin();
  }
  /* 🆕 28/10 — طلبُ Anzan: النافذةُ المصغّرة فوق الشاشة لا تظهر لمن يشاهد مشاركتَها (WDA_EXCLUDEFROMCAPTURE) */
  try { win.setContentProtection(!!mini); } catch (e) {}
  buildTray();
}

/* ── أيقونة شريط المهام ── */
function buildTray() {
  if (!tray) {
    let img = nativeImage.createFromPath(ICON);
    if (!img.isEmpty()) img = img.resize({ width: 16, height: 16 });
    tray = new Tray(img);
    tray.setToolTip('CoachLab Live');
    tray.on('click', showWin);
    tray.on('double-click', showWin);
  }
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'إظهار', click: showWin },
    { label: mini ? 'الحجم العادي' : 'الوضع المصغّر', accelerator: 'Ctrl+Shift+M', click: toggleMini },
    { type: 'separator' },
    /* 🆕 27/10 — طلبُ Anzan: تذكيرٌ قبل الحصّة وتشغيلٌ مع ويندوز */
    { label: 'تنبيهات الحصص (قبل 10 دقائق وعند البدء)', type: 'checkbox', checked: sget('remind', true), click: m => { sset('remind', m.checked); } },
    ...(IS_STORE ? [] : [{ label: IS_MAC ? 'شغّل مع الحاسوب' : 'شغّل مع ويندوز', type: 'checkbox', checked: loginOn(), click: m => { setLogin(m.checked); buildTray(); } }]),
    { label: 'الإغلاق يُبقي البرنامج هنا (للتنبيهات)', type: 'checkbox', checked: sget('closeToTray', true), click: m => { sset('closeToTray', m.checked); } },
    /* 🆕 28/10 — الأزرارُ العائمة أثناء المباشر، وتصغيرُ النافذة عند مشاركة الشاشة */
    { label: 'الأزرار العائمة أثناء المباشر', type: 'checkbox', checked: sget('floatBar', true), click: m => { sset('floatBar', m.checked); syncBar(); } },
    { label: 'صغّر النافذة عند مشاركة الشاشة', type: 'checkbox', checked: sget('minOnShare', true), click: m => { sset('minOnShare', m.checked); } },
    { label: 'تسجيلاتي على الحاسوب', click: () => { const d = recDir(); try { fs.mkdirSync(d, { recursive: true }); } catch (e) {} shell.openPath(d); } },
    ...(IS_STORE ? [] : [{ label: ready ? '🆕 حدّث الآن (' + ready + ')' : 'البحث عن تحديث', click: () => { if (ready) installNow(); else checkAll(true); } }]),
    { type: 'separator' },
    { label: 'خروج', click: () => { if (inLive()) askLeave(); else { quitting = true; app.quit(); } } },
  ]));
}

/* ── منع النوم أثناء المباشر ── */
function syncBlocker() {
  const live = inLive();
  if (live && blocker < 0) blocker = powerSaveBlocker.start('prevent-display-sleep');   /* 🔄 28/10 — جولةُ المباشر «ب»: الشاشةُ لا تنطفئ ولا يُقفَل ويندوز أثناء البثّ (كانت مشاركةُ الشاشة تصير سوداء بعد خمولٍ طويل) */
  else if (!live && blocker >= 0) { powerSaveBlocker.stop(blocker); blocker = -1; }
  syncKeys(live);
  if (!live && LIVE) { LIVE = null; syncBar(); }   /* 🆕 28/10 */
}

/* 🆕 27/10 — طلبُ Anzan: اختصاراتٌ مثل Zoom تعمل حتى والبرنامج في الخلف (PowerPoint أمامك).
   Ctrl+Shift+A (⌘⇧A في ماك) = كتمُ/فتحُ الميكروفون. تُسجَّل أثناء المباشر فقط كي لا تأخذ الاختصار من البرامج الأخرى طوال اليوم.
   الصفحةُ تنفّذ الأمر: window.clDeskCmd("mic") (inc/live-room.php). */
const KEYS = { 'CommandOrControl+Shift+A': 'mic' };
let keysOn = false;
function deskCmd(c) {
  if (!win || win.isDestroyed()) return;
  win.webContents.executeJavaScript('window.clDeskCmd?window.clDeskCmd(' + JSON.stringify(c) + '):0').then(r => {
    if (r === 'off' || r === 'on') toast(r === 'off' ? '🔇 الميكروفون مكتوم' : '🎙️ الميكروفون مفتوح', '', true);
  }).catch(() => {});
}
function syncKeys(live) {
  if (live && !keysOn) {
    keysOn = true;
    Object.keys(KEYS).forEach(k => { try { globalShortcut.register(k, () => deskCmd(KEYS[k])); } catch (e) {} });
  } else if (!live && keysOn) {
    keysOn = false;
    Object.keys(KEYS).forEach(k => { try { globalShortcut.unregister(k); } catch (e) {} });
  }
}

/* ── 🆕 28/10 — الأزرارُ العائمة (طلبُ Anzan: «بغيت نطور من برنامج اللايف وندير أزرار عائمة مكاتبانش فالبث المباشر») ──
   شريطٌ صغير بلا إطار فوق كلّ النوافذ (مستوى screen-saver) أثناء المباشر، مثل Zoom: 🎙️ 📷 🖥️ ✋ 💬 ⏱ ⤢ ⏹.
   setContentProtection(true) ⇒ في ويندوز 10 (2004) فما فوق: WDA_EXCLUDEFROMCAPTURE — لا يظهر في مشاركة الشاشة ولا في التسجيل؛
   في ويندوز أقدم يظهر مستطيلاً أسود (مقبول). الشريطُ لا يأخذ التركيز (focusable:false) ⇒ PowerPoint يبقى أمامك.
   ✋ و💬 يفتحان لوحةً منفصلة (محميّةٌ كذلك) — والصفحةُ (inc/live-desk.php، inc/live-rt-room.php) ترسل حالتها عبر clDesk.state
   وتنفّذ الأوامر عبر window.clDeskCmd(cmd, arg). يظهر وحده حين تكون على الهواء أو على المنصّة، ويختفي خارج المباشر.
   إعدادان في قائمة الأيقونة: «الأزرار العائمة أثناء المباشر» و«صغّر النافذة عند مشاركة الشاشة» (مفعّلان افتراضيّاً). ── */
const BAR_H = 46;
const PAGE_CMDS = new Set(['mic', 'cam', 'share', 'stopshare', 'hand-give', 'hand-lower', 'chat-send', 'seen', 'end']);
function str(v, n) { return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, n); }
function cleanState(s) {
  if (!s || typeof s !== 'object' || s.live !== true) return null;
  const b = v => (v === true ? true : v === false ? false : null);
  const lb = {};
  if (s.lb && typeof s.lb === 'object') Object.keys(s.lb).slice(0, 40).forEach(k => { if (/^[a-zA-Z]{1,12}$/.test(k)) lb[k] = str(s.lb[k], 60); });
  return {
    live: true, role: ['host', 'stage', 'member'].includes(s.role) ? s.role : '',
    mic: b(s.mic), cam: b(s.cam), sharing: s.sharing === true,
    hands: (Array.isArray(s.hands) ? s.hands : []).slice(0, 30).map(h => ({ uid: Math.max(0, parseInt(h && h.uid, 10) || 0), name: str(h && h.name, 60) })).filter(h => h.uid > 0),
    unread: Math.max(0, Math.min(999, parseInt(s.unread, 10) || 0)),
    lastMsgs: (Array.isArray(s.lastMsgs) ? s.lastMsgs : []).slice(-12).map(m => ({ n: str(m && m.n, 60), t: str(m && m.t, 300), me: m && m.me ? 1 : 0 })),
    since: Math.max(0, Math.min(Date.now(), Number(s.since) || 0)), lb,
    end: ['endBc', 'endStage', 'endAll', 'leave'].includes(s.end) ? s.end : 'leave',
  };
}
function uiWin(o) {
  const w = new BrowserWindow(Object.assign({
    frame: false, transparent: true, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, alwaysOnTop: true, show: false, hasShadow: false, backgroundColor: '#00000000', title: 'CoachLab Live', icon: ICON,
    webPreferences: { preload: path.join(__dirname, 'preload-ui.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  }, o));
  w.setAlwaysOnTop(true, 'screen-saver');
  try { w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (e) {}
  w.setContentProtection(true);   /* 🩺 قلبُ الطلب: لا يُلتقط */
  w.webContents.on('will-navigate', e => e.preventDefault());
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  return w;
}
function barPos(w) {
  const p = sget('barPos', null);
  if (p && typeof p.x === 'number' && typeof p.y === 'number') {
    const wa = screen.getDisplayMatching({ x: Math.round(p.x), y: Math.round(p.y), width: w, height: BAR_H }).workArea;
    if (p.x > wa.x - w + 60 && p.x < wa.x + wa.width - 60 && p.y >= wa.y && p.y < wa.y + wa.height - 20) return { x: Math.round(p.x), y: Math.round(p.y) };
  }
  const wa = screen.getPrimaryDisplay().workArea;
  return { x: Math.round(wa.x + (wa.width - w) / 2), y: wa.y + 12 };
}
function openBar() {
  if (bar && !bar.isDestroyed()) return;
  const p = barPos(barW);
  bar = uiWin({ width: barW, height: BAR_H, x: p.x, y: p.y, focusable: false });
  bar.on('moved', () => { if (!bar || bar.isDestroyed()) return; const b = bar.getBounds(); sset('barPos', { x: b.x, y: b.y }); placePanel(); });
  bar.on('closed', () => { bar = null; closePanel(); });
  bar.webContents.once('did-finish-load', () => { sendState(); if (bar && !bar.isDestroyed()) bar.showInactive(); });
  bar.loadFile(path.join(UI, 'toolbar.html'));
}
function closeBar() { closePanel(); if (bar && !bar.isDestroyed()) bar.destroy(); bar = null; }
function placePanel() {
  if (!panel || panel.isDestroyed() || !bar || bar.isDestroyed()) return;
  const b = bar.getBounds(), sz = panel.getSize(), wa = screen.getDisplayMatching(b).workArea;
  let x = Math.round(b.x + (b.width - sz[0]) / 2), y = b.y + b.height + 6;
  if (y + sz[1] > wa.y + wa.height) y = b.y - sz[1] - 6;
  x = Math.max(wa.x + 4, Math.min(x, wa.x + wa.width - sz[0] - 4)); y = Math.max(wa.y + 4, y);
  panel.setPosition(x, y);
}
function openPanel(kind) {
  if (panel && !panel.isDestroyed()) {
    if (panelKind === kind) { closePanel(); sendState(); return; }
    panelKind = kind; sendState(); placePanel(); panel.show(); return;
  }
  panelKind = kind;
  panel = uiWin({ width: 340, height: 420 });
  panel.on('closed', () => { panel = null; panelKind = ''; sendState(); });
  panel.webContents.once('did-finish-load', () => { sendState(); placePanel(); if (panel && !panel.isDestroyed()) panel.show(); });
  panel.loadFile(path.join(UI, 'panel.html'));
  sendState();
}
function closePanel() { if (panel && !panel.isDestroyed()) panel.destroy(); panel = null; panelKind = ''; }
function sendState() {
  const d = Object.assign({}, LIVE || { live: false }, { panel: panelKind });
  [bar, panel].forEach(w => { if (w && !w.isDestroyed()) w.webContents.send('ui:state', d); });
}
function pageCmd(c, a) {
  if (!win || win.isDestroyed() || !inLive() || !PAGE_CMDS.has(c)) return;
  const arg = c === 'chat-send' ? str(a, 500) : (c === 'hand-give' || c === 'hand-lower') ? (parseInt(a, 10) || 0) : null;
  if (c === 'chat-send' && !arg.trim()) return;
  /* userGesture=true: مشاركةُ الشاشة (getDisplayMedia) تحتاج «لمسة» */
  win.webContents.executeJavaScript('window.clDeskCmd&&window.clDeskCmd(' + JSON.stringify(c) + (arg === null ? '' : ',' + JSON.stringify(arg)) + ')', true).catch(() => {});
}
/* 🔄 28/10 — ملاحظةُ Anzan: «إيقونات معادة» ⇒ الشريطُ العائم لا يظهر ونافذةُ البرنامج في الواجهة (أزرارُ الصفحة تكفي)،
   ويظهر وحده حين تخرج منها (تصغير، نافذةٌ أخرى، مشاركةُ الشاشة) — كما في Zoom. */
function winFront() { return !!(win && !win.isDestroyed() && win.isVisible() && !win.isMinimized() && win.isFocused()); }
let frontT = 0;
function syncBarSoon() { clearTimeout(frontT); frontT = setTimeout(syncBar, 220); }
function syncBar() {
  const live = !!(LIVE && inLive() && sget('floatBar', true));
  const on = live && !winFront();
  if (on) openBar(); else closeBar();
  /* مشاركةُ الشاشة بدأت ⇒ تصغيرُ نافذة البرنامج (الإعداد) — وتعود حين تتوقّف إن كنّا من صغّرها */
  const sh = !!(live && LIVE.sharing);
  if (sh && !wasSharing && sget('minOnShare', true) && !mini && win && !win.isDestroyed() && win.isVisible() && !win.isMinimized()) { minByShare = true; win.minimize(); }
  if (!sh && wasSharing && minByShare) { minByShare = false; if (win && !win.isDestroyed() && win.isMinimized()) win.restore(); }
  wasSharing = sh;
  if (panelKind === 'chat' && LIVE && LIVE.unread > 0) pageCmd('seen');
  sendState();
}
ipcMain.on('cl:state', (e, s) => {
  if (!win || win.isDestroyed() || e.sender !== win.webContents || !fromUs(e)) return;
  LIVE = cleanState(s); syncBar();
});
ipcMain.on('bar:cmd', (e, m) => {
  const ok = (bar && !bar.isDestroyed() && e.sender === bar.webContents) || (panel && !panel.isDestroyed() && e.sender === panel.webContents);
  if (!ok || !m || typeof m.c !== 'string') return;
  const c = m.c;
  if (c === 'back') { minByShare = false; showWin(); return; }
  if (c === 'panel') { if (m.a === 'hands' || m.a === 'chat') { openPanel(m.a); if (m.a === 'chat') pageCmd('seen'); } return; }
  if (c === 'panel-close') { closePanel(); sendState(); return; }
  if (c === 'size') {
    const w = Math.max(160, Math.min(760, parseInt(m.a, 10) || 0));
    if (bar && !bar.isDestroyed() && w !== barW) {
      const b = bar.getBounds(); barW = w;
      bar.setResizable(true); bar.setBounds({ x: b.x + (b.width - w), y: b.y, width: w, height: BAR_H }); bar.setResizable(false); placePanel();
    }
    return;
  }
  if (c === 'end') closePanel();
  pageCmd(c, m.a);
});

/* ── تنبيهاتُ النظام ── */
function toast(title, body, silent, onClick) {
  try {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body: body || '', icon: ICON, silent: !!silent });
    n.on('click', () => { showWin(); if (onClick) onClick(); });
    n.show();
  } catch (e) {}
}

/* ── التشغيلُ مع ويندوز/ماك ── */
function loginOn() { try { return !!app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin; } catch (e) { return false; } }
function setLogin(on) { if (IS_STORE) return; try { app.setLoginItemSettings({ openAtLogin: !!on, openAsHidden: true, args: ['--hidden'] }); } catch (e) {} }

/* ── 🆕 27/10 — تذكيرُ الحصص: كلَّ دقيقة نقرأ حصصَ العضو للـ24 ساعة القادمة (جلسةُ البرنامج نفسُها) ──
   قبل 10 دقائق ⇒ «تبدأ بعد X دقائق» · وعند بدء البثّ ⇒ «بدأ المباشر». الضغط يفتح الحصّة في البرنامج. لا تكرار. */
const FEED = HOME + '/wp-admin/admin-ajax.php?action=cl_lhub_feed';
let told = {};
function remindTick(ses) {
  if (!sget('remind', true)) return;
  ses.fetch(FEED + '&t=' + Date.now(), { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).then(j => {
    if (!j || !j.success || !j.data || !Array.isArray(j.data.items)) return;
    const now = Date.now();
    Object.keys(told).forEach(k => { if (now - told[k] > 2 * 86400000) delete told[k]; });
    j.data.items.forEach(it => {
      const id = String(it.id || ''), inS = Number(it.in || 0), url = String(it.url || '');
      if (!id) return;
      const open = () => { if (!url) return; if (isOurs(url) && isAppPath(url)) { if (win && !win.isDestroyed()) win.loadURL(url); } else openOutside(url); };
      if (it.live && !told['L' + id]) {
        told['L' + id] = now; told['S' + id] = now;
        if (!inLive()) toast('🔴 بدأ المباشر: ' + (it.title || ''), (it.src ? it.src + ' · ' : '') + 'اضغط للدخول', false, open);
      } else if (!it.live && inS > 0 && inS <= 600 && !told['S' + id]) {
        told['S' + id] = now;
        toast('⏰ حصّتك بعد ' + Math.max(1, Math.round(inS / 60)) + ' دقائق', (it.title || '') + (it.src ? ' — ' + it.src : ''), false, open);
      }
    });
    sset('told', told);
  }).catch(() => {});
}

/* ── 🆕 27/10 — حفظُ التسجيل الاحتياطي في الحاسوب (Videos\CoachLab) ── */
function recDir() { return path.join(app.getPath('videos'), 'CoachLab'); }
function safeName(n) {
  let b = String(n || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!b) b = 'CoachLab-' + new Date().toISOString().replace(/[:.]/g, '-');
  if (!/\.(webm|mp4|mkv|m4a|ogg|wav|png|jpg|pdf)$/i.test(b)) b += '.webm';
  return b;
}
function uniquePath(dir, name) {
  let p = path.join(dir, name), i = 1;
  const ext = path.extname(name), base = name.slice(0, name.length - ext.length);
  while (fs.existsSync(p)) p = path.join(dir, base + ' (' + (i++) + ')' + ext);
  return p;
}
const OPEN = new Map(); let openSeq = 0;
function fromUs(e) { try { return isOurs(e.senderFrame ? e.senderFrame.url : e.sender.getURL()); } catch (x) { return false; } }
function toBuf(d) { if (!d) return null; if (Buffer.isBuffer(d)) return d; if (d instanceof ArrayBuffer) return Buffer.from(d); if (ArrayBuffer.isView(d)) return Buffer.from(d.buffer, d.byteOffset, d.byteLength); return null; }
ipcMain.handle('cl:save', (e, name, data) => {
  if (!fromUs(e)) throw new Error('denied');
  const b = toBuf(data); if (!b) throw new Error('nodata');
  const d = recDir(); fs.mkdirSync(d, { recursive: true });
  const p = uniquePath(d, safeName(name)); fs.writeFileSync(p, b); return p;
});
ipcMain.handle('cl:saveOpen', (e, name) => {
  if (!fromUs(e)) throw new Error('denied');
  const d = recDir(); fs.mkdirSync(d, { recursive: true });
  const p = uniquePath(d, safeName(name)); const id = ++openSeq;
  OPEN.set(id, { p, fd: fs.openSync(p, 'w') }); return id;
});
ipcMain.handle('cl:saveWrite', (e, id, data) => {
  if (!fromUs(e)) throw new Error('denied');
  const o = OPEN.get(id), b = toBuf(data); if (!o || !b) throw new Error('bad'); fs.writeSync(o.fd, b); return b.length;
});
ipcMain.handle('cl:saveClose', (e, id) => {
  if (!fromUs(e)) throw new Error('denied');
  const o = OPEN.get(id); if (!o) throw new Error('bad'); fs.closeSync(o.fd); OPEN.delete(id); return o.p;
});
ipcMain.handle('cl:reveal', (e, p) => {
  if (!fromUs(e)) return false;
  const d = recDir(), r = path.resolve(String(p || ''));
  if (!r.startsWith(d)) return false;
  shell.showItemInFolder(r); return true;
});
/* 🆕 28/10 — طلبُ Anzan «ما لقيتش فين نحمّل اللايف»: فتحُ مجلّد التسجيلات، وتحميلُ تسجيلٍ (رابطُ Cloudflare فقط) إليه مباشرةً */
ipcMain.handle('cl:openRecDir', e => {
  if (!fromUs(e)) return false;
  const d = recDir(); try { fs.mkdirSync(d, { recursive: true }); } catch (x) {}
  return shell.openPath(d).then(r => !r);
});
let dlName = '';
ipcMain.handle('cl:downloadUrl', (e, url, name) => {
  if (!fromUs(e) || !win || win.isDestroyed()) return false;
  const x = parse(String(url || ''));
  if (!x || x.protocol !== 'https:' || !/(^|\.)(cloudflarestream\.com|videodelivery\.net)$/i.test(x.hostname)) return false;
  dlName = String(name || ''); win.webContents.downloadURL(x.href); return true;
});
function onDownload(_e, item) {
  const d = recDir(); try { fs.mkdirSync(d, { recursive: true }); } catch (x) {}
  let n = safeName(dlName || item.getFilename()); dlName = '';
  if (/\.webm$/i.test(n) && /\.mp4$/i.test(item.getFilename())) n = n.replace(/\.webm$/i, '.mp4');
  const p = uniquePath(d, n); item.setSavePath(p);
  item.once('done', (_x, st) => {
    if (st === 'completed') toast('اكتمل التحميل', path.basename(p) + ' — Videos\\CoachLab', false, () => shell.showItemInFolder(p));
    else if (st !== 'cancelled') toast('تعذّر التحميل', 'أعد المحاولة من «التسجيلات».');
  });
}

ipcMain.handle('cl:notify', (e, title, body) => {
  if (!fromUs(e)) return false;
  toast(String(title || '').slice(0, 120), String(body || '').slice(0, 300)); return true;
});

/* ── إعلان النسخة الجديدة ── */
function newer(a, b) {
  const p = s => String(s || '').split('.').map(n => parseInt(n, 10) || 0);
  const x = p(a), y = p(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); }
  return false;
}
function checkUpdate(ses) {
  if (IS_STORE) return;   /* Store يحدّث بنفسه */
  ses.fetch(LATEST + '?t=' + Date.now(), { cache: 'no-store' })
    .then(r => (r.ok ? r.json() : null))
    .then(j => {
      if (!j || !j.version || !newer(j.version, app.getVersion())) return;
      if (IS_MAC && !(j.mac && isOurs(j.mac))) return;   /* 🆕 لا نسخةَ ماك بعد ⇒ لا إعلان */
      const u = IS_MAC ? j.mac : (isOurs(j.url || '') ? j.url : HOME + '/wp-content/uploads/cl-app/CoachLab-Live-Setup.exe');
      update = { version: String(j.version).replace(/[^0-9.]/g, ''), url: u };
      injectBanner();
    })
    .catch(() => {});
}
function injectBanner() {
  if (!update || !win || win.isDestroyed() || !isOurs(win.webContents.getURL())) return;
  const js = `(function(){try{if(document.getElementById('cl-dsk-upd')||sessionStorage.getItem('cl_dsk_upd')===${JSON.stringify(update.version)})return;
var d=document.createElement('div');d.id='cl-dsk-upd';d.dir='rtl';d.setAttribute('translate','no');
d.style.cssText='position:fixed;top:0;left:0;right:0;z-index:2147483600;background:#f4c430;color:#0a1628;font:800 13.5px Cairo,Tajawal,sans-serif;display:flex;align-items:center;justify-content:center;gap:10px;padding:8px 12px;box-shadow:0 4px 14px rgba(0,0,0,.2)';
var t=document.createElement('span');t.textContent='🆕 نسخة جديدة من CoachLab Live (${update.version}) متاحة';
var b=document.createElement('button');b.type='button';b.textContent='حمّلها';b.style.cssText='background:#0a1628;color:#f4c430;border:0;border-radius:8px;padding:5px 14px;font:900 13px Cairo,sans-serif;cursor:pointer';
b.onclick=function(){if(window.CoachLabDesktop)window.CoachLabDesktop.download();};
var x=document.createElement('button');x.type='button';x.textContent='✕';x.setAttribute('aria-label','إغلاق');x.style.cssText='background:transparent;border:0;font-size:15px;cursor:pointer;color:#0a1628';
x.onclick=function(){d.remove();try{sessionStorage.setItem('cl_dsk_upd',${JSON.stringify(update.version)});}catch(e){}};
d.appendChild(t);d.appendChild(b);d.appendChild(x);document.body.appendChild(d);}catch(e){}})();`;
  win.webContents.executeJavaScript(js).catch(() => {});
}

/* ── 🆕 27/10 — التحديثُ التلقائيّ (ويندوز): electron-updater من coachlab.ma (latest.yml).
   يتحقّق عند البدء وكلَّ 6 ساعات، ينزّل في الخلف، ثمّ شريطٌ «نسخة جديدة جاهزة — حدّث الآن» ⇒ يُغلق ويُثبّت ويعود.
   البرنامج غير موقّع ⇒ verifyUpdateCodeSignature=false (package.json). أيُّ خطأ ⇒ نرجع إلى الإعلان القديم (desktop-latest.json). ── */
let AU = null, auFail = false, SES = null;
function autoUp() {
  if (AU !== null) return AU;
  AU = false;
  if (!IS_WIN || !app.isPackaged || IS_STORE) return AU;
  try {
    AU = require('electron-updater').autoUpdater;
    AU.autoDownload = true; AU.autoInstallOnAppQuit = true; AU.allowDowngrade = false;
    AU.on('update-downloaded', info => {
      ready = String((info && info.version) || '').replace(/[^0-9.]/g, '') || 'new';
      update = null; buildTray(); injectReady();
      toast('🆕 نسخة جديدة من CoachLab Live جاهزة', 'اضغط «حدّث الآن» في أعلى البرنامج (أقلّ من دقيقة).', true, () => injectReady());
    });
    AU.on('update-available', info => { if (!ready) toast('CoachLab Live', 'نسخةٌ جديدة (' + String((info && info.version) || '').replace(/[^0-9.]/g, '') + ') قيد التنزيل — سيظهر زرّ «حدّث الآن» عند اكتماله.', true); });   /* 🆕 28/10 */
    AU.on('error', () => { auFail = true; if (SES) checkUpdate(SES); });
  } catch (e) { AU = false; }
  return AU;
}
function checkAll(manual) {
  if (IS_STORE) return;
  const a = autoUp();
  if (a && !auFail) { a.checkForUpdates().then(r => { if (manual && (!r || !r.updateInfo || !newer(r.updateInfo.version, app.getVersion()))) toast('CoachLab Live', 'عندك آخر نسخة (' + app.getVersion() + ').', true); }).catch(() => { auFail = true; if (SES) checkUpdate(SES); }); return; }
  if (SES) checkUpdate(SES);
}
function installNow() {
  if (!ready || !AU) return;
  if (inLive()) { askLeave(); return; }
  quitting = true;
  setImmediate(() => { try { AU.quitAndInstall(true, true); } catch (e) {} });
}
ipcMain.on('cl:install', () => installNow());
function injectReady() {
  if (!ready || !win || win.isDestroyed() || !isOurs(win.webContents.getURL())) return;
  const js = `(function(){try{var o=document.getElementById('cl-dsk-upd');if(o)o.remove();if(document.getElementById('cl-dsk-rdy'))return;
var d=document.createElement('div');d.id='cl-dsk-rdy';d.dir='rtl';d.setAttribute('translate','no');
d.style.cssText='position:fixed;top:0;left:0;right:0;z-index:2147483600;background:#16a34a;color:#fff;font:800 13.5px Cairo,Tajawal,sans-serif;display:flex;align-items:center;justify-content:center;gap:10px;padding:8px 12px;box-shadow:0 4px 14px rgba(0,0,0,.2)';
var t=document.createElement('span');t.textContent='🆕 نسخة جديدة جاهزة (${ready}) — يُعاد تشغيل البرنامج في ثوانٍ';
var b=document.createElement('button');b.type='button';b.textContent='حدّث الآن';b.style.cssText='background:#fff;color:#166534;border:0;border-radius:8px;padding:5px 14px;font:900 13px Cairo,sans-serif;cursor:pointer';
b.onclick=function(){if(window.CoachLabDesktop&&window.CoachLabDesktop.install)window.CoachLabDesktop.install();};
var x=document.createElement('button');x.type='button';x.textContent='لاحقاً';x.style.cssText='background:transparent;border:1px solid rgba(255,255,255,.6);border-radius:8px;color:#fff;padding:4px 10px;font:800 12px Cairo,sans-serif;cursor:pointer';
x.onclick=function(){d.remove();};
d.appendChild(t);d.appendChild(b);d.appendChild(x);document.body.appendChild(d);}catch(e){}})();`;
  win.webContents.executeJavaScript(js).catch(() => {});
}

/* 🆕 28/10 — بلاغ Anzan: «برمجة حصّة» تفتح صفحةَ الأكاديمية ولا رجوع منها ⇒ زرٌّ ثابت «الرئيسية» في كلّ صفحةٍ للبرنامج
   ليست المركزَ ولا غرفةَ المباشر ولا الدخول. */
function injectHome() {
  if (!win || win.isDestroyed()) return;
  const x = parse(win.webContents.getURL());
  if (!x || !isOurs(x) || /^\/(live-hub|live-room|live-class|connect|wp-login\.php)(\/|$)/.test(x.pathname)) return;
  const js = `(function(){try{if(document.getElementById('cl-desk-home'))return;
var a=document.createElement('a');a.id='cl-desk-home';a.href=${JSON.stringify(START)};a.setAttribute('aria-label','الرجوع إلى الرئيسية');
a.innerHTML='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/></svg><span>الرئيسية</span>';
a.style.cssText='position:fixed;bottom:18px;left:18px;z-index:2147483000;display:flex;align-items:center;gap:8px;background:#0F1F3D;color:#F4C430;border-radius:999px;padding:10px 16px 10px 14px;font:800 14px Cairo,Tahoma,sans-serif;text-decoration:none;box-shadow:0 6px 18px rgba(15,31,61,.28)';
document.body.appendChild(a);}catch(e){}})();`;
  win.webContents.executeJavaScript(js).catch(() => {});
}

/* ── حراسة التنقّل لكلّ نافذة ويب ── */
function guard(wc) {
  wc.on('will-navigate', (e, u) => {
    if (isAppPath(u) || isAuth(u) || isInternal(u)) return;
    e.preventDefault();
    /* 🆕 27/10 — بلاغ Anzan: «خروج» من الغرفة كان يفتح الأكاديمية في المتصفّح. الخروجُ من غرفةٍ (أو أيّ صفحة للبرنامج) إلى صفحةٍ أخرى من الموقع ⇒ مركزُ المباشر داخل البرنامج */
    const cur = parse(wc.getURL());
    if (isOurs(u) && cur && isOurs(cur) && /^\/live-(room|class)\/\d+/.test(cur.pathname)) { wc.loadURL(START); return; }
    openOutside(u);
  });
  wc.setWindowOpenHandler(({ url }) => {
    if (url === 'about:blank' || isAppPath(url) || isAuth(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: { icon: ICON, autoHideMenuBar: true, backgroundColor: '#ffffff', webPreferences: { partition: PARTITION, backgroundThrottling: false, contextIsolation: true, sandbox: true } } };
    }
    openOutside(url);
    return { action: 'deny' };
  });
  wc.on('did-create-window', child => guard(child.webContents));
  wc.on('before-input-event', (e, i) => {
    if (i.type !== 'keyDown') return;
    const k = (i.key || '').toLowerCase(), c = i.control || i.meta;
    if (c && i.shift && k === 'm') { e.preventDefault(); toggleMini(); }
    else if (k === 'f5' || (c && k === 'r')) { e.preventDefault(); wc.reload(); }
    else if (k === 'f11') { e.preventDefault(); const w = BrowserWindow.fromWebContents(wc); if (w) w.setFullScreen(!w.isFullScreen()); }
    else if (c && (k === '=' || k === '+')) { e.preventDefault(); wc.setZoomLevel(Math.min(wc.getZoomLevel() + 0.5, 4)); }
    else if (c && k === '-') { e.preventDefault(); wc.setZoomLevel(Math.max(wc.getZoomLevel() - 0.5, -3)); }
    else if (c && k === '0') { e.preventDefault(); wc.setZoomLevel(0); }
    else if (i.alt && k === 'arrowleft' && wc.navigationHistory.canGoBack()) { e.preventDefault(); wc.navigationHistory.goBack(); }
    else if (c && i.shift && k === 'i') { e.preventDefault(); wc.toggleDevTools(); }
  });
}

function createWindow(ses) {
  win = new BrowserWindow({
    /* 🛑 29/10 — بلاغ Anzan (صورة حاسوب 1366×768): النافذةُ 1280×800 أطول من الشاشة ⇒ أسفلُها (شريطُ الأدوات) تحت شريط ويندوز. نأخذ مساحةَ العمل الفعلية */
    width: Math.min(1280, screen.getPrimaryDisplay().workAreaSize.width), height: Math.min(800, screen.getPrimaryDisplay().workAreaSize.height), minWidth: 360, minHeight: 480, show: false,
    title: 'CoachLab Live', icon: ICON, backgroundColor: '#141414', autoHideMenuBar: true,
    webPreferences: {
      session: ses, preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      backgroundThrottling: false, spellcheck: false, autoplayPolicy: 'no-user-gesture-required',
    },
  });
  win.setMenuBarVisibility(false);
  win.once('ready-to-show', () => { const wa = screen.getPrimaryDisplay().workAreaSize; if (wa.width <= 1440 || wa.height <= 860) win.maximize(); if (!HIDDEN) win.show(); });   /* 🆕 29/10 — شاشةُ حاسوبٍ صغيرة ⇒ ملءُ الشاشة بلا تجاوز شريط ويندوز */
  win.on('focus', () => { clearTimeout(frontT); syncBar(); });
  ['blur', 'minimize', 'restore', 'show', 'hide'].forEach(ev => win.on(ev, syncBarSoon));
  const wc = win.webContents;
  guard(wc);
  wc.on('did-navigate', (_e, u) => {
    /* إعادةُ توجيهٍ من الخادم (بعد الدخول مثلاً) إلى صفحةٍ ليست للمباشر ⇒ المركز */
    LIVE = null; syncBar();   /* 🆕 28/10 — صفحةٌ جديدة: الشريطُ ينتظر حالتَها */
    if (isOurs(u) && !isAppPath(u)) { win.loadURL(START); return; }
    syncBlocker();
  });
  wc.on('did-navigate-in-page', syncBlocker);
  wc.on('did-finish-load', () => { syncBlocker(); injectHome(); if (ready) { if (!inLive()) injectReady(); } else injectBanner(); });
  wc.on('page-title-updated', (e, t) => { e.preventDefault(); win.setTitle(t && t !== 'CoachLab Live' ? t + ' — CoachLab Live' : 'CoachLab Live'); });
  wc.on('did-fail-load', (_e, code, _d, url, isMain) => {
    if (!isMain || code === -3 || isInternal(url)) return;   /* -3 = تنقّلٌ أُلغي، ليس انقطاعاً */
    win.loadFile(path.join(UI, 'offline.html'), { query: { u: isOurs(url) ? url : START } });
  });
  wc.on('render-process-gone', () => { setTimeout(() => { if (win && !win.isDestroyed()) wc.reload(); }, 1000); });
  win.on('close', e => {
    if (quitting) return;
    if (inLive()) { e.preventDefault(); askLeave(); return; }
    /* 🆕 27/10 — يبقى في شريط المهام لتنبيهات الحصص (يُعطَّل من قائمة الأيقونة) */
    if (sget('closeToTray', true) && tray) {
      e.preventDefault(); win.hide();
      if (!sget('trayTold', false)) { sset('trayTold', true); toast('CoachLab Live ما زال يعمل', 'يبقى هنا في شريط المهام لينبّهك قبل حصصك. للخروج: زرّ الفأرة الأيمن على الأيقونة ثمّ «خروج».'); }
      return;
    }
    quitting = true;
  });
  win.on('closed', () => { win = null; quitting = true; app.quit(); });   /* النوافذ الفرعية (دخول Google…) لا تُبقي البرنامج حيّاً */
  win.loadURL(pendingTo || deepLinkTo(process.argv) || START);
  pendingTo = null;
}

/* ── قنوات صفحة الموقع (preload.js) ── */
ipcMain.on('cl:mini', () => toggleMini());
ipcMain.on('cl:show', () => showWin());
ipcMain.on('cl:download', () => { openOutside(update ? update.url : HOME + '/wp-content/uploads/cl-app/CoachLab-Live-Setup.exe'); });
ipcMain.handle('cl:info', () => ({ version: app.getVersion(), mini: !!mini, update, ready, platform: process.platform }));

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  const ses = setupSession(); SES = ses;
  ses.on('will-download', onDownload);
  told = sget('told', {}) || {};
  createWindow(ses);
  buildTray();
  setTimeout(() => checkAll(false), 5000);
  setInterval(() => checkAll(false), 30 * 60 * 1000);   /* 🔄 28/10 — بلاغ Anzan «ما ظهرليش زر التحديث»: كلَّ 30 دقيقة بدل 6 ساعات */
  let lastFocusCheck = Date.now();
  app.on('browser-window-focus', () => { if (Date.now() - lastFocusCheck > 10 * 60 * 1000) { lastFocusCheck = Date.now(); checkAll(false); } });   /* 🆕 28/10 — والرجوعُ إلى البرنامج يتحقّق أيضاً */
  setTimeout(() => remindTick(ses), 15000);
  setInterval(() => remindTick(ses), 60 * 1000);   /* 🆕 تذكيرُ الحصص */
});
app.on('activate', () => { if (win && !win.isDestroyed()) showWin(); });   /* ماك: الضغط على أيقونة Dock */
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => { try { globalShortcut.unregisterAll(); } catch (e) {} });
app.on('window-all-closed', () => { app.quit(); });
