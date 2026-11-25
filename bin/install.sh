#!/usr/bin/env bash
# Copies the board-loop kit into a project. Never overwrites a file that is already there.
#
#   bash bin/install.sh /path/to/project
#
# Then fill in <project>/.agents/lamaquinita.json and paste CLAUDE.snippet.md into the
# project's CLAUDE.md (the snippet itself is not copied).

set -euo pipefail

target="${1:-}"
[ -n "$target" ] && [ -d "$target" ] || { echo "usage: bash bin/install.sh <project dir>" >&2; exit 2; }
kit="$(cd "$(dirname "${BASH_SOURCE[0]}")/../kit" && pwd)"

copied=0
skipped=0
while IFS= read -r -d '' file; do
  rel="${file#"$kit"/}"
  [ "$rel" = "CLAUDE.snippet.md" ] && continue
  dest="$target/$rel"
  if [ -e "$dest" ]; then
    echo "skip   $rel (already there)"
    skipped=$((skipped + 1))
  else
    mkdir -p "$(dirname "$dest")"
    cp "$file" "$dest"
    echo "copy   $rel"
    copied=$((copied + 1))
  fi
done < <(find "$kit" -type f -print0 | sort -z)

echo
echo "$copied copied, $skipped skipped."
echo "Next: fill in $target/.agents/lamaquinita.json and add kit/CLAUDE.snippet.md to the project's CLAUDE.md."
