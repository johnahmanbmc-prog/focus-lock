// Focus Lock desktop app: one window to manage the blocker, a tray icon, and
// the local server that the Chrome and Brave extension reads settings from.
'use strict';

const path = require('node:path');
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell, dialog } = require('electron');
const rules = require('./core/rules');
const { createStore } = require('./core/store');
const { createServer, PORT } = require('./core/server');

// For testing: keep the settings in another folder.
if (process.env.FOCUSLOCK_DATA_DIR) app.setPath('userData', process.env.FOCUSLOCK_DATA_DIR);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  start();
}

function start() {
  let win = null;
  let tray = null;
  let quitting = false;
  let store;
  let state;
  const startHidden = process.argv.includes('--hidden');

  function now() {
    return Date.now();
  }

  // Apply due changes and save, so the file always matches what is in force.
  function refresh() {
    const before = JSON.stringify(state);
    state = rules.settle(state, now());
    if (JSON.stringify(state) !== before) store.save(state);
    pushView();
    updateTray();
  }

  function pushView() {
    if (win && !win.isDestroyed()) win.webContents.send('state', rules.view(state, now()));
  }

  function statusLine() {
    const v = rules.view(state, now());
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
      { label: 'Quit (blocking continues in the browser)', click: () => { quitting = true; app.quit(); } }
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
    // Closing the window keeps the app in the tray so settings keep syncing.
    win.on('close', event => {
      if (!quitting) {
        event.preventDefault();
        win.hide();
      }
    });
    // Links open in the normal browser, never inside the app.
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\//.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', event => event.preventDefault());
  }

  ipcMain.handle('getState', () => rules.view(state, now()));

  ipcMain.handle('change', (event, change) => {
    try {
      const result = rules.apply(state, change, now());
      state = result.state;
      store.save(state);
      pushView();
      updateTray();
      return { ok: true, outcome: result.outcome, message: result.message };
    } catch (error) {
      return { ok: false, error: error.message };
    }
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

  app.on('second-instance', showWindow);

  app.on('before-quit', () => { quitting = true; });

  // Keep running in the tray when the window is closed.
  app.on('window-all-closed', () => {});

  app.whenReady().then(async () => {
    store = createStore(path.join(app.getPath('userData'), 'state.json'));
    state = store.load();

    if (app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] });
    }

    const server = createServer({
      getPayload: () => rules.extensionPayload(state, now()),
      onSeen: (browser, info) => {
        const first = !state.browsers[browser];
        state.browsers[browser] = { lastSeen: now(), version: info.version };
        // Save the first contact right away; later ones only matter in memory.
        if (first) store.save(state);
        pushView();
      }
    });
    try {
      await server.listen();
    } catch (error) {
      dialog.showErrorBox('Focus Lock',
        'Could not start the connection to the browser extension on port ' + PORT + '. ' +
        'Is Focus Lock already running? (' + error.message + ')');
    }

    try {
      tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png')));
      tray.on('click', showWindow);
      updateTray();
    } catch (error) {
      tray = null;
    }

    createWindow();
    if (startHidden && tray) win.hide();

    // Due changes and the end of strict mode are applied every 20 seconds.
    setInterval(refresh, 20 * 1000);
    refresh();
  });
}
