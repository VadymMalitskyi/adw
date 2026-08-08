# Execution security contract

Treat the configured execution environment as an enforceable preflight, not documentation. Skills and hooks are guardrails; the active OS/container/provider sandbox is the isolation boundary.

## Resolve the profile

Read schema-3-or-newer `adw.yaml` `execution.isolation` and `execution.enforcement` before any project or external mutation:

- `managed-devcontainer`: require `.devcontainer/adw-managed.json`, the managed files, and `ADW_MANAGED_DEVCONTAINER=1` in the active process.
- `project-devcontainer`: preserve project-owned files; require `.devcontainer/devcontainer.json` and a runtime marker such as `ADW_PROJECT_DEVCONTAINER=1`.
- `provider-sandbox`: inspect the active provider's real filesystem, network, and approval policy. Never infer isolation from repository text.

For `required`, stop before reads that execute project code and before every mutation when the runtime cannot be verified. Read-only inspection of configuration needed to diagnose or enter the environment is allowed. For `preferred`, report the weaker boundary and obtain explicit confirmation before continuing with a mutating workflow.

`adw:init` is the only workflow allowed to create a managed container from outside it. After applying initialization, stop and require the user to commit the reviewed files, rebuild/reopen the repository, authenticate inside project-scoped volumes, install ADW inside the container, and run `adw:doctor`.

## Managed-container invariants

Keep the agent CLIs pinned, run as a non-root user, keep Codex's inner Linux sandbox enabled, retain ordinary Claude Code permission review, and apply the fail-closed egress policy before agent work. Do not use bypass/danger-full-access modes as the normal ADW path.

Never mount the Docker socket, host home, SSH directory, global cloud credentials, or global agent configuration. Use distinct named volumes for Codex, Claude, and provider authentication. Treat those volumes as sensitive and repository-scoped.

The root-owned allowed-domain file is baked into the image. Adding a project tool, MCP server, or integration domain requires a reviewed edit and container rebuild; authentication never widens the allowlist. DNS allowlisting reduces exposure but does not prevent exfiltration to an allowed service or through DNS, so least-privilege provider identities and server-side protections remain required.

## Project-owned containers

Do not overwrite an existing `.devcontainer/`. Inspect it and report material differences from the managed invariants: host-secret or Docker-socket mounts, root execution, broad sudo, unpinned agent installation, unrestricted egress, missing runtime marker, or bypassed agent permissions. Propose changes separately and apply only after explicit approval.
