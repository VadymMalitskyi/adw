# Private installation

## Local personal development

Use absolute paths so provider configuration does not depend on the current directory:

```bash
codex plugin marketplace add /absolute/path/to/adw
codex plugin add adw@adw-local

claude plugin marketplace add /absolute/path/to/adw
claude plugin install adw@adw-local --scope user
```

Start a new session after installation or update so the provider reloads skill metadata. The plugin is installed into provider-managed storage; do not copy `plugin/` into a target project.

In the target directory, invoke `adw:init`. It works in an empty directory, an unborn repository, or an established one. Review the preview, say yes, then review and commit the generated files like any other change — init writes them but does not commit.

If you selected `managed-devcontainer`, commit the generated `.devcontainer/`, then rebuild and reopen with a Dev Containers client. Codex CLI and Claude Code CLI are pinned in the image, and project runtimes plus manifest-backed dependencies install automatically at create time. Authenticate each tool inside its project-scoped named volume when first used. An existing project-owned container is preserved untouched and must provide `ADW_PROJECT_DEVCONTAINER=1` in its active runtime for `adw:doctor` to confirm it.

For another person joining the project: clone the already initialized repository, rebuild and reopen its configured container, install ADW from the same approved source, authenticate the selected tools, and invoke `adw:onboard`. Onboarding writes nothing. Do not rerun `adw:init` for each contributor — it refuses to run once `adw.yaml` exists.

External provider tooling is installed and authenticated separately. ADW does not install MCP servers, CLIs, or credentials as part of plugin installation. Projects without integrations need none of them.

## Tagged private repository

Push and tag only through the repository owner's normal release process. Users with read access can register the private Git source at a pinned tag or commit using each provider's marketplace command, then install `adw@adw-local`. Provider authentication must use existing Git credential mechanisms; never paste tokens into ADW configuration.

For rollback, point the marketplace at the last-known-good tag, update the marketplace snapshot, reinstall the plugin, and start a new session. A plugin-only rollback needs no managed-file repair unless `adw:doctor` reports drift.

## Organization-private distribution

Mirror or transfer this repository into the private organization, grant the intended users read access, and register the same marketplace with approved users or groups. Claude installations may use project or managed settings when organization policy requires them. Codex workspace sharing should keep the plugin restricted to the selected workspace users and groups.

Organization policy and marketplace allowlists override these instructions. ADW does not start authentication, widen repository or external-system access, or publish itself. Grant provider tools only the operations required by each configured capability; use read-only access for observability by default.

## Verification

After install, invoke `adw:doctor`. Its diagnostic pass writes nothing and starts no authentication. It reports:

- that both provider manifests agree on the namespace `adw` and the plugin version;
- that the project root is a Git repository and `adw.yaml` matches the `adw: 1` contract;
- that component paths are unambiguous;
- that the `managed-development` permission files are present and byte-current for both providers;
- that the configured isolation mode is actually the active runtime, and — for `managed-devcontainer` — that every generated file still matches the digests in `.devcontainer/adw-managed.json`;
- that `worktrees/` is ignored;
- each configured provider, its requirement mode, and its transport, followed by the live availability and authentication checks the skill performs with real provider commands.

A failing check exits non-zero and carries its details; `adw doctor --checks permissions` runs the cheap policy-only subset.

When generated permission, ignore, or managed-container files have drifted,
doctor shows the exact repair set and asks before applying it. Configuration,
credentials, application files, and project-owned containers are never repaired
implicitly.

Azure DevOps work tracking may use MCP, Azure CLI, or a REST adapter. [Microsoft currently directs](https://learn.microsoft.com/en-us/azure/devops/mcp-server/remote-mcp-server-troubleshooting?view=azure-devops) Codex, Claude Code, and Cursor users to its local MCP server, because the remote server supports only Visual Studio and Visual Studio Code. Do not make remote MCP availability a prerequisite. Keep organization, project, and repository identifiers in `adw.yaml` under the provider's `settings`, and all credentials outside the repository.
