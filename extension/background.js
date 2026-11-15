// Service worker: loads the configuration, keeps the declarativeNetRequest
// rules in step with the schedule, and answers the content script.
importScripts('lib/match.js');

const { isBlockingActive, buildDnrRules, defaultSettings, isStrict, applySettingsChange, effectiveConfig } = self.FocusMatch;

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

async function getConfig() {
  if (!cachedConfig) cachedConfig = await loadConfig();
  return cachedConfig;
}

// The user's settings (on/off, blocking hours, strict mode) live in local
// storage and are only changed through applySettingsChange.
async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...defaultSettings(), ...(settings || {}) };
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

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('tick', { periodInMinutes: 1 });
  applyRules();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('tick', { periodInMinutes: 1 });
  applyRules();
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'tick') applyRules();
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
    getSettings().then(settings => {
      sendResponse({ settings, strict: isStrict(settings, Date.now()), active: inHours(settings) });
    });
    return true;
  }
  if (message.type === 'changeSettings') {
    getSettings()
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

// Also apply on every worker start, so the rules never wait for an event.
chrome.alarms.create('tick', { periodInMinutes: 1 });
applyRules();
