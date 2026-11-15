const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const xml = fs.readFileSync(path.join(__dirname, '../app/admin/browser-block/FocusLock-BrowserDeny.xml'), 'utf8');
const body = xml.replace(/<!--[\s\S]*?-->/g, '');

test('browser block: every deny rule is used, and only in user mode', () => {
  const denies = [...body.matchAll(/<Deny ID="([^"]+)"[^>]*FileName="([^"]+)"/g)];
  const refs = [...body.matchAll(/<FileRuleRef RuleID="([^"]+)"/g)].map(m => m[1]);
  assert.ok(denies.length >= 10);
  assert.deepEqual(denies.map(m => m[1]).sort(), [...refs].sort());
  assert.equal(new Set(refs).size, refs.length);
  const kernel = body.match(/<SigningScenario Value="131"[\s\S]*?<\/SigningScenario>/)[0];
  assert.doesNotMatch(kernel, /FileRuleRef/);
  assert.doesNotMatch(body, /<Allow /, 'this file holds deny rules only');
});

test('browser block: Chrome, Brave and Edge are not blocked', () => {
  const names = [...body.matchAll(/FileName="([^"]+)"/g)].map(m => m[1].toLowerCase());
  for (const kept of ['chrome.exe', 'brave.exe', 'msedge.exe', 'msedgewebview2.exe']) assert.ok(!names.includes(kept), kept);
  for (const blocked of ['firefox.exe', 'opera.exe', 'vivaldi.exe', 'librewolf.exe', 'waterfox.exe', 'floorp.exe']) assert.ok(names.includes(blocked), blocked);
});
