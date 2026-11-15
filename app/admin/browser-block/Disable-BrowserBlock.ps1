#Requires -RunAsAdministrator
<#
  Turns off the Focus Lock browser block made by Enable-BrowserBlock.ps1.
#>
$ErrorActionPreference = 'Stop'
$work = Join-Path $env:ProgramData 'FocusLock\browser-block'
$idFile = Join-Path $work 'policy-id.txt'
if (-not (Test-Path $idFile)) { Write-Host 'The browser block is not on.'; exit 0 }
$policyId = (Get-Content $idFile -Raw).Trim()
& CiTool.exe --remove-policy $policyId -json | Out-Null
if ($LASTEXITCODE -ne 0) { throw "CiTool could not remove policy $policyId (exit code $LASTEXITCODE)." }
Remove-Item -Recurse -Force $work
Write-Host "Browser block removed (policy $policyId). Restart the PC if a browser still won't open."
