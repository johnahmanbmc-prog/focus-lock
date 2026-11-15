const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const policy = require('../app/core/policy');
const rules = require('../app/core/rules');

const ps1 = fs.readFileSync(path.join(__dirname, '../app/admin/uninstall.ps1'), 'utf8');
const nsh = fs.readFileSync(path.join(__dirname, '../app/build/installer.nsh'), 'utf8');

function macro(name) {
  const m = nsh.match(new RegExp('!macro ' + name + '\\b([\\s\\S]*?)!macroend'));
  return m ? m[1].replace(/^\s*;.*$/gm, '') : null;
}

test('uninstall: the script runs before the uninstaller deletes the install folder', () => {
  // electron-builder deletes $INSTDIR before customUnInstall, so the script
  // must run from customRemoveFiles, ahead of the RMDir.
  const remove = macro('customRemoveFiles');
  assert.ok(remove, 'customRemoveFiles is defined');
  const run = remove.indexOf('uninstall.ps1');
  assert.ok(run >= 0, 'customRemoveFiles runs uninstall.ps1');
  assert.ok(run < remove.indexOf('RMDir /r $INSTDIR'), 'it runs before the files are removed');
  assert.match(remove, /uninstall\.ps1" -KeepSettings/, 'updates keep the settings');
  const later = macro('customUnInstall');
  assert.ok(!later || !later.includes('uninstall.ps1'), 'not run from customUnInstall, where it is already gone');
});

test('uninstall: removes every policy value Focus Lock writes, in every browser', () => {
  const names = ps1.match(/\$names = ([^\n]+)/)[1].match(/'([^']+)'/g).map(s => s.slice(1, -1));
  assert.deepEqual([...names].sort(), [...policy.STATIC_NAMES].sort());

  // Every value the .reg file sets is one the script removes.
  const state = rules.defaultState();
  state.settings.schedule = [{ days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59' }];
  const reg = policy.toRegFile(policy.desiredPolicies(state, Date.now()));
  let section = null;
  for (const line of reg.split('\r\n')) {
    const head = line.match(/^\[(-?)HKEY_LOCAL_MACHINE\\(.+)\]$/);
    if (head) { section = head[2]; continue; }
    const value = line.match(/^"([^"]+)"=/);
    if (!value || section.endsWith('\\URLBlocklist')) continue;
    assert.ok(names.includes(value[1]), value[1] + ' is removed on uninstall');
  }

  for (const b of policy.BROWSERS) {
    assert.ok(ps1.includes("'HKLM:\\" + b.key + "'"), b.name + ' key is cleaned');
  }
  assert.match(ps1, /Remove-Item -Path \(Join-Path \$key 'URLBlocklist'\) -Recurse/);
});

test('uninstall: leaves other policies in the browser keys alone', () => {
  // The only removal of a whole browser key is guarded by "nothing left in it".
  const whole = [...ps1.matchAll(/Remove-Item -Path \$key\b[^\n]*/g)];
  assert.equal(whole.length, 1);
  const guard = ps1.slice(0, whole[0].index).split('\n').slice(-2).join('\n');
  assert.match(guard, /ValueCount -eq 0 -and \$item\.SubKeyCount -eq 0/);
  assert.doesNotMatch(ps1, /Remove-Item[^\n]*SOFTWARE\\Policies(\\[A-Za-z]+)*'?\s*-Recurse/);
});

test('uninstall: stops and deletes the Focus Lock service', () => {
  const full = ps1.slice(0, ps1.indexOf('if ($KeepSettings) { exit 0 }'));
  assert.match(full, /Get-Service -Name FocusLock/);
  assert.match(full, /& \$svc stop/);
  assert.match(full, /if \(-not \$KeepSettings\) \{[\s\S]*& \$svc uninstall[\s\S]*sc\.exe delete FocusLock/);
  // The WinSW wrapper it uses must ship next to the script.
  const xml = fs.readFileSync(path.join(__dirname, '../app/admin/FocusLockService.xml'), 'utf8');
  assert.match(xml, /<id>FocusLock<\/id>/);
});

test('uninstall: turns off the browser block and deletes the settings folder', () => {
  const after = ps1.slice(ps1.indexOf('if ($KeepSettings) { exit 0 }'));
  assert.match(after, /browser-block\\Disable-BrowserBlock\.ps1/);
  assert.match(after, /policy-id\.txt/);
  assert.ok(fs.existsSync(path.join(__dirname, '../app/admin/browser-block/Disable-BrowserBlock.ps1')));
  // The browser block is turned off before its id file is deleted with the folder.
  const block = after.indexOf('& $block');
  const wipe = after.indexOf('Remove-Item -Recurse -Force $data');
  assert.ok(block > 0 && wipe > block);
  assert.match(ps1, /\$data = Join-Path \$env:ProgramData 'FocusLock'/);
});

test('uninstall: an update keeps the settings and only stops the service', () => {
  const keep = ps1.indexOf('if ($KeepSettings) { exit 0 }');
  assert.ok(keep > 0);
  assert.ok(ps1.indexOf('Remove-Item -Recurse -Force $data') > keep);
  assert.ok(ps1.indexOf('$names =') > keep, 'policies are kept on update');
});
