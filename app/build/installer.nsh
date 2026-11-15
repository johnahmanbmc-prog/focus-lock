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

; The uninstaller deletes $INSTDIR before it reaches customUnInstall, so
; uninstall.ps1 has to run here, while it still exists. This replaces
; electron-builder's file removal: it runs the script first, then removes
; the files the same way electron-builder does.
!macro customRemoveFiles
  ${if} ${isUpdated}
    nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\admin\uninstall.ps1" -KeepSettings'
  ${else}
    nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\admin\uninstall.ps1"'
  ${endif}

  ; electron-builder's default removal (templates/nsis/uninstaller.nsh).
  ${if} ${isUpdated}
    CreateDirectory "$PLUGINSDIR\old-install"

    Push ""
    Call un.atomicRMDir
    Pop $R0

    ${if} $R0 != 0
      DetailPrint "File is busy, aborting: $R0"

      Push ""
      Call un.restoreFiles
      Pop $R0

      Abort `Can't rename "$INSTDIR" to "$PLUGINSDIR\old-install".`
    ${endif}
  ${endif}

  RMDir /r $INSTDIR
!macroend
