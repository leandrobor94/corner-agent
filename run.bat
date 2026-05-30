@echo off
cd /d "%~dp0"
echo === Corner Agent ===
echo.
echo Modos disponibles:
echo   node index.js          - Modo vivo (loop infinito, Ctrl+C para salir)
echo   node index.js once     - Un solo analisis
echo   node index.js catchup  - Analizar partidos finalizados hoy
echo   node index.js ci       - Modo CI (catchup + vivo + reporte)
echo.
echo Iniciando modo vivo...
echo.
node index.js
pause
