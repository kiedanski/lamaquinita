#!/usr/bin/env bash
# Setup script for the cloud environment the routines run in. Paste its contents into the
# environment's "Setup script" field (or call this file from there). Safe to run repeatedly.
set -uo pipefail

# pstack (poteto-mode). Project settings in .claude/settings.json also enable it; installing it
# here makes sure the plugin is present before the session starts.
if command -v claude >/dev/null; then
  claude plugin marketplace add michael-denyer/pstack-claude >/dev/null 2>&1 || true
  claude plugin install pstack@pstack-claude >/dev/null 2>&1 || echo "warning: pstack install failed" >&2
fi

# Browser for walkthrough videos (web apps only). Remove if the project is not a web app.
if [ -f package.json ] && grep -q '"playwright"' package.json; then
  npx --yes playwright install --with-deps chromium >/dev/null 2>&1 || echo "warning: playwright browser install failed" >&2
fi
