@echo off
REM Demo mode: hides balance, prices and top-up, and does not charge for try-on.
REM For real billing, run: node --env-file-if-exists=.env server.mjs
setlocal
cd /d "%~dp0"
set DEMO_MODE=1
node --env-file-if-exists=.env server.mjs
