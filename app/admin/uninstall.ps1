#Requires -RunAsAdministrator
<#
  Removes what install.ps1 and the service set up: the service, the browser
  policies, the browser block and the settings folder. The uninstaller runs this. On an update it runs with
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

# Remove the browser policies the service wrote.
foreach ($key in 'HKLM:\SOFTWARE\Policies\Google\Chrome', 'HKLM:\SOFTWARE\Policies\BraveSoftware\Brave', 'HKLM:\SOFTWARE\Policies\Microsoft\Edge') {
  if (-not (Test-Path $key)) { continue }
  Remove-Item -Path (Join-Path $key 'URLBlocklist') -Recurse -Force -ErrorAction SilentlyContinue
  foreach ($name in 'BrowserGuestModeEnabled', 'DnsOverHttpsMode', 'ForceGoogleSafeSearch', 'ForceYouTubeRestrict', 'IncognitoModeAvailability', 'TorDisabled', 'InPrivateModeAvailability', 'ForceBingSafeSearch') {
    Remove-ItemProperty -Path $key -Name $name -ErrorAction SilentlyContinue
  }
}
# Turn off the browser block too, if it was set up.
$block = Join-Path $here 'browser-block\Disable-BrowserBlock.ps1'
if (Test-Path (Join-Path $data 'browser-block\policy-id.txt')) { & $block }

Remove-Item -Recurse -Force $data -ErrorAction SilentlyContinue
