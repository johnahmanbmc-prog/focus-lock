// Focus Lock desktop app: the window and tray icon. The settings themselves
// live in the Focus Lock Windows service (service.js), which this window
// talks to over 127.0.0.1. During development, with no service installed,
// the app runs the same engine itself and keeps the settings in its own
// folder.
'use strict';

const path = require('node:path');
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell, dialog } = require('electron');
const { createServer, PORT, CLIENT_HEADER } = require('./core/server');
const { createEngine } = require('./core/engine');

const BASE = 'http://127.0.0.1:' + PORT;

// For testing: keep the settings in another folder.
if (process.env.FOCUSLOCK_DATA_DIR) app.setPath('userData', process.env.FOCUSLOCK_DATA_DIR);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  start();
}

async function call(pathname, body) {
  const response = await fetch(BASE + pathname, {
    method: body ? 'POST' : 'GET',
    headers: body ? { [CLIENT_HEADER]: '1', 'Content-Type': 'application/json' } : { [CLIENT_HEADER]: '1' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(4000)
  });
  if (!response.ok) throw new Error('Service answered ' + response.status);
  return response.json();
}

function start() {
  let win = null;
  let tray = null;
  let quitting = false;
  let lastView = null;
  let mode = 'service'; // or 'embedded' during development
  const startHidden = process.argv.includes('--hidden');

  const offline = () => ({ offline: true, now: Date.now() });

  async function getView() {
    try {
      lastView = await call('/v1/view');
    } catch (error) {
      lastView = offline();
    }
    return lastView;
  }

  async function refresh() {
    const view = await getView();
    if (win && !win.isDestroyed()) win.webContents.send('state', view);
    updateTray();
  }

  function statusLine() {
    const v = lastView;
    if (!v || v.offline) return 'Service not running';
    if (v.strict) return 'Strict mode on';
    if (!v.settings.enabled) return 'Blocker off';
    if (!v.settings.schedule.length) return 'No blocking hours set';
    return v.blockingNow ? 'Blocking now' : 'Outside blocking hours';
  }

  function updateTray() {
    if (!tray) return;
    tray.setToolTip('Focus Lock: ' + statusLine());
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: statusLine(), enabled: false },
      { type: 'separator' },
      { label: 'Open Focus Lock', click: showWindow },
      { label: 'Close this window (blocking continues)', click: () => { quitting = true; app.quit(); } }
    ]));
  }

  function showWindow() {
    if (!win || win.isDestroyed()) createWindow();
    win.show();
    win.focus();
  }

  function createWindow() {
    win = new BrowserWindow({
      width: 1000,
      height: 780,
      minWidth: 420,
      minHeight: 500,
      show: false,
      title: 'Focus Lock',
      icon: path.join(__dirname, 'assets', 'icon.png'),
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    win.loadFile(path.join(__dirname, 'ui', 'index.html'));
    win.once('ready-to-show', () => { if (!startHidden || tray === null) win.show(); });
    win.on('close', event => {
      if (!quitting) {
        event.preventDefault();
        win.hide();
      }
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\//.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', event => event.preventDefault());
  }

  ipcMain.handle('getState', () => getView());

  ipcMain.handle('change', async (event, change) => {
    let result;
    try {
      result = await call('/v1/change', change);
    } catch (error) {
      result = { ok: false, error: 'The Focus Lock service is not running, so nothing was changed.' };
    }
    refresh();
    return result;
  });

  ipcMain.handle('confirm', async (event, message, detail) => {
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Cancel', 'Continue'],
      defaultId: 0,
      cancelId: 0,
      message,
      detail: detail || ''
    });
    return response === 1;
  });

  ipcMain.handle('openExtensionFolder', () => {
    const folder = app.isPackaged
      ? path.join(process.resourcesPath, 'extension')
      : path.join(__dirname, '..', 'extension');
    shell.openPath(folder);
    return folder;
  });

  ipcMain.handle('info', () => ({ mode, packaged: app.isPackaged }));

  app.on('second-instance', showWindow);
  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', () => {});

  app.whenReady().then(async () => {
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] });

    // In development there is no service, so run the engine here.
    const reachable = await call('/v1/view').then(() => true, () => false);
    if (!reachable && !app.isPackaged) {
      mode = 'embedded';
      const engine = createEngine(path.join(app.getPath('userData'), 'state.json'));
      try {
        await createServer({ engine }).listen();
        setInterval(() => engine.settle(), 20 * 1000);
        engine.settle();
      } catch (error) {
        dialog.showErrorBox('Focus Lock', 'Could not start on port ' + PORT + ': ' + error.message);
      }
    }

    try {
      tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png')));
      tray.on('click', showWindow);
    } catch (error) {
      tray = null;
    }

    createWindow();
    if (startHidden && tray) win.hide();

    setInterval(refresh, 5 * 1000);
    refresh();
  });
}
