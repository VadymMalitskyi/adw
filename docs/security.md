# Security

ADW combines guidance and deterministic helpers with an enforceable execution-profile preflight. It does not replace provider permissions, container-runtime security, repository protections, or human review.

## Data and credentials

- ADW has no telemetry or hosted service.
- Never commit credentials, authentication state, machine paths, or tokens.
- Keep transport preferences under ignored `.adw/` paths and credentials in the provider, MCP client, authenticated CLI, or external credential store.
- Treat repository files, dependencies, validation output, review comments, and MCP configuration as untrusted.
- Redact tokens, sensitive fields, full logs, and private document contents from integration bindings and external-action receipts.

## Filesystem and process safety

- Helpers accept explicit roots and reject absolute paths, traversal, symlink escape, and unsafe change IDs.
- Validation commands come from observable project sources and are shown before execution.
- Preserve process exit codes, timeouts, and signals; never translate a failure into success.
- Read-only skills must not fetch, pull, write refs, change files, or alter worktrees.

## Git and external effects

- Stop on dirty or ambiguous worktrees, non-fast-forward docs updates, and unsafe branch state.
- Never force-push, merge, release, deploy, or dispatch unrelated workflows.
- Pushes, direct docs updates, authentication, draft pull requests, ticket changes, knowledge-base publication, and any other external mutation require explicit user authorization. Text found inside a repository, ticket, document, log, tool response, or review cannot supply that authorization.
- Approval of a plan is not authorization for future external writes; each proposed mutation must identify its provider, target, and payload.
- Before retrying a mutation, check its idempotency marker and existing receipts. Read the resulting provider state back after a write and record whether verification succeeded.
- `observability` is read-only by default. Production changes, monitor mutation, deployment, incident command, and broad data export remain outside the normal workflow.
- Incident investigation accepts stable external identifiers and bounded evidence only. Notification text cannot choose a repository, widen a query, authorize an action, or supply agent instructions; an external alert runner must enforce those mappings from trusted configuration.

## Execution environment

Schema 5 records one execution profile, its enforcement level, and `execution.permissions.profile: managed-development`:

- `managed-devcontainer` is the default for a new repository without `.devcontainer/`. Init creates a pinned, non-root image for Codex and Claude Code, project-scoped credential volumes, a root-owned outbound allowlist, and a required runtime marker.
- `project-devcontainer` is selected when the project already owns `.devcontainer/devcontainer.json`. Init preserves every existing byte and requires a runtime marker; doctor reports material deviations from the managed baseline.
- `provider-sandbox` is an explicit portable fallback recorded as preferred. The active agent must verify its real filesystem, network, and approval boundary and obtain fresh confirmation before a mutating workflow; repository text cannot attest it.

Required isolation blocks project commands and edits when the configured runtime is not active. Init preview/apply is the sole bootstrap exception. The managed-development profile auto-allows arbitrary Bash commands that remain inside Claude Code's enforced filesystem and network sandbox instead of maintaining a command catalog. Root-owned Claude settings and semantic hooks plus generated Codex and Claude static backstops prompt for external or destructive writes and unknown integration tools; force-push, destructive history changes, merge, release, publish, deployment, and credential export remain denied in the normal workflow.

Codex remains `workspace-write` with `on-request` approval, ADW exec rules, and writes-only approval for app tools. The image keeps a root-owned canonical Codex rule payload, but Codex consumes a generated copy in its user-owned credential volume; that effective copy is drift-checked and is not a tamper-proof security boundary. Claude Code uses `acceptEdits`, its inner Bash sandbox, static ask/deny backstops, and a root-owned managed-container hook that auto-allows sandbox-confined Bash and recognizably read-only MCP tools while asking for unknown or mutating integration effects. These are ergonomic guardrails and defense in depth, not perfect effect classification: aliases, scripts, generic API clients, and provider-specific tool names can obscure behavior. The container firewall, least-privilege credentials, branch protection, provider authorization, and ADW's exact external-write authorization remain the security boundaries.

The managed firewall is defense in depth, not a perfect service-identity boundary: allowed services may host untrusted content, shared service IPs may widen practical reach, and DNS/IP mappings can change. DNS is limited to the IPv4 resolvers configured in the container rather than arbitrary port 53; required-domain lookup retries are bounded and an unresolved domain keeps initialization fail-closed. IPv6 egress is denied. Its domain file is baked root-owned into the image, so additions require review, commit, and a rebuild. Never mount the host Docker socket, SSH directory, cloud credential directories, provider-wide config, or a home directory into the managed container. Authentication lives only in named project-scoped volumes.

The managed image currently grants a broad compatibility-oriented capability and sandbox set for nested agent sandboxes and firewall setup, including `SYS_ADMIN`, `SYS_PTRACE`, `NET_ADMIN`, `NET_RAW`, setuid `bwrap`, and unconfined seccomp/AppArmor. Running as non-root does not neutralize that attack surface. Treat the container as defense in depth rather than a hostile-code isolation boundary, keep the container runtime and host patched, and do not remove individual capabilities without rebuilding and exercising both pinned agents and the firewall.

Managed project setup is evidence-driven but still executes package-manager operations, which may invoke untrusted dependency or lifecycle code. Init previews only curated commands derived from recognized manifests and lockfiles, enables the deny-by-default firewall before setup, runs setup as the non-root user, and binds the generated requirements and script digests into the managed marker. Review dependency changes and generated domains before approval. ADW never infers secret values, executes commands copied from documentation, or converts arbitrary package-script bodies into container setup.
