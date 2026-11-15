#Requires -RunAsAdministrator
<#
  Focus Lock machine setup. The installer runs this as administrator. The
  person with the admin password can also run it again by hand, for example
  to add the extension ID after publishing the extension:

    powershell -ExecutionPolicy Bypass -File install.ps1 -ExtensionId abcdefghijklmnopabcdefghijklmnop

  What it does:
  1. Creates C:\ProgramData\FocusLock for the settings. Administrators and
     SYSTEM have full control; standard users can only read.
  2. Installs and starts the "Focus Lock" Windows service, which owns the
     settings and restarts itself if it stops.
  3. If an extension ID is known, sets Chrome and Brave policies that
     install the extension and stop it being removed or turned off, turn
     off incognito and guest windows (extensions don't run there), and
     turn off Tor windows in Brave.
#>
param([string]$ExtensionId)

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
if (Test-Path $svc) {
  if (Get-Service -Name FocusLock -ErrorAction SilentlyContinue) {
    & $svc stop | Out-Null
    & $svc uninstall | Out-Null
  }
  & $svc install
  & $svc start
} else {
  Write-Warning "FocusLockService.exe is missing, so the service was not installed."
}

# 3. Browser policies.
$idFile = Join-Path $data 'extension-id.txt'
if (-not $ExtensionId -and (Test-Path $idFile)) { $ExtensionId = (Get-Content $idFile -Raw).Trim() }
if (-not $ExtensionId) { $ExtensionId = (Get-Content (Join-Path $here 'extension-id.txt') -Raw).Trim() }

$browsers = @(
  @{ Name = 'Chrome'; Key = 'HKLM:\SOFTWARE\Policies\Google\Chrome' },
  @{ Name = 'Brave';  Key = 'HKLM:\SOFTWARE\Policies\BraveSoftware\Brave' }
)
$update = 'https://clients2.google.com/service/update2/crx'

if ($ExtensionId -notmatch '^[a-p]{32}$') {
  Write-Host 'No Chrome Web Store extension ID yet, so the browser policies were not set.'
  Write-Host 'See docs/HELPER-SETUP.md, then run: install.ps1 -ExtensionId <id>'
  exit 0
}

Set-Content -Path $idFile -Value $ExtensionId
foreach ($b in $browsers) {
  $list = Join-Path $b.Key 'ExtensionInstallForcelist'
  if (-not (Test-Path $list)) { New-Item -Path $list -Force | Out-Null }
  $entry = "$ExtensionId;$update"
  $props = Get-ItemProperty -Path $list
  $existing = $props.PSObject.Properties | Where-Object { $_.Name -match '^\d+$' }
  if (-not ($existing | Where-Object { $_.Value -like "$ExtensionId*" })) {
    $next = 1
    while ($existing | Where-Object { $_.Name -eq "$next" }) { $next++ }
    New-ItemProperty -Path $list -Name "$next" -Value $entry -PropertyType String -Force | Out-Null
  }
  # 1 = incognito windows off. Extensions don't run in incognito or guest windows.
  New-ItemProperty -Path $b.Key -Name 'IncognitoModeAvailability' -Value 1 -PropertyType DWord -Force | Out-Null
  New-ItemProperty -Path $b.Key -Name 'BrowserGuestModeEnabled' -Value 0 -PropertyType DWord -Force | Out-Null
  if ($b.Name -eq 'Brave') {
    New-ItemProperty -Path $b.Key -Name 'TorDisabled' -Value 1 -PropertyType DWord -Force | Out-Null
  }
  Write-Host "$($b.Name): extension $ExtensionId is force-installed."
}
Write-Host 'Restart Chrome and Brave, then check chrome://policy and brave://policy.'
