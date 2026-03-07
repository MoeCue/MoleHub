@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul

cd /d %~dp0
cd ..
set "SETTING_FILE=..\setting.json"

title Setup (FULL MODE - FORCE REINSTALL)

set "PM=npm"
set "PNPM_CMD=pnpm"
call :ensure_pnpm

echo ==========================================
echo      [1/5] Read config
echo ==========================================

if not exist "!SETTING_FILE!" (
    echo [ERROR] !SETTING_FILE! not found.
    pause
    exit /b 1
)

set "PROJ_DIR=Apps"
set "SCRIPT_DIR=AppScript"

for /f "delims=" %%a in ('powershell -NoProfile -Command "$json=Get-Content !SETTING_FILE! -Raw | ConvertFrom-Json; if($json.paths.projectDir){Write-Output $json.paths.projectDir}else{Write-Output 'Apps'}"') do set "PROJ_DIR=%%a"
for /f "delims=" %%b in ('powershell -NoProfile -Command "$json=Get-Content !SETTING_FILE! -Raw | ConvertFrom-Json; if($json.paths.scriptDir){Write-Output $json.paths.scriptDir}else{Write-Output 'AppScript'}"') do set "SCRIPT_DIR=%%b"

if not exist "!PROJ_DIR!" mkdir "!PROJ_DIR!"

set "APP_NAME="
call :parse_app_arg %*
if "!APP_NAME!"=="" (
    for /f "delims=" %%i in ('powershell -NoProfile -Command "$json=Get-Content !SETTING_FILE! -Raw | ConvertFrom-Json; Write-Output $json.currentApp"') do set "APP_NAME=%%i"
)

if "!APP_NAME!"=="" (
    echo [ERROR] appName is empty. use --app app-name
    pause
    exit /b 1
)

set "TARGET=!PROJ_DIR!\!APP_NAME!"

for /f "delims=" %%a in ('powershell -NoProfile -Command "$json=Get-Content !SETTING_FILE! -Raw | ConvertFrom-Json; $cfg=$json.apps.'!APP_NAME!'; if($cfg){Write-Output $cfg.tailwindVersion}else{Write-Output 'NULL'}"') do set "TW_VER=%%a"
for /f "delims=" %%b in ('powershell -NoProfile -Command "$json=Get-Content !SETTING_FILE! -Raw | ConvertFrom-Json; $cfg=$json.apps.'!APP_NAME!'; Write-Output $cfg.dependencies"') do set "EXTRA_DEPS=%%b"

if "!TW_VER!"=="NULL" (
    echo [ERROR] app config not found: !APP_NAME!
    pause
    exit /b 1
)
if "!TW_VER!"=="" set "TW_VER=latest"

echo.
echo [Target Project] : !TARGET!
echo [TW Version]     : !TW_VER!
echo [Mode]           : FORCE REINSTALL
echo.

if not exist "!TARGET!" (
    echo [INFO] Creating Vite app inside !PROJ_DIR!...
    pushd "!PROJ_DIR!"
    if "!PM!"=="pnpm" (
        call "!PNPM_CMD!" create vite "!APP_NAME!" --template react --no-interactive --no-rolldown
    ) else (
        call npm create vite@latest "!APP_NAME!" -- --template react --no-interactive --no-rolldown
    )
    popd
)
if not exist "!TARGET!\\package.json" (
    echo [INFO] package.json missing, recreating Vite app...
    if exist "!TARGET!" rmdir /s /q "!TARGET!"
    pushd "!PROJ_DIR!"
    if "!PM!"=="pnpm" (
        call "!PNPM_CMD!" create vite "!APP_NAME!" --template react --no-interactive --no-rolldown
    ) else (
        call npm create vite@latest "!APP_NAME!" -- --template react --no-interactive --no-rolldown
    )
    popd
)

echo [BASELINE] Sync dependency baseline...
call node tools\sync-deps.js --app "!APP_NAME!"
if %errorlevel% neq 0 (
    echo [ERROR] Dependency baseline sync failed.
    pause
    exit /b 1
)

cd "!TARGET!"

echo ==========================================
echo      [2/5] Force reinstall dependencies
echo ==========================================

if "!PM!"=="pnpm" (
    call "!PNPM_CMD!" install
) else (
    call npm install
)

echo [FIX] Tailwind (!TW_VER!)...
if "!PM!"=="pnpm" (
    call "!PNPM_CMD!" remove tailwindcss @tailwindcss/postcss
    call "!PNPM_CMD!" add -D tailwindcss@!TW_VER! postcss autoprefixer
) else (
    call npm uninstall tailwindcss @tailwindcss/postcss
    call npm install -D tailwindcss@!TW_VER! postcss autoprefixer
)

if not "!EXTRA_DEPS!"=="" (
    echo [DEPS] Extra: !EXTRA_DEPS!
    if "!PM!"=="pnpm" (
        call "!PNPM_CMD!" add !EXTRA_DEPS!
    ) else (
        call npm install !EXTRA_DEPS!
    )
)

echo ==========================================
echo      [3/5] Rewrite config files
echo ==========================================

(
echo /** @type {import('tailwindcss'^).Config} */
echo export default {
echo   content: [
echo     "./index.html",
echo     "./src/**/*.{js,ts,jsx,tsx}",
echo   ],
echo   theme: {
echo     extend: {},
echo   },
echo   plugins: [],
echo }
) > tailwind.config.js

(
echo export default {
echo   plugins: {
echo     tailwindcss: {},
echo     autoprefixer: {},
echo   },
echo }
) > postcss.config.js

(
echo @tailwind base;
echo @tailwind components;
echo @tailwind utilities;
) > src\index.css

echo.
echo ==========================================
echo      [5/5] SETUP COMPLETE
echo ==========================================
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
