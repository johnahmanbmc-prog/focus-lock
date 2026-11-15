// Writes browser policies to the Windows registry with reg.exe. Only the
// service (running as SYSTEM) calls this; HKLM\SOFTWARE\Policies is
// admin-only, so a standard user can't change what it writes.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const policy = require('./policy');

function createPolicyWriter({ dir, log = console.log } = {}) {
  let lastApplied = null;
  let status = { ok: null, appliedAt: null, blocked: 0, error: null };

  function run(file, args) {
    return new Promise((resolve, reject) => {
      execFile(file, args, { windowsHide: true }, (error, stdout, stderr) => {
        if (error) reject(new Error((stderr || error.message).toString().trim()));
        else resolve(stdout);
      });
    });
  }

  // Applies the policies for this moment if they differ from the last ones
  // written. Called on every tick and after every change.
  async function apply(state, now) {
    const desired = policy.desiredPolicies(state, now);
    const text = policy.toRegFile(desired);
    if (text === lastApplied) return status;
    const file = path.join(dir || os.tmpdir(), 'browser-policies.reg');
    try {
      fs.writeFileSync(file, '﻿' + text, 'utf16le');
      await run('reg.exe', ['import', file]);
      lastApplied = text;
      status = { ok: true, appliedAt: now, blocked: desired[0].URLBlocklist.length, error: null };
      log(new Date(now).toISOString() + ' browser policies updated: ' + status.blocked + ' blocked entries');
    } catch (error) {
      status = { ok: false, appliedAt: status.appliedAt, blocked: status.blocked, error: error.message };
      log('could not write browser policies: ' + error.message);
    }
    return status;
  }

  return { apply, status: () => status };
}

module.exports = { createPolicyWriter };
