@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"

if "%SystemDrive%"=="" set "SystemDrive=C:"
if "%SystemDrive%"=="%%SystemDrive%%" set "SystemDrive=C:"
if "%SystemRoot%"=="" set "SystemRoot=%SystemDrive%\Windows"
if "%SystemRoot%"=="%%SystemRoot%%" set "SystemRoot=%SystemDrive%\Windows"
if "%windir%"=="" set "windir=%SystemRoot%"
if "%windir%"=="%%windir%%" set "windir=%SystemRoot%"
if "%ComSpec%"=="" set "ComSpec=%SystemRoot%\System32\cmd.exe"
if "%ComSpec%"=="%%ComSpec%%" set "ComSpec=%SystemRoot%\System32\cmd.exe"
if "%ProgramData%"=="" set "ProgramData=%SystemDrive%\ProgramData"
if "%ProgramData%"=="%%SystemDrive%%\ProgramData" set "ProgramData=%SystemDrive%\ProgramData"
if "%APPDATA%"=="" set "APPDATA=%USERPROFILE%\AppData\Roaming"
if "%APPDATA%"=="%%APPDATA%%" set "APPDATA=%USERPROFILE%\AppData\Roaming"
if "%LOCALAPPDATA%"=="" set "LOCALAPPDATA=%USERPROFILE%\AppData\Local"
if "%LOCALAPPDATA%"=="%%LOCALAPPDATA%%" set "LOCALAPPDATA=%USERPROFILE%\AppData\Local"

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Please install Node.js first.
    echo https://nodejs.org/
    pause
    exit /b 1
)

if not exist node_modules (
    echo Installing dependencies...
    npm install
)

echo Starting CC-Web...
node server.js
pause
