// Service worker: loads the configuration, keeps the declarativeNetRequest
// rules in step with the schedule, and answers the content script.
importScripts('lib/match.js');

const { isBlockingActive, buildDnrRules } = self.FocusMatch;

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

async function applyRules() {
  const config = await getConfig();
  const active = isBlockingActive(config.schedule, new Date());
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map(rule => rule.id),
    addRules: active ? buildDnrRules(config, '/blocked.html') : []
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
    getConfig().then(config => {
      sendResponse({ active: isBlockingActive(config.schedule, new Date()), config });
    });
    return true;
  }
  if (message.type === 'block' && sender.tab) {
    const page = chrome.runtime.getURL('blocked.html?reason=' + encodeURIComponent(message.reason));
    chrome.tabs.update(sender.tab.id, { url: page });
  }
  return false;
});
