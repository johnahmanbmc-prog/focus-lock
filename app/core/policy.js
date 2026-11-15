// Turns the Focus Lock settings into Chrome, Brave and Edge policies. The
// browsers enforce these themselves. The service writes them to HKLM
// (admin-only) and rewrites the block list whenever the blocking hours
// start or end or a setting changes.
'use strict';

const rules = require('./rules');
const BASE = require('./blocklists.json');

const BROWSERS = [
  { name: 'Chrome', key: 'SOFTWARE\\Policies\\Google\\Chrome' },
  { name: 'Brave', key: 'SOFTWARE\\Policies\\BraveSoftware\\Brave' },
  { name: 'Edge', key: 'SOFTWARE\\Policies\\Microsoft\\Edge' }
];

// Always set, whatever the hours or settings: these close the usual ways
// around a block list.
const STATIC = {
  common: {
    BrowserGuestModeEnabled: 0, // guest windows
    DnsOverHttpsMode: 'off', // secure DNS could reach blocked sites through other resolvers
    ForceGoogleSafeSearch: 1,
    ForceYouTubeRestrict: 2 // YouTube Restricted Mode (strict) whenever YouTube is open
  },
  Chrome: { IncognitoModeAvailability: 1 },
  Brave: { IncognitoModeAvailability: 1, TorDisabled: 1 },
  Edge: { InPrivateModeAvailability: 1, ForceBingSafeSearch: 2 }
};

// Every value name Focus Lock sets, so uninstall can remove exactly these.
const STATIC_NAMES = [...new Set(Object.values(STATIC).flatMap(o => Object.keys(o)))];

// "https://www.Example.com/x" -> "example.com/x", the URLBlocklist format.
// A bare domain also blocks its subdomains.
// Only the host is lowercased: paths are case-sensitive in URLBlocklist, so
// both reddit.com/r/Piracy and reddit.com/r/piracy are listed.
function entry(value) {
  const bare = String(value || '').trim().replace(/^[a-z]+:\/\//i, '').replace(/^www\./i, '').replace(/^\*?\./, '');
  const slash = bare.indexOf('/');
  return slash < 0 ? bare.toLowerCase() : bare.slice(0, slash).toLowerCase() + bare.slice(slash);
}

// The URLBlocklist for this moment: the always-on lists and the user's
// "all the time" sites, plus the switched-on lists and the rest of the
// user's sites during the blocking hours. Nothing when the blocker is off.
function blocklist(state, now, base = BASE) {
  const { settings, lists } = rules.settle(state, now);
  if (!settings.enabled) return [];
  const inHours = rules.isBlockingActive(settings.schedule, new Date(now));
  const out = new Set();
  for (const sites of Object.values(base.always)) sites.forEach(s => out.add(entry(s)));
  if (inHours) {
    for (const [id, sites] of Object.entries(base.categories)) {
      if (lists.categories[id] !== false) sites.forEach(s => out.add(entry(s)));
    }
  }
  for (const s of lists.sites) if (s.always || inHours) out.add(entry(s.site));
  out.delete('');
  return [...out].sort();
}

// The policies to set for each browser.
function desiredPolicies(state, now, base = BASE) {
  const list = blocklist(state, now, base);
  return BROWSERS.map(b => ({
    ...b,
    values: { ...STATIC.common, ...(STATIC[b.name] || {}) },
    URLBlocklist: list
  }));
}

// A .reg file (REGEDIT5, saved as UTF-16) that replaces each browser's
// URLBlocklist and sets the fixed values.
function toRegFile(policies) {
  const esc = s => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const lines = ['Windows Registry Editor Version 5.00', ''];
  for (const p of policies) {
    const root = 'HKEY_LOCAL_MACHINE\\' + p.key;
    lines.push('[' + root + ']');
    for (const [name, value] of Object.entries(p.values)) {
      lines.push(typeof value === 'number'
        ? `"${name}"=dword:${value.toString(16).padStart(8, '0')}`
        : `"${name}"="${esc(value)}"`);
    }
    lines.push('');
    lines.push('[-' + root + '\\URLBlocklist]');
    lines.push('');
    lines.push('[' + root + '\\URLBlocklist]');
    p.URLBlocklist.forEach((u, i) => lines.push(`"${i + 1}"="${esc(u)}"`));
    lines.push('');
  }
  return lines.join('\r\n') + '\r\n';
}

module.exports = { BROWSERS, STATIC, STATIC_NAMES, blocklist, desiredPolicies, toRegFile };
