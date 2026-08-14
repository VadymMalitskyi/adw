import { readFileSync } from "node:fs";
import { join } from "node:path";

export const CAPABILITIES = ["work_tracker", "code_host", "observability", "knowledge"];

const CAPABILITY_SET = new Set(CAPABILITIES);
const TRANSPORTS = new Set(["auto", "native", "mcp", "cli", "api"]);
const SECRET_LIKE_KEY = /(?:password|passwd|token|api[_-]?key|secret|credential|authorization|cookie|private[_-]?key)/i;

function fail(path, message) {
  throw new Error(`${path}: ${message}`);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function object(value, path) {
  if (!isObject(value)) fail(path, "must be an object");
  return value;
}

function rejectUnknown(value, allowed, path) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${path}.${key}`, "is not supported");
}

function rejectSecretLikeKeys(value, path) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectSecretLikeKeys(item, `${path}[${index}]`));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    if (SECRET_LIKE_KEY.test(key)) fail(`${path}.${key}`, "credential-like keys are forbidden; keep credentials in provider clients or credential stores");
    rejectSecretLikeKeys(nested, `${path}.${key}`);
  }
}

function enumValue(value, allowed, path) {
  if (typeof value !== "string" || !allowed.has(value)) fail(path, `must be one of: ${[...allowed].join(", ")}`);
  return value;
}

function singleLine(value, path, maximum = 320) {
  if (typeof value !== "string" || value.length === 0) fail(path, "must be a non-empty string");
  if (value.length > maximum) fail(path, `must be at most ${maximum} characters`);
  if (/[\u0000-\u001f\u007f]/.test(value)) fail(path, "must be a single-line string without control characters");
  return value;
}

function sortedObject(value) {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

function readProviderRegistry(pluginRoot) {
  if (typeof pluginRoot !== "string" || pluginRoot.length === 0) fail("pluginRoot", "is required");
  const path = join(pluginRoot, "integrations/providers.json");
  let registry;
  try {
    registry = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`cannot read provider registry ${path}: ${error.message}`);
  }
  if (registry?.schema !== 1 || !Array.isArray(registry.providers)) throw new Error(`invalid provider registry: ${path}`);
  const providers = new Map();
  for (const entry of registry.providers) {
    if (!isObject(entry) || typeof entry.provider !== "string" || !Array.isArray(entry.capabilities) || !Array.isArray(entry.transports)) {
      throw new Error(`invalid provider entry in ${path}`);
    }
    providers.set(entry.provider, {
      capabilities: new Set(entry.capabilities),
      transports: new Set(entry.transports),
    });
  }
  return providers;
}

// `sharedProviders` is the project's `providers:` block: one entry per
// configured capability, each with a provider name and an optional `required`
// flag. A capability the project did not configure has no entry at all.
export function normalizeLocalConfiguration(value, sharedProviders, pluginRoot, path = "local") {
  const normalized = { identity: {}, providers: {} };
  if (value === undefined) return normalized;
  value = object(value, path);
  rejectSecretLikeKeys(value, path);
  rejectUnknown(value, new Set(["identity", "providers"]), path);
  const configured = isObject(sharedProviders) ? sharedProviders : {};
  const registry = readProviderRegistry(pluginRoot);

  if (value.identity !== undefined) {
    const identity = object(value.identity, `${path}.identity`);
    rejectUnknown(identity, new Set(["display_name", "email", "work_tracker_account"]), `${path}.identity`);
    for (const field of ["display_name", "email", "work_tracker_account"]) {
      if (identity[field] !== undefined) normalized.identity[field] = singleLine(identity[field], `${path}.identity.${field}`);
    }
  }

  if (value.providers !== undefined) {
    const localProviders = object(value.providers, `${path}.providers`);
    for (const [capability, raw] of Object.entries(localProviders)) {
      if (!CAPABILITY_SET.has(capability)) fail(`${path}.providers.${capability}`, "is not a known capability");
      const itemPath = `${path}.providers.${capability}`;
      const local = object(raw, itemPath);
      rejectUnknown(local, new Set(["transport", "account"]), itemPath);
      const shared = configured[capability];
      if (!shared) fail(itemPath, `requires a configured ${capability} provider`);
      const provider = registry.get(shared.provider);
      if (!provider || !provider.capabilities.has(capability)) fail(itemPath, `project provider ${shared.provider ?? "<missing>"} does not support ${capability}`);
      const item = {};
      if (local.transport !== undefined) {
        item.transport = enumValue(local.transport, TRANSPORTS, `${itemPath}.transport`);
        if (item.transport !== "auto" && !provider.transports.has(item.transport)) {
          fail(`${itemPath}.transport`, `${shared.provider} does not support ${item.transport}`);
        }
      }
      if (local.account !== undefined) item.account = singleLine(local.account, `${itemPath}.account`);
      if (Object.keys(item).length === 0) fail(itemPath, "must select a transport or account");
      normalized.providers[capability] = item;
    }
    normalized.providers = sortedObject(normalized.providers);
  }
  return normalized;
}

export function loadLocalAnswers(path, sharedProviders, pluginRoot) {
  if (typeof path !== "string" || path.length === 0) throw new Error("--answers is required");
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`cannot read local onboarding answers ${path}: ${error.message}`);
  }
  raw = object(raw, "onboarding");
  rejectSecretLikeKeys(raw, "onboarding");
  rejectUnknown(raw, new Set(["schema", "identity", "providers"]), "onboarding");
  if (raw.schema !== 1) fail("onboarding.schema", "must equal 1");
  return normalizeLocalConfiguration({ identity: raw.identity, providers: raw.providers }, sharedProviders, pluginRoot, "onboarding");
}

function yamlScalar(value) {
  return JSON.stringify(String(value));
}

export function renderLocalConfiguration(local) {
  const identity = local?.identity ?? {};
  const providers = local?.providers ?? {};
  const lines = [
    "# Machine-local ADW settings. This file is ignored by Git.",
    "# Credentials belong in provider clients or credential stores, never here.",
    "schema: 1",
  ];
  const identityFields = ["display_name", "email", "work_tracker_account"].filter((field) => identity[field] !== undefined);
  if (identityFields.length > 0) {
    lines.push("", "identity:");
    for (const field of identityFields) lines.push(`  ${field}: ${yamlScalar(identity[field])}`);
  }
  const capabilities = CAPABILITIES.filter((capability) => providers[capability] !== undefined);
  if (capabilities.length > 0) {
    lines.push("", "providers:");
    for (const capability of capabilities) {
      lines.push(`  ${capability}:`);
      if (providers[capability].transport !== undefined) lines.push(`    transport: ${yamlScalar(providers[capability].transport)}`);
      if (providers[capability].account !== undefined) lines.push(`    account: ${yamlScalar(providers[capability].account)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function localConfigurationSummary(local) {
  const providers = {};
  for (const capability of CAPABILITIES) {
    if (local?.providers?.[capability]) providers[capability] = Object.keys(local.providers[capability]).sort();
  }
  return {
    identity_fields: Object.keys(local?.identity ?? {}).sort(),
    providers,
  };
}
