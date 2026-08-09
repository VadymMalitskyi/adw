#!/usr/bin/env bash
set -euo pipefail

credential_paths=(/home/vscode/.config/gh /home/vscode/.codex /home/vscode/.claude)
agent_commands=(codex claude)

mkdir -p /home/vscode/.codex/rules
install -m 0444 /etc/adw/codex.rules /home/vscode/.codex/rules/adw-managed-development.rules

for path in "${credential_paths[@]}"; do
  mkdir -p "$path"
  chown -R vscode:vscode "$path"
done

for command in "${agent_commands[@]}"; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "ADW managed container is missing the selected pinned agent CLI: $command" >&2
    exit 1
  fi
done

echo "ADW managed base environment is ready. Project dependency setup runs next; authenticate tools only when first used."
