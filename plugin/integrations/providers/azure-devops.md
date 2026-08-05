# Azure DevOps provider

Use Azure DevOps primarily for the `work_tracker` capability. Azure Repos may implement `code_host` in a future adapter; do not assume GitHub-shaped operations work for it.

Require configured organization and project identifiers. Resolve transport independently: use an available native connector, MCP server, authenticated `az boards` CLI plus its extension, or Azure DevOps REST API. Do not install the Azure CLI extension, request a PAT, authenticate, or persist credentials during an ADW workflow.

Normalize requirement-bearing work-item fields to stable names such as `title`, `description`, and `acceptance_criteria`, plus any project-configured business fields. Treat `System.State`, `System.AssignedTo`, iteration, area, revision, timestamps, comments, relations, and PR/build links as operational unless the specification explicitly says otherwise. Preserve provider HTML semantically when normalizing rich-text fields and avoid hashing provider-generated formatting noise.

For creation, show the organization, project, work-item type, parent when any, exact field values, tags, and relations. Use the ADW idempotency key as a searchable marker or tag and query it before creating. Read back the work-item id, canonical URL, revision, and material fields. For updates, show an exact field/JSON-patch preview and reject revision conflicts rather than overwriting concurrent edits.

Support read/search, creation, requirement-field update, state transition, comment, parent/child relation, and PR link only when the chosen transport exposes them safely. Never resolve or close a story automatically. Bindings record canonical requirement field names and a digest of their normalized values, not full work-item bodies; receipts contain only digests and summaries, not unrestricted corporate content.
