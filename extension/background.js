// Service worker: loads the configuration, keeps the declarativeNetRequest
// rules in step with the schedule, and answers the content script.
importScripts('lib/match.js');

const { isBlockingActive, buildDnrRules, defaultSettings, isStrict, applySettingsChange, effectiveConfig, applyAppLists, syncAllowed } = self.FocusMatch;

// The Focus Lock desktop app serves the settings here. See app/core/server.js.
const APP_URL = 'http://127.0.0.1:47821/v1/state';

let cachedConfig = null;

// A policy-managed config (set through Chrome/Brave policy) wins over the
// bundled defaults.
async function loadConfig() {
  try {
    const managed = await chrome.storage.managed.get('config');
    if (managed && managed.config) return JSON.parse(managed.config);
  } catch (e) {
    console.warn('Focus Lock: ignoring unreadable managed config', e);
  }
  const response = await fetch(chrome.runtime.getURL('default-config.json'));
  return response.json();
}

// The last settings and lists the desktop app sent, or null if the app has
// never been seen. Once set, the app manages this extension.
async function getAppState() {
  const { appState } = await chrome.storage.local.get('appState');
  return appState || null;
}

async function getConfig() {
  if (!cachedConfig) {
    const [base, appState] = await Promise.all([loadConfig(), getAppState()]);
    cachedConfig = appState ? applyAppLists(base, appState.lists) : base;
  }
  return cachedConfig;
}

// The user's settings (on/off, blocking hours, strict mode). They come from
// the desktop app when it manages this extension, otherwise from local
// storage, changed only through applySettingsChange.
async function getSettings() {
  const appState = await getAppState();
  if (appState) return { ...defaultSettings(), ...appState.settings };
  const { settings } = await chrome.storage.local.get('settings');
  return { ...defaultSettings(), ...(settings || {}) };
}

async function browserName() {
  try {
    if (navigator.brave && await navigator.brave.isBrave()) return 'Brave';
  } catch (e) { /* not Brave */ }
  const brands = (navigator.userAgentData && navigator.userAgentData.brands) || [];
  return brands.some(b => /brave/i.test(b.brand)) ? 'Brave' : 'Chrome';
}

// Ask the desktop app for the current settings. If it isn't running, keep
// what we have.
async function syncFromApp() {
  let incoming;
  try {
    const query = '?browser=' + encodeURIComponent(await browserName()) +
      '&version=' + encodeURIComponent(chrome.runtime.getManifest().version);
    const response = await fetch(APP_URL + query, { cache: 'no-store' });
    if (!response.ok) return;
    incoming = await response.json();
  } catch (e) {
    return;
  }
  const cached = await getAppState();
  const verdict = syncAllowed(cached, incoming, Date.now());
  if (!verdict.ok) {
    console.warn('Focus Lock: ignored settings from the app because it ' + verdict.reason);
    await chrome.storage.local.set({ lastSync: { at: Date.now(), ok: false, reason: verdict.reason } });
    return;
  }
  const next = { settings: incoming.settings, lists: incoming.lists };
  const changed = !cached || JSON.stringify({ settings: cached.settings, lists: cached.lists }) !== JSON.stringify(next);
  await chrome.storage.local.set({ appState: next, lastSync: { at: Date.now(), ok: true } });
  if (changed) {
    cachedConfig = null;
    await applyRules();
  }
}

function inHours(settings) {
  return settings.enabled && isBlockingActive(settings.schedule, new Date());
}

// The lists that apply right now, or null when nothing is blocked.
async function currentConfig() {
  const [config, settings] = await Promise.all([getConfig(), getSettings()]);
  return effectiveConfig(config, settings.enabled, inHours(settings));
}

// Rule updates run one at a time. Two overlapping updates would both try to
// add rule 1 and the second would fail.
let ruleQueue = Promise.resolve();
function applyRules() {
  const run = () => updateRules().catch(error => console.error('Focus Lock: could not update rules', error));
  ruleQueue = ruleQueue.then(run, run);
  return ruleQueue;
}

async function updateRules() {
  const config = await currentConfig();
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map(rule => rule.id),
    addRules: config ? buildDnrRules(config, '/blocked.html') : []
  });
}

function tick() {
  return syncFromApp().finally(applyRules);
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('tick', { periodInMinutes: 1 });
  tick();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('tick', { periodInMinutes: 1 });
  tick();
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'tick') tick();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'managed') {
    cachedConfig = null;
    applyRules();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'getState') {
    currentConfig().then(config => sendResponse({ active: Boolean(config), config }));
    return true;
  }
  if (message.type === 'getSettings') {
    syncFromApp()
      .then(() => Promise.all([getSettings(), getAppState(), chrome.storage.local.get('lastSync')]))
      .then(([settings, appState, { lastSync }]) => {
        sendResponse({
          settings,
          strict: isStrict(settings, Date.now()),
          active: inHours(settings),
          managed: Boolean(appState),
          lastSync: lastSync || null
        });
      });
    return true;
  }
  if (message.type === 'changeSettings') {
    getAppState()
      .then(appState => {
        if (appState) throw new Error('These settings are managed by the Focus Lock desktop app. Change them there.');
        return getSettings();
      })
      .then(current => applySettingsChange(current, message.change || {}, Date.now()))
      .then(async settings => {
        await chrome.storage.local.set({ settings });
        await applyRules();
        sendResponse({ ok: true, settings, strict: isStrict(settings, Date.now()) });
      })
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === 'block' && sender.tab) {
    const page = chrome.runtime.getURL('blocked.html?reason=' + encodeURIComponent(message.reason));
    chrome.tabs.update(sender.tab.id, { url: page });
  }
  return false;
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

// Also sync and apply on every worker start, so the rules never wait for an event.
chrome.alarms.create('tick', { periodInMinutes: 1 });
tick();
