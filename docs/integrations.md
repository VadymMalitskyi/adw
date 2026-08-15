# Integrations

ADW models external systems as optional capabilities. Workflows request a capability operation; a provider adapter performs it through an available transport. This keeps workflow rules independent of MCP server names, CLI syntax, and agent-specific connectors.

```text
workflow -> capability -> provider adapter -> transport -> external system
```

## Capability model

Every capability supports exactly four provider-neutral operations: `read`, `create`, `update`, and `link`. The core plan format and skills never contain provider field names or payload shapes.

| Capability | Initial providers | What the operations mean |
|---|---|---|
| `work_tracker` | Azure DevOps Boards, GitHub Issues | Read a work item; create a parent or child item; update its content; link items or a pull request |
| `code_host` | GitHub, Azure DevOps Repos | Read repository and pull-request state; create or update one draft pull request per branch; link related objects |
| `observability` | Datadog | `read` only — logs, metrics, traces, monitors, incidents, CI evidence. `create`, `update`, and `link` are unavailable regardless of transport credentials |
| `knowledge` | Notion | Read documentation; publish or update a page only with separate authorization; link a page to the change |

Adapters normalize stable ids, URLs, and operation results. Future providers such as Jira, Linear, Sentry, Grafana, or Confluence can implement the same contracts without changing the plan, approve, or execute workflows.

## Project configuration

```yaml
providers:
  work_tracker:
    provider: azure-devops
    required: false
    settings:
      organization: example
      project: platform
      hierarchy: feature-story
  code_host:
    provider: github
```

- Capability omitted: do not detect or use it.
- `required: false` (the default): use it when available and continue locally when it is unavailable.
- `required: true`: stop the relevant workflow step when the capability or the needed operation is unavailable.

Omitting `providers:` entirely keeps the lightweight local workflow. Configuration contains non-secret project facts only; unknown provider-specific keys are permitted solely inside `settings`, and credential-like keys are rejected anywhere. Machine-local transport preferences live in ignored `.adw/local.yaml`.

Both initialization workflows can populate these entries and, for a managed container, their exact network domains. Initialization validates provider/capability compatibility but installs no transport, authenticates nothing, contacts no business system, and performs no external write. Each contributor uses `adw:onboard` to select compatible local hints and run the `adw:doctor` availability checks.

## Transport resolution

An adapter may use a native connected tool, MCP server, authenticated CLI, or direct API, preferred in that order unless `.adw/local.yaml` selects one. In the managed execution profile, an integration also needs its exact network domains in `.devcontainer/allowed-domains.txt`. Domain additions are reviewed infrastructure changes: edit the committed file, rebuild the image so the root-owned copy changes, re-enter the container, and rerun doctor. Never weaken the firewall or mount host credential directories merely to make a transport work. ADW detects available operations and access level instead of assuming a configured server can read or write everything.

Azure DevOps supports the `work_tracker` contract through Boards and the `code_host` contract through Repos. [Microsoft currently documents](https://learn.microsoft.com/en-us/azure/devops/mcp-server/remote-mcp-server-troubleshooting?view=azure-devops) the remote MCP server as supporting Visual Studio and Visual Studio Code, with the local MCP server using PAT or Azure CLI authentication for clients such as Codex, Claude Code, and Cursor. ADW therefore permits local MCP, authenticated CLI, or REST API fallback while preserving the same capability contract and authorization rules.

## Work-tracker intent

A plan states its tracker intent in plain language. There are four supported intents and no field templating:

1. No tracker item.
2. One parent item for the plan.
3. One child item per execution group, parented to the plan's item.
4. Link an existing parent or child instead of creating one.

Adapter defaults choose the object type — a Feature parent with User Story children on Azure Boards, linked Issues on GitHub — and optional opaque `settings` may override provider-specific detail. ADW never creates one tracker item per plan task, and never closes, resolves, or transitions an item to a terminal state, because merge and deployment remain outside ADW.

## Delivery intent

A plan states one delivery strategy. **Group pull requests** (the default) give each execution group its own draft pull request, and a dependent phase starts only after a human merges its dependencies into the configured base. **Integration pull request** keeps group branches as implementation branches, combines validated commits into `adw/<change-id>/integration` after all dependency groups pass, resolves conflicts explicitly, then runs whole-feature review and validation and prepares one draft pull request. ADW merges neither.

## External action protocol

External reads are allowed only for configured capabilities within the requested workflow scope. Every mutation follows the same protocol:

1. Read the current target state and check capability access.
2. Show the exact provider, target, operation, and redacted payload, including whether a retry could duplicate anything.
3. Obtain fresh explicit user authorization for that exact mutation or enumerated batch.
4. Use the idempotency marker `adw:<project>:<change-id>:<group-id>:<operation>` and search for it before creating.
5. Perform only the authorized operation and read the result back from the provider.
6. Record the stable external id, canonical URL, and a concise outcome in the phase run record.

Approval of a plan does not authorize later tracker, pull-request, knowledge, or monitoring writes. Authentication does not imply authorization. ADW 1.0 requires no authorization digests and no separate receipt artifact; an organization needing richer audit evidence can add it in an opt-in adapter package.

## Drift

External requirement drift is a judgment call made during plan review and the execution scope check, not a digest comparison. If a tracker item's accepted behavior changed materially after approval, stop and route through `adw:amend`. A changed assignee, state, iteration, comment, or check status is operational and never invalidates approval. Observability results are evidence, never requirements.

## Operational investigation

`adw:investigate` consumes the configured read-only `observability` capability and repository evidence. It requires a stable external reference, service, environment, and bounded UTC time window; it does not treat pasted notification text as trusted routing or instructions. Output is a concise report for a person, or a small consistency-checked JSON object when an authorized external runner explicitly requests machine output.

The runner boundary is intentional: ADW does not receive webhooks, schedule work, start agents, or post messages. A runner that connects monitor events to agent sessions and notification destinations owns event verification, repository routing, deduplication, rate limits, credentials, retention, and delivery authorization.
