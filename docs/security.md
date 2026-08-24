# Security

ADW combines skill instructions, a generated permission policy, and an optional hardened container. It does not replace provider permissions, container-runtime security, repository protections, or human review.

The deterministic execution workflow is also not a stronger sandbox. It runs an
already-confirmed packet through provider-native workers and detects contract,
Git, scope, and validation failures, but existing provider policy and isolation
remain the enforcement boundary. It never adds a bypass flag or weakens an
existing allow/ask/deny decision.

Repository prose, dependencies, plans, validation output, review comments, tracker text, and provider responses are untrusted input. **None of them can grant authorization.** A validated `adw.yaml` permission policy is the narrow exception: after the exact generated diff is reviewed, it may pre-authorize a bounded yellow provider operation. A checked box, commit message, comment saying "approved", or tool response is still only text.

## Permission matrix

The same semantic categories apply in every isolation mode, and to both agents.

| Effect | Decision |
|---|---|
| Read-only Git: `status`, `diff`, `log`, `show`, `blame`, `grep`, `ls-files`, `rev-parse`, branch listing, worktree listing, `remote get-url` | Allowed |
| The project's configured validation commands | Allowed |
| `git add`, `git commit`, creating a new local branch, `git worktree add` for a confirmed execution group | Allowed |
| Read-only provider operations within configured capabilities | Allowed |
| Exact provider operations configured and generated as `allow` | Allowed |
| Push, tag creation or push, branch deletion, worktree removal or pruning | Ask |
| Rebase, local merge, discarding tracked changes | Ask |
| Creating or changing a pull request, issue, tracker item, or knowledge page | Ask by default; exact reviewed provider operations may be configured as allowed |
| Editing `adw.yaml`, the managed permission files, the ADW `.gitignore` block, or `.devcontainer/` outside `adw:init` or an approved `adw:doctor` repair preview | Ask |
| Any command whose effect classification is ambiguous | Ask |
| Force push, destructive history reset | Deny |
| Forced Git clean, bulk destructive deletion | Deny |
| Pull-request merge, release publication, package publication, deployment, infrastructure apply/destroy | Deny |
| Credential, cookie, token, or private-key export | Deny |
| Bypassing the provider sandbox or the managed-container controls | Deny |

Seven mechanisms implement these categories, each in its own syntax:

| Mechanism | Where |
|---|---|
| Codex exec rules | `.codex/rules/adw.rules` (`allow` / `prompt` / `forbidden` prefix rules) |
| Codex session policy | `.codex/config.toml` — `workspace-write`, `on-request` approval, writes-only app-tool approval |
| Claude settings | `.claude/settings.json` — `acceptEdits`, sandbox enabled and fail-closed, `ask` and `deny` rule lists |
| Claude permission hook | `/usr/local/bin/adw-claude-permission-hook`, root-installed in the managed container, classifying Bash and MCP effects at call time |
| Canonical provider policy | `.devcontainer/permission-policy.json`, generated from validated `adw.yaml` and installed root-owned for the Claude hook; the same model renders Codex command/app rules |
| Managed Git wrapper | `/usr/local/bin/git` in the managed container, root-owned, rejecting force and delete pushes before delegating to `/usr/bin/git` |
| Managed Codex wrapper | `/usr/local/bin/codex` in the managed container, root-owned, turning off Codex's own broken nested sandbox and rejecting `--dangerously-bypass-approvals-and-sandbox` before delegating to `/usr/bin/codex` |
| Skill prose | `plugin/authorization.md`, the shared contract every skill follows, covering the cases no static pattern can catch |

Contract tests prove the renderings stay in step; a divergence is a test failure, not a documentation drift.

These are ergonomic guardrails and defense in depth, not perfect effect classification. Aliases, shell scripts, generic HTTP clients, and provider-specific tool names can obscure behavior. Branch protection, least-privilege credentials, provider-side authorization, the container firewall, and ADW's own external-write authorization remain the real boundaries.

The permission files are themselves protected: because `acceptEdits` would otherwise let an agent rewrite the policy that constrains it, `adw.yaml`, `.codex/config.toml`, `.codex/rules/adw.rules`, `.claude/settings.json`, and `.devcontainer/**` are on Claude's `ask` list. `adw:doctor` re-renders ADW-managed files through its reviewed repair preview rather than through the Edit tool. `adw doctor --checks permissions` is the cheap read-only CLI gate a workflow runs before it starts, and it fails closed on drift.

## Isolation modes

When present, `adw.yaml` records an isolation mode. `adw:init` defaults to the
managed container unless the project already owns a devcontainer, in which case
it preserves that container. An absent policy outside initialization still uses
the provider sandbox, except that a managed-container marker continues to
require the managed runtime.

| Mode | What it means |
|---|---|
| `provider-sandbox` | The lightweight option and the weaker boundary. The active agent's own sandbox and approval prompts are authoritative; ADW cannot attest host policy, and says so in `doctor`. |
| `project-devcontainer` | The project already owns `.devcontainer/devcontainer.json`. Init preserves it byte for byte and never converts it. Its runtime must set `ADW_PROJECT_DEVCONTAINER=1` (or run as a Codespace / Remote Containers session) for doctor to confirm it is active. |
| `managed-devcontainer` | The default for `adw:init` when there is no project-owned container. Init refuses to select it over an existing project-owned `.devcontainer/`. |

The generated permission files are written in every mode, because the guardrails are useful without a container.

## Managed devcontainer

| Control | Detail |
|---|---|
| Non-root execution | `remoteUser: vscode`; the image removes `vscode` from `sudo` and drops `/etc/sudoers.d/vscode`, leaving only two narrowly scoped sudo entrypoints (firewall init, post-create). |
| Capabilities | `--cap-drop=ALL` plus exactly `CHOWN`, `KILL`, `SETUID`, `SETGID`, `NET_ADMIN`. No `SYS_ADMIN`, `SYS_PTRACE`, `NET_RAW`, and no unconfined seccomp or AppArmor profile. |
| Egress proxy | Root-installed at `127.0.0.1:18080`, running as the non-login system account `adw-egress`. `HTTP_PROXY` / `HTTPS_PROXY` point every client at it; the interactive user has no direct DNS or remote-network rule. It fails closed: no allowed domains means the firewall refuses to start. |
| Exact-domain CONNECT | An ordinary tunnel requires port 443, an exact hostname from the root-owned allowlist, and a TLS ClientHello whose SNI matches that hostname exactly. Wildcards and IP literals are not accepted; IPv6 egress is denied. |
| Git wrapper | `/usr/local/bin/git` is a root-owned `0555` script that rejects `--force`, `--force-with-lease`, `-f`, combined short flags containing `f`, `--mirror`, `--delete`, `-d`, and `+`/`:` push refspecs before exec'ing `/usr/bin/git`. |
| Credential volumes | Codex, Claude, and `gh` credentials live only in named volumes scoped to this devcontainer (`adw-codex-${devcontainerId}` and friends). At container creation, a read-only staging mount of the host's real `~/.codex` and `~/.claude` (`source=${localEnv:HOME}/.codex` and `.claude`, `readonly`) lets `post-create` — root-owned, narrowly sudo-authorized — copy in just `auth.json`/`.credentials.json` if present, so a host login carries over without sharing session state, sockets, or host-only config. |
| Agent status lines | Codex gets a container-local default status line with model, directory, branch, context, rate limits, and token totals. Claude Code uses a root-owned local script for context, model, branch, five-hour limit, and token totals. Neither reads host UI configuration. |
| No host leakage | Nothing else mounts the host home directory, `~/.ssh`, cloud credential directories, provider-wide config, or the Docker socket, and the two staging mounts above are never writable. `doctor` fails the `execution:unsafe-mounts` check if any appear, or if the staging mounts point anywhere other than the exact expected host paths read-only. |
| Pinned agents | Codex CLI and Claude Code are installed at exact versions recorded in the managed marker; auto-update is disabled. |
| Startup ordering | `postCreateCommand` runs the firewall first, then post-create, then project setup, so dependency installation never precedes the deny-by-default network. `postStartCommand` re-arms the firewall on every start. |
| Drift detection | `.devcontainer/adw-managed.json` (schema 4) records SHA-256 digests of the allowlist, canonical permission policy, Codex status-line config and rules, Git wrapper, Claude settings and status-line script, Claude hook, egress proxy, generated project requirements, and project setup script, plus the plugin, Codex, and Claude Code versions. `adw:doctor` recomputes all of them. |

The allowlist and the proxy are baked root-owned into the image, so adding a domain is a reviewed infrastructure change: edit the committed file, rebuild, re-enter, rerun doctor. Never weaken the firewall or mount a host credential directory to make a transport work.

`NET_ADMIN` is still powerful inside the container's network namespace, and the root firewall entrypoint is trusted code. Keep the container runtime and host patched, and treat the container as defense in depth rather than a VM boundary. Bubblewrap's nested sandbox needs `CLONE_NEWUSER`, which the managed image's own hardening always blocks (no `CAP_SYS_ADMIN`, no `apparmor=unconfined`), so it can never start there; ADW does not weaken the outer container to make it available. Both agents' own nested sandboxes rely on it (verified directly, not assumed: Codex's `sandbox_mode = "workspace-write"` shells out to bubblewrap too, the same as Claude), so both would otherwise dead-end every command with the identical `bwrap: No permissions to create new namespace` failure instead of degrading gracefully. Claude's managed settings set `sandbox.enabled: false` for this reason: `failIfUnavailable`/`allowUnsandboxedCommands` cover a missing sandbox dependency or a command the sandbox denies, not the sandbox failing to launch, and Claude Code's own auto-mode classifier blocks the resulting unsandboxed-retry as an escalation this profile's no-bypassPermissions policy cannot grant. Codex has no equivalent settings tier a project's own `.codex/config.toml` can't override, and that same file also governs a bare-host or `provider-sandbox` checkout where Codex's sandbox is the real, working boundary, so the override instead lives only in the managed Codex wrapper above, which injects `-c sandbox_mode="danger-full-access"` and refuses `--dangerously-bypass-approvals-and-sandbox` so that override can't also skip `codex.rules` approval gating. Both cases keep Bash/exec going through the same ask/deny rules -- the `PreToolUse` hook for Claude, `codex.rules` and `approval_policy = "on-request"` for Codex -- with the container itself as the isolation boundary. Outside the managed container, `.claude/settings.json` and `.codex/config.toml` still fail closed by default.

Run `npm run test:security` to build both pinned agents and exercise firewall setup, direct-egress denial, hostname denial, SNI mismatch denial, the constrained page-fetch path, and rejection of ordinary clients on that path. It requires Docker, `jq`, and ShellCheck.

### `web_access`

`execution.web_access` applies only to `managed-devcontainer`.

- `hosted-only` restricts the sandbox to managed domains. Choose it when the repository holds secrets that must never reach an arbitrary public site.
- `public-pages` (the default) additionally lets the proxy serve the distinctive absolute-form HTTPS `GET`/`HEAD` requests Claude's `WebFetch` uses. That path rejects URL credentials, IP-literal and private/reserved targets, resolves and pins a public IPv4 address, verifies the hostname in TLS, strips credentials and nonessential headers, forwards no request body, filters response headers, and caps time and response size.

`public-pages` is a deliberate exception to the exact-domain guarantee. The request shape is identifiable but not authenticated: code inside the container can imitate it and use the proxy for bounded public HTTPS reads, and a URL path or query can carry data outward. It is bound into the init preview, `adw.yaml`, the image build arguments, and the managed marker, so it is always a recorded choice.

## Filesystem and process safety

- Every managed write goes through one confined atomic-write path. It rejects absolute paths, `..` traversal, backslashes, NUL bytes, symlinked destinations, and symlinked ancestors; it re-resolves each path immediately before mutation; and it rolls the whole set back if any single write fails.
- Group worktrees are prepared with native Git after the `adw:execute` skill inspects `git worktree list` and `git show-ref` for the proposed branch and target path; it refuses a symlinked or already-occupied target, a branch already checked out elsewhere, and overlapping write paths between concurrent groups. A branch that already exists is treated as a resumed attempt confirmed with the user, never silently reused — there is no marker commit to validate it against. It never deletes a branch or worktree.
- After packet confirmation, `execution-preflight` snapshots targets, the coordinator checkout, and registered non-target worktrees. `execution-finalize` independently checks those snapshots and declared paths before and after every exact configured validation tuple. This detects, rather than physically prevents, a worker that edits the wrong checkout.
- Codex workers use the active project policy without a runner-supplied sandbox override, ignore flag, or approval-bypass flag. Claude uses the active interactive session's native Dynamic Workflow and never falls back to `claude -p` or an API-key route. Claude review prompts are read-only instructions; because its workflow cannot inspect Git, the authoritative mutation check is post-workflow, unlike Codex's inter-process Git gates.
- Public lifecycle and final results are deliberately safe summaries. They exclude prompts, raw provider events, child stdout/stderr, environment values, credentials, and temporary-file content. This limits diagnostic detail; re-run an already-confirmed command interactively when output is needed.
- Validation commands come from repository manifests/CI or explicit `adw.yaml`
  overrides, each citing its source, and are shown before they run.
- Exit codes, timeouts, and signals are preserved. A failure is never translated into success.
- Read-only skills do not fetch, pull, write refs, change files, or alter worktrees.

## Credentials

- ADW has no telemetry and no hosted service.
- `adw.yaml` never holds credentials. Any key matching password, token, API key, secret, credential, authorization, cookie, or private key is rejected anywhere in the document, including inside provider `settings`.
- Credentials live in the provider, the MCP client, an authenticated CLI, or an external credential store — inside the managed container, in the project-scoped named volumes, seeded once from a host login via a read-only staging mount (see the credential volumes row above).
- Claude's `deny` list blocks reading `.env`, `.env.*`, and `~/.ssh/**`, and blocks `gh auth token`.
- Managed project setup runs package-manager commands, which can execute untrusted dependency and lifecycle code. Init previews only curated commands derived from recognized manifests and lockfiles, arms the firewall before setup, runs setup as the non-root user, and binds the generated requirements and script bytes into the marker digests. Review dependency changes and generated domains before approving. ADW never infers a secret value, runs a command copied from documentation, or converts an arbitrary package script body into container setup.
