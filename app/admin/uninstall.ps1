#Requires -RunAsAdministrator
<#
  Removes what install.ps1 set up: the service, the browser policies and the
  settings folder. The uninstaller runs this. On an update it runs with
  -KeepSettings, which only stops the service.
#>
param([switch]$KeepSettings)

$ErrorActionPreference = 'Continue'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$data = Join-Path $env:ProgramData 'FocusLock'
$svc = Join-Path $here 'FocusLockService.exe'

if (Get-Service -Name FocusLock -ErrorAction SilentlyContinue) {
  if (Test-Path $svc) { & $svc stop | Out-Null } else { Stop-Service FocusLock -Force }
  if (-not $KeepSettings) {
    if (Test-Path $svc) { & $svc uninstall | Out-Null } else { & sc.exe delete FocusLock | Out-Null }
  }
}
if ($KeepSettings) { exit 0 }

$idFile = Join-Path $data 'extension-id.txt'
$id = if (Test-Path $idFile) { (Get-Content $idFile -Raw).Trim() } else { '' }
foreach ($key in 'HKLM:\SOFTWARE\Policies\Google\Chrome', 'HKLM:\SOFTWARE\Policies\BraveSoftware\Brave') {
  if (-not (Test-Path $key)) { continue }
  $list = Join-Path $key 'ExtensionInstallForcelist'
  if ($id -and (Test-Path $list)) {
    $props = Get-ItemProperty -Path $list
    $props.PSObject.Properties | Where-Object { $_.Name -match '^\d+$' -and $_.Value -like "$id*" } |
      ForEach-Object { Remove-ItemProperty -Path $list -Name $_.Name }
  }
  foreach ($name in 'IncognitoModeAvailability', 'BrowserGuestModeEnabled', 'TorDisabled') {
    Remove-ItemProperty -Path $key -Name $name -ErrorAction SilentlyContinue
  }
}
# Turn off the browser block too, if it was set up.
$block = Join-Path $here 'browser-block\Disable-BrowserBlock.ps1'
if (Test-Path (Join-Path $data 'browser-block\policy-id.txt')) { & $block }

Remove-Item -Recurse -Force $data -ErrorAction SilentlyContinue
