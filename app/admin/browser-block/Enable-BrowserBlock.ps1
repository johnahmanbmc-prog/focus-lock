#Requires -RunAsAdministrator
<#
  Blocks browsers other than Chrome and Brave (and Edge, which is left alone)
  with Windows App Control for Business, which is built into Windows 11 Pro.

  It is a blocklist: Windows' own "allow everything" example policy is
  merged with the deny rules in FocusLock-BrowserDeny.xml, so all other
  programs, including ones installed later for work, keep running as normal.

  Start in audit mode (the default). Nothing is blocked; Windows only logs
  what would have been blocked. Check the log, then run again with -Enforce.

    powershell -ExecutionPolicy Bypass -File Enable-BrowserBlock.ps1            # audit only
    powershell -ExecutionPolicy Bypass -File Enable-BrowserBlock.ps1 -Enforce   # block

  The log is in Event Viewer > Applications and Services Logs > Microsoft >
  Windows > CodeIntegrity > Operational (event 3076 = would block in audit
  mode, 3077 = blocked).

  Needs Windows 11 22H2 or later (for CiTool). Only an administrator can
  turn it off again, with Disable-BrowserBlock.ps1.
#>
param([switch]$Enforce)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$data = Join-Path $env:ProgramData 'FocusLock'
$work = Join-Path $data 'browser-block'
New-Item -ItemType Directory -Force -Path $work | Out-Null

if (-not (Get-Command CiTool.exe -ErrorAction SilentlyContinue)) {
  throw 'CiTool.exe was not found. This needs Windows 11 version 22H2 or later.'
}
Import-Module ConfigCI

$allowAll = Join-Path $env:windir 'schemas\CodeIntegrity\ExamplePolicies\AllowAll.xml'
if (-not (Test-Path $allowAll)) { throw "Windows' AllowAll example policy was not found at $allowAll" }

$merged = Join-Path $work 'FocusLock-BrowserBlock.xml'
Merge-CIPolicy -PolicyPaths $allowAll, (Join-Path $here 'FocusLock-BrowserDeny.xml') -OutputFilePath $merged | Out-Null

# Keep the same policy ID on every run, so running again replaces the policy.
$idFile = Join-Path $work 'policy-id.txt'
if (Test-Path $idFile) {
  $policyId = (Get-Content $idFile -Raw).Trim()
  Set-CIPolicyIdInfo -FilePath $merged -PolicyName 'Focus Lock browser block' -PolicyId $policyId | Out-Null
} else {
  Set-CIPolicyIdInfo -FilePath $merged -PolicyName 'Focus Lock browser block' -ResetPolicyID | Out-Null
  $policyId = ([xml](Get-Content $merged -Raw)).SiPolicy.PolicyID
  if ($policyId -notmatch '^\{[0-9A-Fa-f-]{36}\}$') { throw "Could not read the new policy ID from $merged" }
  Set-Content -Path $idFile -Value $policyId
}
Set-CIPolicyVersion -FilePath $merged -Version ('10.0.' + [int]((Get-Date) - (Get-Date '2026-01-01')).TotalDays + '.' + (Get-Date -Format 'HHmm'))

# 0 = user-mode rules on; 6 = unsigned policy (an admin can remove it);
# 16 = apply without a reboot; 3 = audit mode.
Set-RuleOption -FilePath $merged -Option 0
Set-RuleOption -FilePath $merged -Option 6
Set-RuleOption -FilePath $merged -Option 16
if ($Enforce) {
  Set-RuleOption -FilePath $merged -Option 3 -Delete
} else {
  Set-RuleOption -FilePath $merged -Option 3
}

$binary = Join-Path $work ($policyId + '.cip')
ConvertFrom-CIPolicy -XmlFilePath $merged -BinaryFilePath $binary | Out-Null
& CiTool.exe --update-policy $binary -json | Out-Null
if ($LASTEXITCODE -ne 0) { throw "CiTool could not apply the policy (exit code $LASTEXITCODE)." }

if ($Enforce) {
  Write-Host "Browser block is ON. Policy $policyId. Other browsers are now blocked."
} else {
  Write-Host "Browser block is in AUDIT mode. Policy $policyId. Nothing is blocked yet."
  Write-Host 'Try opening Firefox or another listed browser, check the CodeIntegrity log for event 3076,'
  Write-Host 'make sure no work program shows up there, then run again with -Enforce.'
}
