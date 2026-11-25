#!/usr/bin/env bash
# install.sh copies the kit, skips files that exist, and leaves the snippet out.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
t="$(mktemp -d)"; trap 'rm -rf "$t"' EXIT
fail() { echo "FAIL install: $*" >&2; exit 1; }

mkdir -p "$t/.agents"
echo '{"mine":true}' >"$t/.agents/lamaquinita.json"

out="$(bash "$root/bin/install.sh" "$t")"

[ -f "$t/.claude/skills/board-loop/SKILL.md" ] || fail "skill not copied"
[ -f "$t/.agents/routines/board-pickup.md" ] || fail "routine not copied"
[ -f "$t/scripts/pr-stage.js" ] || fail "script not copied"
[ ! -e "$t/CLAUDE.snippet.md" ] || fail "snippet should not be copied"
grep -q '"mine":true' "$t/.agents/lamaquinita.json" || fail "existing config was overwritten"
grep -q "skip   .agents/lamaquinita.json" <<<"$out" || fail "skip not reported"

if bash "$root/bin/install.sh" "$t/does-not-exist" 2>/dev/null; then fail "missing target accepted"; fi
echo "ok install"
