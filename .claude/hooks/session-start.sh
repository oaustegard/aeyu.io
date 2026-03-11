#!/bin/bash
set -euo pipefail

# Only run in remote (Claude Code on the web) environments
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Install npm dev dependencies used by test/setup.sh and Tailwind rebuild
npm install --silent preact @preact/signals htm esbuild @tailwindcss/cli 2>/dev/null

# Install Playwright for the Python test harness
pip install playwright 2>/dev/null
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers python3 -m playwright install --with-deps chromium 2>/dev/null

# Install tree-sitter for codemap generation and regenerate _MAP.md files
pip install tree-sitter-language-pack 2>/dev/null
python3 .claude/skills/mapping-codebases/scripts/codemap.py . --skip vendor,design,assets,icons 2>/dev/null
