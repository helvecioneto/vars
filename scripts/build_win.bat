@echo off
echo Building VARS for Windows...

REM Ensure dependencies are installed
call npm list electron-builder >nul 2>&1
if %errorlevel% neq 0 (
    echo Installing dependencies...
    call npm install
)

echo -----------------------------------
echo Starting Windows Build...
echo -----------------------------------

REM Builds for Windows (x64 and ia32 by default based on config or system)
call npx electron-builder --win

echo -----------------------------------
echo Build complete! Check the 'dist' folder.
echo -----------------------------------
pause
