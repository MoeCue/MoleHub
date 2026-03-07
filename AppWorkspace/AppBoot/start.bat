@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul

cd /d %~dp0
cd ..
set "SETTING_FILE=..\setting.json"

title Launcher

set "PM=npm"
set "PNPM_CMD=pnpm"
call :ensure_pnpm

echo ==========================================
echo      [1/3] Init launcher
echo ==========================================

if not exist "!SETTING_FILE!" (
    echo [ERROR] !SETTING_FILE! not found.
    pause
    exit /b 1
)

set "PROJ_DIR=Apps"

set "APP_NAME="
call :parse_app_arg %*

powershell -NoProfile -Command "try { $j=Get-Content !SETTING_FILE! -Raw | ConvertFrom-Json; Write-Output $j.paths.projectDir } catch { }" > temp_path.txt
set /p VAL=<temp_path.txt
if not "!VAL!"=="" set "PROJ_DIR=!VAL!"

if exist temp_path.txt del temp_path.txt

if "!APP_NAME!"=="" (
    for /f "delims=" %%i in ('powershell -NoProfile -Command "$json=Get-Content !SETTING_FILE! -Raw | ConvertFrom-Json; Write-Output $json.currentApp"') do set "APP_NAME=%%i"
)

if "!APP_NAME!"=="" (
    echo [ERROR] appName is empty. use --app app-name
    pause
    exit /b 1
)

set "TARGET=!PROJ_DIR!\!APP_NAME!"

set "APP_PORT=5173"

powershell -NoProfile -Command "$j=Get-Content !SETTING_FILE! -Raw | ConvertFrom-Json; $c=$j.apps.'!APP_NAME!'; if($c.port){Write-Output $c.port}else{Write-Output 5173}" > temp_conf.txt
set /p APP_PORT=<temp_conf.txt

if exist temp_conf.txt del temp_conf.txt

echo.
echo [App]    : !APP_NAME!
echo [Path]   : !TARGET!
echo [Entry]  : AppScriptSrc\!APP_NAME!\main.jsx
echo.

if not exist "!TARGET!" (
    echo [ERROR] Project folder not found: !TARGET!
    pause
    exit /b 1
)
if not exist "!TARGET!\\package.json" (
    echo [ERROR] package.json not found in !TARGET!
    echo [HINT] Please run Install/Repair first.
    pause
    exit /b 1
)

echo [Build] Building directly into Apps\!APP_NAME!\src\App.jsx ...
call node tools\build-appscript.js --app "!APP_NAME!" --inject
if %errorlevel% neq 0 (
    echo [ERROR] Build failed. Startup aborted.
    pause
    exit /b 1
)

echo.
echo ==========================================
echo      [3/3] Starting dev server
echo ==========================================
echo URL: http://localhost:!APP_PORT!
echo.

if "!PM!"=="pnpm" (
    call "!PNPM_CMD!" --filter "!APP_NAME!" run dev --port !APP_PORT!
    if %errorlevel% neq 0 (
        echo [WARN] pnpm filter run failed, fallback to local npm run dev...
        cd "!TARGET!"
        call npm run dev -- --port !APP_PORT!
    )
) else (
    cd "!TARGET!"
    call npm run dev -- --port !APP_PORT!
)

pause
exit /b 0

:parse_app_arg
if "%~1"=="" goto :eof
if /I "%~1"=="--app" (
    if not "%~2"=="" (
        set "APP_NAME=%~2"
        shift
    )
) else (
    if /I "%~1:~0,6%"=="--app=" set "APP_NAME=%~1:~6%"
)
shift
goto :parse_app_arg

:ensure_pnpm
where pnpm >nul 2>nul
if %errorlevel% equ 0 (
    set "PM=pnpm"
    set "PNPM_CMD=pnpm"
    goto :eof
)

echo [INFO] pnpm not found, trying auto-install...
pushd "%USERPROFILE%"
call npm i -g pnpm
popd

where pnpm >nul 2>nul
if %errorlevel% equ 0 (
    set "PM=pnpm"
    set "PNPM_CMD=pnpm"
    echo [OK] pnpm installed.
    goto :eof
)

if exist "%APPDATA%\npm\pnpm.cmd" (
    set "PM=pnpm"
    set "PNPM_CMD=%APPDATA%\npm\pnpm.cmd"
    echo [OK] using pnpm cmd from APPDATA.
) else (
    set "PM=npm"
    echo [WARN] pnpm install failed, fallback to npm.
)
goto :eof
