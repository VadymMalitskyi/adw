#!/usr/bin/env bash
set -euo pipefail

agent_tools="$(cat /etc/adw/agent-tools)"
credential_paths=(/home/vscode/.config/gh)
agent_commands=()

case "$agent_tools" in
  codex)
    credential_paths+=(/home/vscode/.codex)
    agent_commands+=(codex)
    ready_label="Codex"
    ;;
  claude)
    credential_paths+=(/home/vscode/.claude)
    agent_commands+=(claude)
    ready_label="Claude Code"
    ;;
  both)
    credential_paths+=(/home/vscode/.codex /home/vscode/.claude)
    agent_commands+=(codex claude)
    ready_label="Codex and Claude Code"
    ;;
  *)
    echo "ADW managed container has an invalid agent tools profile: $agent_tools" >&2
    exit 1
    ;;
esac

for path in "${credential_paths[@]}"; do
  mkdir -p "$path"
  chown -R vscode:vscode "$path"
done

if [[ "$agent_tools" == "codex" || "$agent_tools" == "both" ]]; then
  mkdir -p /home/vscode/.codex/rules
  install -m 0444 /etc/adw/codex.rules /home/vscode/.codex/rules/adw-managed-development.rules
  chown -R vscode:vscode /home/vscode/.codex/rules
fi

for command in "${agent_commands[@]}"; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "ADW managed container is missing the selected pinned agent CLI: $command" >&2
    exit 1
  fi
done

echo "ADW managed container ready with $ready_label. Authenticate the selected agent tools and required providers, install the ADW plugin inside this container, then run adw:doctor."
