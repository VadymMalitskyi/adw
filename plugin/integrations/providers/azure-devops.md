# Azure DevOps provider

Use Azure Boards for the `work_tracker` capability and Azure Repos for the `code_host` capability. Keep their provider-native operations distinct; do not assume GitHub-shaped fields or commands work for Azure Repos.

Require configured organization and project identifiers, plus a repository identifier for `code_host`. Resolve transport independently through an MCP server, authenticated `az boards`/`az repos` CLI plus its extension, or Azure DevOps REST API. Do not install the Azure CLI extension, request a PAT, authenticate, or persist credentials during an ADW workflow.

Normalize requirement-bearing work-item fields to stable names such as `title`, `description`, and `acceptance_criteria`, plus any project-configured business fields. Treat `System.State`, `System.AssignedTo`, iteration, area, revision, timestamps, comments, relations, and PR/build links as operational unless the specification explicitly says otherwise. Preserve provider HTML semantically when normalizing rich-text fields and avoid hashing provider-generated formatting noise.

For creation, show the organization, project, work-item type, parent when any, exact field values, tags, and relations. Use the ADW idempotency key as a searchable marker or tag and query it before creating. Read back the work-item id, canonical URL, revision, and material fields. For updates, show an exact field/JSON-patch preview and reject revision conflicts rather than overwriting concurrent edits.

Support read/search, creation, requirement-field update, state transition, comment, parent/child relation, and PR link only when the chosen transport exposes them safely. Never resolve or close a story automatically. Bindings record canonical requirement field names and a digest of their normalized values, not full work-item bodies; receipts contain only digests and summaries, not unrestricted corporate content.

For `code_host`, support bounded repository and pull-request reads plus creation or update of one draft pull request for the exact local branch. Preview provider-native repository, source branch, target branch, title, description, draft state, reviewers, and work-item links before mutation. Reuse an existing pull request for the same repository and source branch, read it back after mutation, and never complete, abandon, approve, merge, or bypass branch policies.
