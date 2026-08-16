# Integrations

External systems are optional. A project that declares no providers keeps the full local workflow; nothing is detected, probed, or contacted.

```text
skill -> capability -> provider -> transport -> external system
```

Skills ask for a capability, never for a tool name. That is what keeps the same instructions working across Codex and Claude Code, and across MCP servers, CLIs, and REST APIs.

## Capabilities

Every capability supports four provider-neutral operations: `read`, `create`, `update`, `link`.

| Capability | Providers with a reference | What the operations mean |
|---|---|---|
| `work_tracker` | Azure DevOps Boards, GitHub Issues | Read a work item; create a parent or child item; update its content; link items or a pull request |
| `code_host` | GitHub, Azure DevOps Repos | Read repository and pull-request state; create or update one draft pull request per branch; link related objects |
| `observability` | Datadog | `read` only — logs, metrics, traces, monitors, incidents, CI evidence. `create`, `update`, and `link` are unavailable regardless of what the credential could do |
| `knowledge` | Notion | Read documentation; publish or update a page only with separate authorization; link a page to the change |

Provider references live in `plugin/integrations/providers/` and are instructions for a skill to read, not code. Adding a provider such as Jira, Linear, Sentry, or Confluence means adding a reference document, not changing the workflow.

## Configuration

```yaml
providers:
  work_tracker:
    provider: azure-devops
    required: false
    transport: auto          # auto | native | mcp | cli | api
    access: read-only        # read-only | read-write
    domains:
      - dev.azure.com
    settings:
      organization: example
      project: platform
  code_host:
    provider: github
    domains:
      - api.github.com
```

| Field | Meaning |
|---|---|
| `provider` | Lowercase provider name. Required. |
| `required` | `false` (default): use the capability when available, continue locally when it is not. `true`: stop the relevant step when the capability or a needed operation is unavailable. |
| `transport` | Preferred transport, or `auto` to let the skill pick what the environment actually supports. |
| `access` | The access level the project intends. It is a declaration of intent, not an enforcement mechanism — the provider's own authorization is what enforces. |
| `domains` | Plain lowercase hostnames. These are validated and fed straight into the managed container's egress allowlist. |
| `settings` | Non-secret provider-specific values. This is the only place unknown keys are accepted, and credential-like keys are still refused. |

Omit a capability entirely and it is not used. Omit `providers:` and the lightweight local path is all you get.

**Credentials never appear in `adw.yaml`.** Any key matching password, token, API key, secret, credential, authorization, cookie, or private key is rejected anywhere in the file, including inside `settings`. Credentials belong to the provider, the MCP client, an authenticated CLI, or an external credential store — and inside the managed container, to the project-scoped named volumes.

## Transports

A skill may use a native connected tool, an MCP server, an authenticated CLI, or a direct API, preferred in that order unless `transport` names one. It detects which operations and access level are actually available instead of assuming a configured server can do everything.

In `managed-devcontainer` mode a transport also needs its exact hostnames in `.devcontainer/allowed-domains.txt`. That file is generated from the configured `domains` and baked root-owned into the image, so adding a domain is a reviewed change: edit `adw.yaml`, run `adw:doctor` to preview and apply the managed-file repair, commit, rebuild the image, re-enter the container, and rerun doctor. Never weaken the firewall or mount a host credential directory to make a transport work.

Azure DevOps supports `work_tracker` through Boards and `code_host` through Repos. [Microsoft currently documents](https://learn.microsoft.com/en-us/azure/devops/mcp-server/remote-mcp-server-troubleshooting?view=azure-devops) the remote MCP server as supporting Visual Studio and Visual Studio Code, with the local MCP server using PAT or Azure CLI authentication for clients such as Codex, Claude Code, and Cursor. ADW therefore permits local MCP, authenticated CLI, or REST fallback under the same capability contract.

## Reads are the default; writes are not

Read-only provider operations within a configured capability run without a fresh prompt. Every mutation — a tracker item, a pull request, a knowledge page — follows the same protocol:

1. Read the current target state and confirm the capability actually grants the operation.
2. Show the exact provider, target, operation, and redacted payload, including whether a retry could duplicate something.
3. Get fresh explicit authorization for that exact mutation, or for that enumerated batch.
4. Search for an idempotency marker before creating, and use one when the provider permits it.
5. Perform only the authorized operation and read the result back.
6. Report the stable id and canonical URL in the conversation.

There are no run-record receipts. ADW does not maintain a second database of what it did beside Git and the providers themselves — the pull request, the tracker item, and the commit are the record. An organization needing richer audit evidence can add it in its own tooling.

Confirming a plan authorizes local implementation. It does not authorize any later external write. Authentication proves capability, never intent.

ADW never merges a pull request, marks one ready, publishes a release, publishes a package, deploys, or applies infrastructure. It never closes, resolves, or transitions a tracker item to a terminal state, because merge and deployment are outside its scope.

## Drift

External requirement drift is a judgment call made during plan review and the execution scope check, not a digest comparison. If a tracker item's accepted behavior changed materially while the work was in flight, stop and re-plan. A changed assignee, state, iteration, comment, or check status is operational and changes nothing. Observability results are evidence, never requirements.

## The runner boundary

ADW does not receive webhooks, schedule work, start sessions, or post messages. A system that connects monitor events to agent sessions owns event verification, repository routing, deduplication, rate limits, credentials, retention, and delivery authorization. `adw:investigate` consumes a stable reference that such a system supplies; it does not trust the notification text around it.
