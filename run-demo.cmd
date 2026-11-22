@echo off
REM 演示模式启动：全站隐藏余额/价格/充值，试穿不扣费。
REM 需要真实计费时改用：node --env-file-if-exists=.env server.mjs
setlocal
cd /d "%~dp0"
set DEMO_MODE=1
node --env-file-if-exists=.env server.mjs
