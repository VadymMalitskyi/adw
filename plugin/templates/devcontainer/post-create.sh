#!/usr/bin/env bash
set -euo pipefail

credential_paths=(/home/vscode/.config/gh /home/vscode/.codex /home/vscode/.claude)
agent_commands=(codex claude)

for path in "${credential_paths[@]}"; do
  mkdir -p "$path"
  # A rebuild reuses the same named volume (its name is keyed off this
  # workspace, not this container instance), so the directory may already be
  # vscode-owned from a previous run. Root has no CAP_DAC_OVERRIDE here, so
  # reclaim it explicitly with CAP_CHOWN (which root does keep) before
  # writing into it below, rather than relying on a fresh mkdir to still be
  # root-owned.
  chown root:root "$path"
done

# Codex and Claude get their own isolated, container-only home directories
# above, never the host's real ones: those hold live session state, sockets,
# and a cached "newer version is available" marker that would fight the
# pinned, root-owned install. Only the auth token itself is copied in once,
# from the read-only host staging mounts, so a host login carries over
# without sharing anything else.
if [[ -f /mnt/host-codex/auth.json ]]; then
  install -m 0600 /mnt/host-codex/auth.json /home/vscode/.codex/auth.json
fi
if [[ -f /mnt/host-claude/.credentials.json ]]; then
  install -m 0600 /mnt/host-claude/.credentials.json /home/vscode/.claude/.credentials.json
fi

for path in "${credential_paths[@]}"; do
  chown -R vscode:vscode "$path"
done

for command in "${agent_commands[@]}"; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "ADW managed container is missing the selected pinned agent CLI: $command" >&2
    exit 1
  fi
done

echo "ADW managed base environment is ready. Project dependency setup runs next; authenticate tools only when first used."
