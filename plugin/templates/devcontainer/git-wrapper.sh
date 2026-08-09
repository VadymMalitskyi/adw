#!/usr/bin/env bash
# Root-owned command gate for Codex's auto-approved `git push` rule.
# Calls that bypass this wrapper (for example, /usr/bin/git) do not match that
# rule and therefore require normal Codex approval.
set -euo pipefail

if [[ "${1:-}" == "push" ]]; then
  for argument in "${@:2}"; do
    case "$argument" in
      --force|--force=*|--force-with-lease|--force-with-lease=*|-f|--mirror|--delete|-d)
        printf '%s\n' "ADW blocks force or delete pushes through the auto-approved git command. Use an explicitly approved /usr/bin/git invocation instead." >&2
        exit 64
        ;;
      +*|:*)
        printf '%s\n' "ADW blocks force or delete push refspecs through the auto-approved git command. Use an explicitly approved /usr/bin/git invocation instead." >&2
        exit 64
        ;;
    esac
    # Git accepts combined short options such as -uf; a leading double dash is
    # excluded so long options such as --follow-tags are unaffected.
    if [[ "$argument" =~ ^-[^-]*f ]]; then
      printf '%s\n' "ADW blocks force pushes through the auto-approved git command. Use an explicitly approved /usr/bin/git invocation instead." >&2
      exit 64
    fi
  done
fi

exec /usr/bin/git "$@"
