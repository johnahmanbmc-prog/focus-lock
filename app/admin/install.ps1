#Requires -RunAsAdministrator
<#
  Focus Lock machine setup. The installer runs this as administrator. It is
  safe to run again.

  1. Creates C:\ProgramData\FocusLock for the settings. Administrators and
     SYSTEM have full control; standard users can only read.
  2. Installs and starts the "Focus Lock" Windows service. The service owns
     the settings and writes the Chrome, Brave and Edge policies (block
     list, SafeSearch, no incognito and so on) under
     HKLM\SOFTWARE\Policies, which only administrators can change.
#>
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$data = Join-Path $env:ProgramData 'FocusLock'

# 1. Settings folder: admin-only changes.
New-Item -ItemType Directory -Force -Path $data, (Join-Path $data 'logs') | Out-Null
# S-1-5-18 = SYSTEM, S-1-5-32-544 = Administrators, S-1-5-32-545 = Users.
& icacls.exe $data /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-32-545:(OI)(CI)RX' | Out-Null
if ($LASTEXITCODE -ne 0) { throw "icacls failed on $data" }
& icacls.exe $data /setowner '*S-1-5-32-544' /T /C | Out-Null

# 2. The service.
$svc = Join-Path $here 'FocusLockService.exe'
if (-not (Test-Path $svc)) { throw 'FocusLockService.exe is missing, so the service could not be installed.' }
if (Get-Service -Name FocusLock -ErrorAction SilentlyContinue) {
  & $svc stop | Out-Null
  & $svc uninstall | Out-Null
}
& $svc install
& $svc start
Write-Host 'Focus Lock service installed. Restart Chrome, Brave and Edge, then check chrome://policy, brave://policy and edge://policy.'
