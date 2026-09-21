#!/bin/bash
# Supabase 保活 cron 包装脚本（macOS launchd / Linux crontab 通用）
#
# 由 launchd 或 crontab 调用，负责：
#   1. 找到 node（兼容 nvm / homebrew / 系统安装）
#   2. 跑 scripts/keepalive.mjs
#   3. 把结果追加到 .keepalive.log（已被 .gitignore 忽略）
#
# 手动测试： bash scripts/keepalive-cron.sh && tail -5 .keepalive.log

set -uo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR" || exit 1

LOG_FILE="$REPO_DIR/.keepalive.log"
MAX_LOG_LINES=2000

# --- 定位 node ---------------------------------------------------------
NODE_BIN=""
for candidate in \
  "$(command -v node 2>/dev/null)" \
  "$HOME/.nvm/versions/node/$(ls -1 "$HOME/.nvm/versions/node" 2>/dev/null | sort -V | tail -1)/bin/node" \
  /opt/homebrew/bin/node \
  /usr/local/bin/node
do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then
    NODE_BIN="$candidate"
    break
  fi
done

if [ -z "$NODE_BIN" ]; then
  echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] ❌ 未找到 node 可执行文件" >> "$LOG_FILE"
  exit 1
fi

# --- 执行 --------------------------------------------------------------
START="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
OUTPUT="$("$NODE_BIN" "$REPO_DIR/scripts/keepalive.mjs" --quiet 2>&1)"
CODE=$?

echo "[$START] exit=$CODE ${OUTPUT:-（无输出）}" >> "$LOG_FILE"

# 日志裁剪，避免无限增长
if [ "$(wc -l < "$LOG_FILE")" -gt "$MAX_LOG_LINES" ]; then
  tail -n "$MAX_LOG_LINES" "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
fi

exit $CODE
