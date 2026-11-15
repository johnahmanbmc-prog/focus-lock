; Extra steps for the Focus Lock installer (electron-builder NSIS).
; The installer is per-machine, so it always runs as administrator.

; Before files are copied: stop the service so its files aren't in use.
!macro customCheckAppRunning
  nsExec::ExecToLog 'sc.exe stop FocusLock'
  Sleep 2000
  nsExec::ExecToLog 'taskkill.exe /F /IM "Focus Lock.exe"'
!macroend

!macro customInstall
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\admin\install.ps1"'
!macroend

!macro customUnInstall
  ${if} ${isUpdated}
    nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\admin\uninstall.ps1" -KeepSettings'
  ${else}
    nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\admin\uninstall.ps1"'
  ${endif}
!macroend
