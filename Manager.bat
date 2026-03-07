@echo off
setlocal enabledelayedexpansion
title App Manager Launcher

set "ROOT_DIR=%~dp0"
set "WORKSPACE_DIR=%ROOT_DIR%AppWorkspace"
set "MANAGER_DIR=%WORKSPACE_DIR%\AppManager"

if not exist "%MANAGER_DIR%\server.js" (
    echo [ERROR] server.js not found: "%MANAGER_DIR%\server.js"
    pause
    exit /b 1
)

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Please install Node.js 18+ first.
    pause
    exit /b 1
)

where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] npm not found. Please reinstall Node.js.
    pause
    exit /b 1
)

set "PM=npm"
set "PNPM_CMD=pnpm"
where pnpm >nul 2>nul
if %errorlevel% equ 0 (
    set "PM=pnpm"
) else (
    if exist "%APPDATA%\npm\pnpm.cmd" (
        set "PM=pnpm"
        set "PNPM_CMD=%APPDATA%\npm\pnpm.cmd"
    ) else (
        echo [INFO] pnpm not found. Trying to install globally...
        call npm i -g pnpm
        where pnpm >nul 2>nul
        if %errorlevel% equ 0 (
            set "PM=pnpm"
            set "PNPM_CMD=pnpm"
        )
    )
)

if not exist "%WORKSPACE_DIR%\node_modules" (
    echo [INFO] Workspace dependencies are missing or broken. Installing workspace dependencies...
    pushd "%WORKSPACE_DIR%"
    if /I "!PM!"=="pnpm" (
        call "!PNPM_CMD!" install
    ) else (
        call npm install
    )
    set "INSTALL_ERR=!errorlevel!"
    popd
    if not "!INSTALL_ERR!"=="0" (
        echo [ERROR] Workspace dependency install failed.
        pause
        exit /b 1
    )
)
if /I "!PM!"=="pnpm" (
    if exist "%WORKSPACE_DIR%\pnpm-lock.yaml" (
        echo [INFO] Verifying workspace dependencies...
        pushd "%WORKSPACE_DIR%"
        call "!PNPM_CMD!" install --frozen-lockfile
        set "VERIFY_ERR=!errorlevel!"
        popd
        if not "!VERIFY_ERR!"=="0" (
            echo [ERROR] Workspace dependency verification failed.
            pause
            exit /b 1
        )
    )
)

cd /d "%MANAGER_DIR%"

if not exist node_modules (
    echo [INFO] Missing AppManager\node_modules. Installing manager dependencies...
    set "NO_PAUSE=1"
    call deploy_manager.bat
    set "NO_PAUSE="
)
set "DEPS_OK=1"
if not exist node_modules\express\package.json set "DEPS_OK=0"
if "!DEPS_OK!"=="1" (
    node -e "require.resolve('express')" >nul 2>nul || set "DEPS_OK=0"
)
if "!DEPS_OK!"=="0" (
    echo [INFO] express dependency is missing or broken. Reinstalling manager dependencies...
    set "NO_PAUSE=1"
    call deploy_manager.bat
    set "NO_PAUSE="
)

echo Starting Server...
node server.js
pause
