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

For a newly initialized project, review and commit `.devcontainer/`, then rebuild and reopen it with a Dev Containers client. Codex CLI and Claude Code CLI are pinned in the image; authenticate them inside their project-scoped named volumes, install ADW from the approved source inside the container, and run `adw:doctor`. Existing project-owned containers are preserved and must provide `ADW_PROJECT_DEVCONTAINER=1` in their active runtime.

External provider tooling is installed and authenticated separately. ADW does not install MCP servers, CLIs, or credentials as part of plugin installation. Projects without integrations need none of them.

## Tagged private repository

Push and tag only through the repository owner's normal release process. Users with read access can register the private Git source at a pinned tag or commit using each provider's marketplace command, then install `adw@adw-local`. Provider authentication must use existing Git credential mechanisms; never paste tokens into ADW configuration.

For rollback, point the marketplace at the last-known-good tag, update the marketplace snapshot, reinstall the plugin, and start a new session. Do not run `adw:update` for a plugin-only rollback.

## Organization-private distribution

Mirror or transfer this repository into the private organization, grant the intended users read access, and register the same marketplace with approved users or groups. Claude installations may use project or managed settings when organization policy requires them. Codex workspace sharing should keep the plugin restricted to the selected workspace users/groups.

Organization policy and marketplace allowlists override these instructions. ADW does not start authentication, widen repository or external-system access, or publish itself. Grant provider tools only the operations required by each configured capability; use read-only access for observability by default.

## Verification

After install, invoke `adw:doctor`. It should report provider namespace `adw`, plugin version, project-schema compatibility, bundled resource resolution, routing blocks, ignore rules, docs worktree state, and optional integrations without writing or starting authentication. For each integration it reports requirement mode, provider, selected transport, supported operations, and read/write level.

Azure DevOps work tracking may use a native connector, MCP, Azure CLI, or REST adapter. [Microsoft currently directs](https://learn.microsoft.com/en-us/azure/devops/mcp-server/remote-mcp-server-troubleshooting?view=azure-devops) Codex, Claude Code, and Cursor users to its local MCP server because the remote server supports only Visual Studio and Visual Studio Code. Do not make remote MCP availability a prerequisite; configure local MCP with PAT/Azure CLI authentication or another authenticated CLI/API fallback when ADO is required. Keep organization, project, and repository identifiers in `adw.yaml`, machine-local transport choice in ignored `.adw/local.yaml`, and all credentials outside the repository.
