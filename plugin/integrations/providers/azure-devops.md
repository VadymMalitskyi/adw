# Azure DevOps provider

Use Azure Boards for the `work_tracker` capability and Azure Repos for the `code_host` capability. Keep their provider-native operations distinct; do not assume GitHub-shaped fields or commands work for Azure Repos.

Require configured `organization` and `project` settings, plus a `repository` setting for `code_host`. Resolve transport independently through an MCP server, an authenticated `az boards`/`az repos` CLI plus its extension, or the Azure DevOps REST API. Do not install the CLI extension, request a PAT, authenticate, or persist credentials during an ADW workflow.

## work_tracker defaults

Default object types are a **Feature** for the plan's parent item and a **User Story** for each execution group's child item. A project may override them with the optional `hierarchy` setting (for example `feature-story` or `epic-feature`); ADW ships no field manifest and never templates arbitrary business fields.

Map the shared operations as follows:

- `read`: query by work-item id, canonical URL, or the ADW idempotency marker.
- `create`: show organization, project, work-item type, parent when any, title, description, and tags. Carry the idempotency marker as a tag, and query for it before creating.
- `update`: show an exact field or JSON-patch preview and reject revision conflicts rather than overwriting concurrent edits.
- `link`: create a parent/child relation or attach a pull-request link.

Read back the work-item id, canonical URL, revision, and material fields; record only the id, URL, and a concise outcome. `System.AssignedTo`, iteration, area, revision, timestamps, comments, and relations are operational detail and never enter ADW artifacts as requirements.

Move a group's story by writing `System.State` exactly once, from not started to in progress. The Agile process defaults are `New` and `Active`. Process templates differ, so read the type's real state transitions before that write and stop if `Active` is not reachable rather than forcing it. The optional `states` setting maps those two neutral states onto the project's own names. ADW sets no state after in progress, and never moves a story to `Resolved`, `Closed`, `Done`, or `Removed`.

## code_host defaults

Support bounded repository and pull-request reads plus creation or update of one draft pull request per group branch or one integration branch. Preview provider-native repository, source branch, target branch, title, description, draft state, reviewers, and work-item links before mutation. Reuse an existing pull request for the same repository and source branch, read it back after mutation, and never complete, abandon, approve, merge, or bypass branch policies.
