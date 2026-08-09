export interface CompatibilityInput {
  project_schema: number;
  plugin_version: string;
  artifact_plugin_version?: string;
}

export interface CompatibilityResult {
  compatible: boolean;
  migration_required: boolean;
  reason: string;
}

function major(version: string): number | undefined {
  const match = /^(\d+)\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.exec(version);
  return match ? Number(match[1]) : undefined;
}

export const CURRENT_PROJECT_SCHEMA = 5;

export function checkCompatibility(input: CompatibilityInput): CompatibilityResult {
  const installedMajor = major(input.plugin_version);
  if (installedMajor === undefined) return { compatible: false, migration_required: false, reason: "plugin_version must be semantic version x.y.z" };
  if (!Number.isInteger(input.project_schema) || input.project_schema < 1) return { compatible: false, migration_required: false, reason: "project_schema must be a positive integer" };
  if (input.project_schema !== CURRENT_PROJECT_SCHEMA) {
    return { compatible: false, migration_required: false, reason: `project schema ${input.project_schema} is not supported; this ADW release accepts only schema ${CURRENT_PROJECT_SCHEMA}` };
  }
  if (input.artifact_plugin_version !== undefined) {
    const artifactMajor = major(input.artifact_plugin_version);
    if (artifactMajor === undefined) return { compatible: false, migration_required: false, reason: "artifact_plugin_version must be semantic version x.y.z" };
    if (artifactMajor > installedMajor) return { compatible: false, migration_required: false, reason: `artifact requires plugin major ${artifactMajor}, installed major is ${installedMajor}` };
  }
  return { compatible: true, migration_required: false, reason: "project artifacts are compatible" };
}
