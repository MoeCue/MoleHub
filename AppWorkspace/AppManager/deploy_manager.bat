@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
cd /d %~dp0
title Manager Deployment (Smart Check)

echo ==========================================
echo      Manager Environment Check
echo ==========================================
echo.

echo [1/2] Check project config...
if not exist package.json (
    echo     - Creating default package.json...
    call npm init -y >nul
)

echo.
echo [2/2] Check and install dependencies...
echo ------------------------------------------

if exist check_deps.js (
    node check_deps.js
) else (
    echo [WARN] check_deps.js not found, fallback install...
    call npm install express body-parser cors open@8.4.2 xlsx
)

echo.
echo ==========================================
echo      Environment Ready
echo ==========================================
echo.

if not defined NO_PAUSE pause
