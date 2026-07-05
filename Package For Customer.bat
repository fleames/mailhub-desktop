@echo off
title MailHub Desktop - Package For Customer
set /p CUSTOMER_EMAIL="Customer email: "
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0package-for-customer.ps1" -Email "%CUSTOMER_EMAIL%"
echo.
pause
