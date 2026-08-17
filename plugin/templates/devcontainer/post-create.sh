#!/usr/bin/env bash
set -euo pipefail

credential_paths=(/home/vscode/.config/gh /home/vscode/.codex /home/vscode/.claude)
agent_commands=(codex claude)

for path in "${credential_paths[@]}"; do
  mkdir -p "$path"
  # A rebuild reuses the same named volume (its name is keyed off this
  # workspace, not this container instance), so this directory may already be
  # vscode-owned -- and, from real prior use, may already contain
  # narrowly-permissioned subdirectories (Codex's own ipc/tmp sockets, for
  # example) that root cannot descend into without CAP_DAC_OVERRIDE, which it
  # intentionally lacks here. Only ever reclaim the directory entry itself,
  # never recursively, with CAP_CHOWN (which root does keep).
  chown root:root "$path"
done

# Codex and Claude get their own isolated, container-only home directories
# above, never the host's real ones: those hold live session state, sockets,
# and a cached "newer version is available" marker that would fight the
# pinned, root-owned install. Only the auth token itself is copied in once,
# from the read-only host staging mounts, so a host login carries over
# without sharing anything else. `install` sets the mode while root still
# owns the file, so chown must come after, as its own step: root has
# CAP_CHOWN but not CAP_FOWNER, so once a file belongs to vscode root can no
# longer chmod it, only reassign it.
if [[ -f /mnt/host-codex/auth.json ]]; then
  install -m 0600 /mnt/host-codex/auth.json /home/vscode/.codex/auth.json
  chown vscode:vscode /home/vscode/.codex/auth.json
fi
if [[ -f /mnt/host-claude/.credentials.json ]]; then
  install -m 0600 /mnt/host-claude/.credentials.json /home/vscode/.claude/.credentials.json
  chown vscode:vscode /home/vscode/.claude/.credentials.json
fi

# Keep the UI configuration local to this container volume.  Unlike auth, it
# is never read from the host: a developer can adjust it with /statusline and
# the choice survives rebuilds without exposing host state to the container.
if [[ ! -e /home/vscode/.codex/config.toml ]]; then
  install -m 0600 /etc/adw/codex-config.toml /home/vscode/.codex/config.toml
  chown vscode:vscode /home/vscode/.codex/config.toml
fi

for path in "${credential_paths[@]}"; do
  chown vscode:vscode "$path"
done

for command in "${agent_commands[@]}"; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "ADW managed container is missing the selected pinned agent CLI: $command" >&2
    exit 1
  fi
done

echo "ADW managed base environment is ready. Project dependency setup runs next; authenticate tools only when first used."
