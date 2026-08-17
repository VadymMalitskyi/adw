#!/usr/bin/env bash
# Root-owned command gate that turns off Codex's own nested sandbox in the
# managed container. Bubblewrap needs CLONE_NEWUSER to build that sandbox,
# which the managed image's own hardening always blocks (no CAP_SYS_ADMIN, no
# apparmor=unconfined -- see execution:hardening), so every command Codex
# tries to run dead-ends with "No permissions to create new namespace"
# without this override (verified directly: `codex exec` fails identically to
# `codex sandbox` and to Claude's own bwrap failure in this same container).
# The override lives only here, not in the project's own .codex/config.toml,
# because that file also governs a bare-host or provider-sandbox checkout
# where Codex's sandbox is the real, working isolation boundary -- turning it
# off there would be a real regression, not a no-op. Approval gating stays
# on: codex.rules and approval_policy = "on-request" are untouched, so
# --dangerously-bypass-approvals-and-sandbox, which would skip that gating
# too, is refused here rather than silently forwarded.
set -euo pipefail

for argument in "$@"; do
  if [[ "$argument" == "--dangerously-bypass-approvals-and-sandbox" ]]; then
    printf '%s\n' "ADW blocks --dangerously-bypass-approvals-and-sandbox: it would also skip codex.rules approval gating, not just the sandbox this wrapper already turns off. Use an explicitly approved /usr/bin/codex invocation instead." >&2
    exit 64
  fi
done

exec /usr/bin/codex -c sandbox_mode="danger-full-access" "$@"
