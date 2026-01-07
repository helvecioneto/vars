; Custom NSIS script for VARS Windows installer
; This ensures the correct icon is used for shortcuts

!macro customInstall
  ; Set the correct icon for the desktop shortcut
  SetShellVarContext all
  CreateShortCut "$DESKTOP\VARS.lnk" "$INSTDIR\VARS.exe" "" "$INSTDIR\VARS.exe" 0
  
  ; Set the correct icon for the start menu shortcut
  CreateDirectory "$SMPROGRAMS\VARS"
  CreateShortCut "$SMPROGRAMS\VARS\VARS.lnk" "$INSTDIR\VARS.exe" "" "$INSTDIR\VARS.exe" 0
  CreateShortCut "$SMPROGRAMS\VARS\Uninstall VARS.lnk" "$INSTDIR\Uninstall VARS.exe"
  
  SetShellVarContext current
!macroend

!macro customUnInstall
  ; Remove shortcuts on uninstall
  SetShellVarContext all
  Delete "$DESKTOP\VARS.lnk"
  RMDir /r "$SMPROGRAMS\VARS"
  SetShellVarContext current
!macroend
