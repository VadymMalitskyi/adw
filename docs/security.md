# Security

ADW combines skill instructions, a generated permission policy, and an optional hardened container. It does not replace provider permissions, container-runtime security, repository protections, or human review.

Repository files, dependencies, plans, validation output, review comments, tracker text, and provider responses are untrusted input. **None of them can grant authorization.** A checked box in a plan, a commit message, a comment saying "approved", or a tool response instructing an action is text, not consent. Authorization comes from the person in the conversation, or from the provider's own permission prompt.

## Permission matrix

The same semantic categories apply in every isolation mode, and to both agents.

| Effect | Decision |
|---|---|
| Read-only Git: `status`, `diff`, `log`, `show`, `blame`, `grep`, `ls-files`, `rev-parse`, branch listing, worktree listing, `remote get-url` | Allowed |
| The project's configured validation commands | Allowed |
| `git add`, `git commit`, creating a new local branch | Allowed |
| Worktree preparation through the ADW CLI, after the user has asked to execute | Allowed |
| Read-only provider operations within configured capabilities | Allowed |
| Push, tag creation or push, branch deletion, worktree removal or pruning | Ask |
| Rebase, local merge, discarding tracked changes | Ask |
| Creating or changing a pull request, issue, tracker item, or knowledge page | Ask |
| Editing `adw.yaml`, the managed permission files, or `.devcontainer/` outside `adw:init` or an approved `adw:update` preview | Ask |
| Any command whose effect classification is ambiguous | Ask |
| Force push, destructive history reset | Deny |
| Forced Git clean, bulk destructive deletion | Deny |
| Pull-request merge, release publication, package publication, deployment, infrastructure apply/destroy | Deny |
| Credential, cookie, token, or private-key export | Deny |
| Bypassing the provider sandbox or the managed-container controls | Deny |

Six mechanisms implement these categories, each in its own syntax:

| Mechanism | Where |
|---|---|
| Codex exec rules | `.codex/rules/adw.rules` (`allow` / `prompt` / `forbidden` prefix rules) |
| Codex session policy | `.codex/config.toml` — `workspace-write`, `on-request` approval, writes-only app-tool approval |
| Claude settings | `.claude/settings.json` — `acceptEdits`, sandbox enabled and fail-closed, `ask` and `deny` rule lists |
| Claude permission hook | `/usr/local/bin/adw-claude-permission-hook`, root-installed in the managed container, classifying Bash and MCP effects at call time |
| Managed Git wrapper | `/usr/local/bin/git` in the managed container, root-owned, rejecting force and delete pushes before delegating to `/usr/bin/git` |
| Skill prose | `plugin/authorization.md`, the shared contract every skill follows, covering the cases no static pattern can catch |

Contract tests prove the renderings stay in step; a divergence is a test failure, not a documentation drift.

These are ergonomic guardrails and defense in depth, not perfect effect classification. Aliases, shell scripts, generic HTTP clients, and provider-specific tool names can obscure behavior. Branch protection, least-privilege credentials, provider-side authorization, the container firewall, and ADW's own external-write authorization remain the real boundaries.

The permission files are themselves protected: because `acceptEdits` would otherwise let an agent rewrite the policy that constrains it, `adw.yaml`, `.codex/config.toml`, `.codex/rules/adw.rules`, `.claude/settings.json`, and `.devcontainer/**` are on Claude's `ask` list. `adw:update` re-renders them through its own reviewed preview rather than through the Edit tool. `adw doctor --checks permissions` is the cheap read-only gate a workflow runs before it starts, and it fails closed on drift.

## Isolation modes

`adw.yaml` records one mode under `execution.isolation`. Security is proportional; the hardened container is an opt-in, not a prerequisite.

| Mode | What it means |
|---|---|
| `provider-sandbox` | The lightweight option and the weaker boundary. The active agent's own sandbox and approval prompts are authoritative; ADW cannot attest host policy, and says so in `doctor`. |
| `project-devcontainer` | The project already owns `.devcontainer/devcontainer.json`. Init preserves it byte for byte and never converts it. Its runtime must set `ADW_PROJECT_DEVCONTAINER=1` (or run as a Codespace / Remote Containers session) for doctor to confirm it is active. |
| `managed-devcontainer` | The explicit opt-in to everything in the next section. Init refuses to select it over an existing project-owned `.devcontainer/`. |

The generated permission files are written in every mode, because the guardrails are useful without a container.

## Managed devcontainer

| Control | Detail |
|---|---|
| Non-root execution | `remoteUser: vscode`; the image removes `vscode` from `sudo` and drops `/etc/sudoers.d/vscode`, leaving only two narrowly scoped sudo entrypoints (firewall init, post-create). |
| Capabilities | `--cap-drop=ALL` plus exactly `CHOWN`, `KILL`, `SETUID`, `SETGID`, `NET_ADMIN`. No `SYS_ADMIN`, `SYS_PTRACE`, `NET_RAW`, and no unconfined seccomp or AppArmor profile. |
| Egress proxy | Root-installed at `127.0.0.1:18080`, running as the non-login system account `adw-egress`. `HTTP_PROXY` / `HTTPS_PROXY` point every client at it; the interactive user has no direct DNS or remote-network rule. It fails closed: no allowed domains means the firewall refuses to start. |
| Exact-domain CONNECT | An ordinary tunnel requires port 443, an exact hostname from the root-owned allowlist, and a TLS ClientHello whose SNI matches that hostname exactly. Wildcards and IP literals are not accepted; IPv6 egress is denied. |
| Git wrapper | `/usr/local/bin/git` is a root-owned `0555` script that rejects `--force`, `--force-with-lease`, `-f`, combined short flags containing `f`, `--mirror`, `--delete`, `-d`, and `+`/`:` push refspecs before exec'ing `/usr/bin/git`. |
| Credential volumes | Codex, Claude, and `gh` credentials live only in named volumes scoped to this devcontainer (`adw-codex-${devcontainerId}` and friends). |
| No host leakage | Nothing mounts the host home directory, `~/.ssh`, cloud credential directories, provider-wide config, or the Docker socket. `doctor` fails the `execution:unsafe-mounts` check if any appear. |
| Pinned agents | Codex CLI and Claude Code are installed at exact versions recorded in the managed marker; auto-update is disabled. |
| Startup ordering | `postCreateCommand` runs the firewall first, then post-create, then project setup, so dependency installation never precedes the deny-by-default network. `postStartCommand` re-arms the firewall on every start. |
| Drift detection | `.devcontainer/adw-managed.json` (schema 3) records SHA-256 digests of the allowlist, Codex rules, Git wrapper, Claude settings, Claude hook, egress proxy, generated project requirements, and project setup script, plus the plugin, Codex, and Claude Code versions. `adw:doctor` recomputes all of them. |

The allowlist and the proxy are baked root-owned into the image, so adding a domain is a reviewed infrastructure change: edit the committed file, rebuild, re-enter, rerun doctor. Never weaken the firewall or mount a host credential directory to make a transport work.

`NET_ADMIN` is still powerful inside the container's network namespace, and the root firewall entrypoint is trusted code. Keep the container runtime and host patched, and treat the container as defense in depth rather than a VM boundary. Nested bubblewrap availability varies by host; ADW does not weaken the outer container to make it available, so provider sandboxes must fail closed or fall back to permission prompts when nested namespaces are unavailable.

Run `npm run test:security` to build both pinned agents and exercise firewall setup, direct-egress denial, hostname denial, SNI mismatch denial, the constrained page-fetch path, and rejection of ordinary clients on that path. It requires Docker, `jq`, and ShellCheck.

### `web_access`

`execution.web_access` applies only to `managed-devcontainer`.

- `hosted-only` restricts the sandbox to managed domains. Choose it when the repository holds secrets that must never reach an arbitrary public site.
- `public-pages` (the default) additionally lets the proxy serve the distinctive absolute-form HTTPS `GET`/`HEAD` requests Claude's `WebFetch` uses. That path rejects URL credentials, IP-literal and private/reserved targets, resolves and pins a public IPv4 address, verifies the hostname in TLS, strips credentials and nonessential headers, forwards no request body, filters response headers, and caps time and response size.

`public-pages` is a deliberate exception to the exact-domain guarantee. The request shape is identifiable but not authenticated: code inside the container can imitate it and use the proxy for bounded public HTTPS reads, and a URL path or query can carry data outward. It is bound into the init preview, `adw.yaml`, the image build arguments, and the managed marker, so it is always a recorded choice.

## Filesystem and process safety

- Every managed write goes through one confined atomic-write path. It rejects absolute paths, `..` traversal, backslashes, NUL bytes, symlinked destinations, and symlinked ancestors; it re-resolves each path immediately before mutation; and it rolls the whole set back if any single write fails.
- Group worktrees are prepared only through the ADW CLI, which refuses symlinked or already-occupied targets, refuses a branch already checked out elsewhere, refuses a branch whose marker commit does not match this run, and refuses overlapping write paths between concurrent groups. It never deletes a branch or worktree.
- Validation commands come only from the project's own manifests and `adw.yaml`, each citing its source, and are shown before they run.
- Exit codes, timeouts, and signals are preserved. A failure is never translated into success.
- Read-only skills do not fetch, pull, write refs, change files, or alter worktrees.

## Credentials

- ADW has no telemetry and no hosted service.
- `adw.yaml` never holds credentials. Any key matching password, token, API key, secret, credential, authorization, cookie, or private key is rejected anywhere in the document, including inside provider `settings`.
- Credentials live in the provider, the MCP client, an authenticated CLI, or an external credential store — inside the managed container, in the project-scoped named volumes.
- Claude's `deny` list blocks reading `.env`, `.env.*`, and `~/.ssh/**`, and blocks `gh auth token`.
- Managed project setup runs package-manager commands, which can execute untrusted dependency and lifecycle code. Init previews only curated commands derived from recognized manifests and lockfiles, arms the firewall before setup, runs setup as the non-root user, and binds the generated requirements and script bytes into the marker digests. Review dependency changes and generated domains before approving. ADW never infers a secret value, runs a command copied from documentation, or converts an arbitrary package script body into container setup.
