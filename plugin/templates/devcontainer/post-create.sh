#!/usr/bin/env bash
set -euo pipefail

for path in /home/vscode/.codex /home/vscode/.claude /home/vscode/.config/gh; do
  mkdir -p "$path"
  chown -R vscode:vscode "$path"
done

if [ ! -x /usr/local/bin/codex ] || [ ! -x /usr/local/bin/claude ]; then
  echo "ADW managed container is missing a pinned agent CLI" >&2
  exit 1
fi

echo "ADW managed container ready. Authenticate and install the ADW plugin inside this container, then run adw:doctor."
