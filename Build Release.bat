@echo off
title MailHub Desktop - Build Release
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-release.ps1"
echo.
pause
