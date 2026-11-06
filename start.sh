#!/usr/bin/env bash
# 启动 ADB 预装应用管理器（macOS / Linux）
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "[提示] 未找到 Node.js，请先安装 Node.js 18 或更高版本。" >&2
  exit 1
fi

echo "正在启动 ADB 预装应用管理器..."
exec node server.mjs --open "$@"
