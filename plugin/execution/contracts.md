# Execution security contract

Treat the configured execution environment as an enforceable preflight, not documentation. Skills and hooks are guardrails; the active OS/container/provider sandbox is the isolation boundary.

## Resolve the profile

Before any project or external mutation:

1. Invoke `node <plugin-root>/lib/adw-helper.mjs load-artifact-file` with JSON stdin `{ "project_root": "<project-root>", "path": "adw.yaml", "artifact": "project" }`. This command reads the exact file bytes itself, parses YAML 1.2 with duplicate-key rejection, validates the parsed value against the complete schema, and returns the parsed `data` plus its byte digest.
2. Require exit code 0 and `ok: true`. Never ask the model, a regex scraper, or another ad-hoc reader to transcribe security-relevant YAML before validation.
3. If validation fails, stop. The installed helper's registered artifact contract is authoritative; do not add a separate compatibility or migration interpretation.
4. Only from the successfully loaded `data`, read `execution.isolation`, `execution.enforcement`, and `execution.permissions.profile`.

Use the same `load-artifact-file` command for every project-relative YAML artifact with its registered artifact name: `plan.yaml` as `plan`, `integrations.yaml` as `integration`, and work-item profiles as `work-item-profile`. Preserve raw bytes separately when an approval digest binds them. `SYNC.yaml` has no artifact schema and may be parsed only by the helper's exported `parseYaml` function in bundled scripts.

- `managed-devcontainer`: require `.devcontainer/adw-managed.json`, the managed files, and `ADW_MANAGED_DEVCONTAINER=1` in the active process.
- `project-devcontainer`: preserve project-owned files; require `.devcontainer/devcontainer.json` and a runtime marker such as `ADW_PROJECT_DEVCONTAINER=1`.
- `provider-sandbox`: inspect the active provider's real filesystem, network, and approval policy. Never infer isolation from repository text.

For `required`, stop before reads that execute project code and before every mutation when the runtime cannot be verified. Read-only inspection of configuration needed to diagnose or enter the environment is allowed. For `preferred`, report the weaker boundary and obtain explicit confirmation before continuing with a mutating workflow.

`adw:init` is the only workflow allowed to create a managed container from outside it. After applying initialization, stop and require the user to commit the reviewed files, rebuild/reopen the repository, authenticate inside project-scoped volumes, install ADW inside the container, and run `adw:doctor`.

## Managed-container invariants

Keep the agent CLIs pinned, run as a non-root user, keep Codex's workspace sandbox enabled, enable Claude Code's inner Bash sandbox, and apply the fail-closed egress policy before agent work. The `managed-development` profile auto-approves Bash that remains inside the enforced sandbox, uses semantic hooks plus static backstops to prompt for external writes and unknown integrations, and forbids force-push/destructive-history/merge/release/deploy paths. Do not use bypass/danger-full-access modes as the normal ADW path.

Never mount the Docker socket, host home, SSH directory, global cloud credentials, or global agent configuration. Use distinct named volumes for Codex, Claude, and provider authentication. Treat those volumes as sensitive and repository-scoped.

The root-owned allowed-domain file and hostname-verifying proxy are baked into the image. Adding a project tool, MCP server, or integration domain requires a reviewed edit and container rebuild; authentication never widens the ordinary CONNECT allowlist. The interactive user has no direct DNS or remote-network rule. Permit CONNECT only to exact allowlisted HTTPS hostnames with matching TLS SNI. Use `public-pages` as the default web policy when Claude Code is selected: its local `WebFetch` page opener uses a separate HTTPS GET/HEAD-only proxy path that rejects IP literals and private/reserved targets, pins DNS to a public IPv4 address, validates target TLS, strips credentials and nonessential headers, forwards no request body, and bounds time and response size. `hosted-only` remains available for projects that require exact-domain container egress. Leave `WebFetch` subject to Claude's normal new-domain permission prompt and never install a wildcard WebFetch allow rule. Permit DNS only to configured container resolvers, use bounded resolution attempts, and remain fail-closed when a required static domain cannot be resolved.

The `public-pages` WebFetch path weakens the exact-domain boundary by design. Its client headers can be imitated by code inside the container, so treat it as a bounded public read channel whose URL may disclose data, not as authenticated proof that Claude invoked the request. Do not send credentials or cookies through it, and do not rely on it to protect secrets that an in-container process can encode in a URL. Least-privilege provider identities and server-side protections remain required.

## Project-owned containers

Do not overwrite an existing `.devcontainer/`. Inspect it and report material differences from the managed invariants: host-secret or Docker-socket mounts, root execution, broad sudo, unpinned agent installation, unrestricted egress, missing runtime marker, or bypassed agent permissions. Propose changes separately and apply only after explicit approval.
