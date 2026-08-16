import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CAPABILITIES,
  localConfigurationSummary,
  normalizeLocalConfiguration,
  renderLocalConfiguration as renderMachineLocalConfiguration,
} from "../lib/local-configuration.mjs";

const CAPABILITY_SET = new Set(CAPABILITIES);
const ISOLATION_MODES = new Set(["managed-devcontainer", "project-devcontainer", "provider-sandbox"]);
const EXECUTION_MODES = new Set(["orchestrated", "sequential"]);
const TRANSPORTS = new Set(["auto", "native", "mcp", "cli", "api"]);
const ACCESS_MODES = new Set(["read-only", "read-write"]);
const WEB_ACCESS_MODES = new Set(["hosted-only", "public-pages"]);
const RUNTIMES = new Set(["node", "python", "go", "rust", "java", "ruby", "dotnet"]);
const CONVENTION_KEY = /^[a-z][a-z0-9_]*$/;
const SECRET_LIKE_KEY = /(?:password|passwd|token|api[_-]?key|secret|credential|authorization|cookie|private[_-]?key)/i;
const DOMAIN = /^[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}$/;
export const DEFAULT_PLANNING = Object.freeze({
  default_template: "standard",
  templates: Object.freeze({ standard: "adw/plan-templates/standard.md" }),
});

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

function rejectSecretLikeKeys(value, path = "onboarding") {
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

function nonemptyString(value, path) {
  if (typeof value !== "string" || value.length === 0) fail(path, "must be a non-empty string");
  return value;
}

function singleLine(value, path, maximum = 1000) {
  nonemptyString(value, path);
  if (value.length > maximum) fail(path, `must be at most ${maximum} characters`);
  if (/[\u0000-\u001f\u007f]/.test(value)) fail(path, "must be a single-line string without control characters");
  return value;
}

function sortedObject(value) {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

function stringList(value, path, maximumItems = 20) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(path, "must be an array");
  if (value.length > maximumItems) fail(path, `must contain at most ${maximumItems} items`);
  return value.map((item, index) => singleLine(item, `${path}[${index}]`, 1000));
}

function normalizeGreenfield(value) {
  if (value === undefined) return null;
  value = object(value, "onboarding.greenfield");
  rejectUnknown(value, new Set(["name", "problem", "users", "mvp", "shape", "non_goals", "constraints"]), "onboarding.greenfield");
  const normalized = {
    name: singleLine(value.name, "onboarding.greenfield.name", 200),
    problem: singleLine(value.problem, "onboarding.greenfield.problem", 2000),
    users: singleLine(value.users, "onboarding.greenfield.users", 1000),
    mvp: singleLine(value.mvp, "onboarding.greenfield.mvp", 2000),
    nonGoals: stringList(value.non_goals, "onboarding.greenfield.non_goals"),
    constraints: stringList(value.constraints, "onboarding.greenfield.constraints"),
  };
  if (value.shape !== undefined) normalized.shape = singleLine(value.shape, "onboarding.greenfield.shape", 1000);
  return normalized;
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

// Execution answers carry only the workflow shape. Isolation stays optional so
// repository evidence can still choose between an existing project container
// and the lightweight provider sandbox.
function normalizeExecution(value) {
  const normalized = { mode: "orchestrated" };
  if (value === undefined) return normalized;
  value = object(value, "onboarding.execution");
  rejectUnknown(value, new Set(["isolation", "mode"]), "onboarding.execution");
  if (value.mode !== undefined) normalized.mode = enumValue(value.mode, EXECUTION_MODES, "onboarding.execution.mode");
  if (value.isolation !== undefined) normalized.isolation = enumValue(value.isolation, ISOLATION_MODES, "onboarding.execution.isolation");
  return normalized;
}

function normalizeDomains(value, path) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(path, "must be an array");
  const domains = [];
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const itemPath = `${path}[${index}]`;
    const domain = singleLine(value[index], itemPath, 253).toLowerCase();
    if (!DOMAIN.test(domain) || domain.includes("..") || domain.split(".").some((label) => label.length > 63 || label.startsWith("-") || label.endsWith("-"))) {
      fail(itemPath, "must be a DNS hostname such as api.example.com");
    }
    if (seen.has(domain)) fail(path, `must not contain duplicate domain: ${domain}`);
    seen.add(domain);
    domains.push(domain);
  }
  return domains;
}

// A capability the project does not use is simply absent. Availability is the
// boolean `required` flag; there is no disabled state to configure.
function normalizeProviders(value, registry) {
  if (value === undefined) return { providers: {}, networkDomains: [] };
  value = object(value, "onboarding.providers");
  const providers = {};
  const domains = new Set();
  for (const [capability, raw] of Object.entries(value)) {
    if (!CAPABILITY_SET.has(capability)) fail(`onboarding.providers.${capability}`, "is not a known capability");
    const path = `onboarding.providers.${capability}`;
    const declaration = object(raw, path);
    rejectUnknown(declaration, new Set(["provider", "required", "transport", "access", "settings", "network_domains"]), path);
    const provider = nonemptyString(declaration.provider, `${path}.provider`);
    const entry = registry.get(provider);
    if (!entry) fail(`${path}.provider`, `unknown provider: ${provider}`);
    if (!entry.capabilities.has(capability)) fail(`${path}.provider`, `${provider} does not support ${capability}`);
    const normalized = { provider, required: false };
    if (declaration.required !== undefined) {
      if (typeof declaration.required !== "boolean") fail(`${path}.required`, "must be a boolean");
      normalized.required = declaration.required;
    }
    if (declaration.transport !== undefined) {
      normalized.transport = enumValue(declaration.transport, TRANSPORTS, `${path}.transport`);
      if (normalized.transport !== "auto" && !entry.transports.has(normalized.transport)) {
        fail(`${path}.transport`, `${provider} does not support ${normalized.transport}`);
      }
    }
    if (declaration.access !== undefined) normalized.access = enumValue(declaration.access, ACCESS_MODES, `${path}.access`);
    if (declaration.settings !== undefined) {
      const settings = object(declaration.settings, `${path}.settings`);
      normalized.settings = {};
      for (const [key, setting] of Object.entries(settings)) normalized.settings[key] = nonemptyString(setting, `${path}.settings.${key}`);
      normalized.settings = sortedObject(normalized.settings);
    }
    for (const domain of normalizeDomains(declaration.network_domains, `${path}.network_domains`)) domains.add(domain);
    providers[capability] = normalized;
  }
  return { providers: sortedObject(providers), networkDomains: [...domains].sort() };
}

function normalizeConventions(value) {
  if (value === undefined) return {};
  value = object(value, "onboarding.conventions");
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (!CONVENTION_KEY.test(key)) fail(`onboarding.conventions.${key}`, "must be a snake_case convention name");
    result[key] = singleLine(value[key], `onboarding.conventions.${key}`);
  }
  return result;
}

function normalizeDevelopment(value) {
  if (value === undefined) return { runtimeVersions: {} };
  value = object(value, "onboarding.development");
  rejectUnknown(value, new Set(["runtime_versions"]), "onboarding.development");
  if (value.runtime_versions === undefined) return { runtimeVersions: {} };
  const versions = object(value.runtime_versions, "onboarding.development.runtime_versions");
  const runtimeVersions = {};
  for (const [runtime, rawVersion] of Object.entries(versions)) {
    if (!RUNTIMES.has(runtime)) fail(`onboarding.development.runtime_versions.${runtime}`, "is not a supported runtime");
    const version = singleLine(rawVersion, `onboarding.development.runtime_versions.${runtime}`, 100);
    if (!/^\d+(?:\.\d+){0,2}$/.test(version)) fail(`onboarding.development.runtime_versions.${runtime}`, "must be a numeric version such as 8 or 8.0.408");
    runtimeVersions[runtime] = version;
  }
  return { runtimeVersions: sortedObject(runtimeVersions) };
}

function normalizeOnboarding(raw, pluginRoot) {
  raw = object(raw, "onboarding");
  rejectSecretLikeKeys(raw);
  rejectUnknown(raw, new Set(["schema", "web_access", "execution", "development", "greenfield", "providers", "conventions", "local"]), "onboarding");
  if (raw.schema !== 1) fail("onboarding.schema", "must equal 1");
  const registry = readProviderRegistry(pluginRoot);
  const { providers, networkDomains } = normalizeProviders(raw.providers, registry);
  const agentTools = "both";
  const webAccess = raw.web_access === undefined
    ? "public-pages"
    : enumValue(raw.web_access, WEB_ACCESS_MODES, "onboarding.web_access");
  const normalized = {
    schema: 1,
    agentTools,
    webAccess,
    execution: normalizeExecution(raw.execution),
    development: normalizeDevelopment(raw.development),
    greenfield: normalizeGreenfield(raw.greenfield),
    providers,
    networkDomains,
    conventions: normalizeConventions(raw.conventions),
    local: normalizeLocalConfiguration(raw.local, providers, pluginRoot, "onboarding.local", DEFAULT_PLANNING),
  };
  normalized.digest = onboardingDigest(normalized);
  return normalized;
}

export function defaultOnboarding() {
  const onboarding = {
    schema: 1,
    agentTools: "both",
    webAccess: "public-pages",
    execution: { mode: "orchestrated" },
    development: { runtimeVersions: {} },
    greenfield: null,
    providers: {},
    networkDomains: [],
    conventions: {},
    local: { identity: {}, providers: {}, planning: {} },
  };
  onboarding.digest = onboardingDigest(onboarding);
  return onboarding;
}

export function loadOnboarding(path, pluginRoot) {
  if (path === undefined || path === null || path === "") return defaultOnboarding();
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`cannot read onboarding answers ${path}: ${error.message}`);
  }
  return normalizeOnboarding(raw, pluginRoot);
}

export function onboardingSummary(onboarding) {
  const providers = {};
  for (const capability of CAPABILITIES) {
    const declaration = onboarding.providers?.[capability];
    if (!declaration) continue;
    providers[capability] = {
      provider: declaration.provider,
      required: declaration.required,
      ...(declaration.transport === undefined ? {} : { transport: declaration.transport }),
      ...(declaration.access === undefined ? {} : { access: declaration.access }),
      settings: Object.keys(declaration.settings ?? {}).sort(),
    };
  }
  return {
    schema: 1,
    agent_tools: onboarding.agentTools,
    web_access: onboarding.webAccess,
    execution: {
      mode: onboarding.execution?.mode ?? "orchestrated",
      isolation: onboarding.execution?.isolation ?? null,
    },
    runtime_versions: onboarding.development?.runtimeVersions ?? {},
    greenfield: onboarding.greenfield === null ? null : {
      name: onboarding.greenfield.name,
      shape: onboarding.greenfield.shape ?? null,
      non_goals: onboarding.greenfield.nonGoals.length,
      constraints: onboarding.greenfield.constraints.length,
    },
    providers,
    network_domains: [...(onboarding.networkDomains ?? [])],
    conventions: onboarding.conventions ?? {},
    local: localConfigurationSummary(onboarding.local),
  };
}

export function renderLocalConfiguration(onboarding) {
  return renderMachineLocalConfiguration(onboarding?.local);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

// The digest covers normalized onboarding values, excluding the derived digest field itself.
// It therefore does not change with source-file whitespace or object-key order.
export function onboardingDigest(onboarding) {
  if (!isObject(onboarding) || onboarding.schema !== 1 || typeof onboarding.agentTools !== "string") {
    throw new Error("onboardingDigest requires normalized schema-1 onboarding data");
  }
  const { digest: _derivedDigest, ...payload } = onboarding;
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}
