@echo off
chcp 65001 >nul 2>nul
setlocal
cd /d "%~dp0"

rem ── 探测 node：优先 PATH，回退到 Windows 常见安装路径 ──
set "NODE_BIN=node"
where node >nul 2>nul
if not errorlevel 1 goto :have_node

if exist "C:\Program Files\nodejs\node.exe" (
  set "NODE_BIN=C:\Program Files\nodejs\node.exe"
  goto :have_node
)
if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" (
  set "NODE_BIN=%LOCALAPPDATA%\Programs\nodejs\node.exe"
  goto :have_node
)

echo [提示] 未找到 Node.js，请先安装 Node.js 18 或更高版本。
echo         安装后重新双击本脚本即可。
pause
exit /b 1

:have_node
echo 正在启动 ADB 预装应用管理器...
echo 浏览器将自动打开 http://127.0.0.1:8787
"%NODE_BIN%" server.mjs --open %*
if errorlevel 1 (
  echo.
  echo [提示] 服务启动失败，请查看上方错误信息后重试。
  pause
)
endlocal
