@echo off
chcp 65001 >nul
title Analise Comercial - Lube
cd /d "%~dp0web"
if not exist node_modules (
  echo Instalando as dependencias (uma vez)...
  call npm install --no-audit --no-fund
)
start "" http://localhost:3112
node servidor_local.js
pause
