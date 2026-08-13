import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CAPABILITIES,
  localConfigurationSummary,
  normalizeLocalConfiguration,
  renderLocalConfiguration as renderMachineLocalConfiguration,
} from "../../../lib/local-configuration.mjs";

const CAPABILITY_SET = new Set(CAPABILITIES);
const EXECUTION_MODES = new Set(["managed-devcontainer", "project-devcontainer", "provider-sandbox"]);
const DOCUMENTATION_DELIVERIES = new Set(["direct-push"]);
const REQUIREMENTS = new Set(["disabled", "optional", "required"]);
const TRANSPORTS = new Set(["auto", "native", "mcp", "cli", "api"]);
const ACCESS_MODES = new Set(["read-only", "read-write"]);
const WEB_ACCESS_MODES = new Set(["hosted-only", "public-pages"]);
const RUNTIMES = new Set(["node", "python", "go", "rust", "java", "ruby", "dotnet"]);
const WORKFLOW_VALUES = {
  binding: new Set(["optional", "required"]),
  ensure: new Set(["link-only", "create-or-link"]),
  stage: new Set(["plan"]),
  cardinality: new Set(["one-per-change", "one-parent-plus-plan-tasks"]),
};
const SECRET_LIKE_KEY = /(?:password|passwd|token|api[_-]?key|secret|credential|authorization|cookie|private[_-]?key)/i;
const DOMAIN = /^[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}$/;
const PROFILE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+\.ya?ml$/;

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

function normalizeExecution(value) {
  if (value === undefined) return undefined;
  value = object(value, "onboarding.execution");
  rejectUnknown(value, new Set(["isolation"]), "onboarding.execution");
  if (value.isolation === undefined) fail("onboarding.execution.isolation", "is required when execution is present");
  return { isolation: enumValue(value.isolation, EXECUTION_MODES, "onboarding.execution.isolation") };
}

function normalizeDocumentation(value) {
  if (value === undefined) return undefined;
  value = object(value, "onboarding.documentation");
  rejectUnknown(value, new Set(["delivery"]), "onboarding.documentation");
  if (value.delivery === undefined) fail("onboarding.documentation.delivery", "is required when documentation is present");
  return { delivery: enumValue(value.delivery, DOCUMENTATION_DELIVERIES, "onboarding.documentation.delivery") };
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

function normalizeIntegrations(value, providers) {
  if (value === undefined) return { integrations: {}, networkDomains: [] };
  value = object(value, "onboarding.integrations");
  const integrations = {};
  const domains = new Set();
  for (const [capability, raw] of Object.entries(value)) {
    if (!CAPABILITY_SET.has(capability)) fail(`onboarding.integrations.${capability}`, "is not a known capability");
    const path = `onboarding.integrations.${capability}`;
    const integration = object(raw, path);
    rejectUnknown(integration, new Set(["provider", "requirement", "transport", "access", "settings", "network_domains"]), path);
    const provider = nonemptyString(integration.provider, `${path}.provider`);
    const providerEntry = providers.get(provider);
    if (!providerEntry) fail(`${path}.provider`, `unknown provider: ${provider}`);
    if (!providerEntry.capabilities.has(capability)) fail(`${path}.provider`, `${provider} does not support ${capability}`);
    const normalized = {
      provider,
      requirement: enumValue(integration.requirement, REQUIREMENTS, `${path}.requirement`),
    };
    if (integration.transport !== undefined) {
      normalized.transport = enumValue(integration.transport, TRANSPORTS, `${path}.transport`);
      if (normalized.transport !== "auto" && !providerEntry.transports.has(normalized.transport)) {
        fail(`${path}.transport`, `${provider} does not support ${normalized.transport}`);
      }
    }
    if (integration.access !== undefined) normalized.access = enumValue(integration.access, ACCESS_MODES, `${path}.access`);
    if (integration.settings !== undefined) {
      const settings = object(integration.settings, `${path}.settings`);
      normalized.settings = {};
      for (const [key, setting] of Object.entries(settings)) normalized.settings[key] = nonemptyString(setting, `${path}.settings.${key}`);
      normalized.settings = sortedObject(normalized.settings);
    }
    for (const domain of normalizeDomains(integration.network_domains, `${path}.network_domains`)) domains.add(domain);
    integrations[capability] = normalized;
  }
  return { integrations: sortedObject(integrations), networkDomains: [...domains].sort() };
}

function normalizeWorkflow(value, integrations) {
  if (value === undefined) return {};
  value = object(value, "onboarding.workflows");
  rejectUnknown(value, new Set(["work_tracker"]), "onboarding.workflows");
  if (value.work_tracker === undefined) return {};
  const path = "onboarding.workflows.work_tracker";
  const raw = object(value.work_tracker, path);
  rejectUnknown(raw, new Set(["binding", "ensure", "stage", "cardinality", "profile", "child_profile"]), path);
  const workflow = {};
  for (const [field, allowed] of Object.entries(WORKFLOW_VALUES)) {
    if (raw[field] === undefined) fail(`${path}.${field}`, "is required");
    workflow[field] = enumValue(raw[field], allowed, `${path}.${field}`);
  }
  for (const field of ["profile", "child_profile"]) {
    if (raw[field] === undefined) continue;
    workflow[field] = singleLine(raw[field], `${path}.${field}`);
    if (!PROFILE_PATH.test(workflow[field])) fail(`${path}.${field}`, "must be a project-relative YAML path without parent traversal");
  }
  const integration = integrations.work_tracker;
  if (!integration || integration.requirement === "disabled") fail(path, "requires an enabled work_tracker integration");
  if (workflow.binding === "required" && integration.requirement !== "required") fail(`${path}.binding`, "required binding requires a required work_tracker integration");
  if (workflow.ensure === "create-or-link" && integration.access !== "read-write") fail(`${path}.ensure`, "create-or-link requires read-write work_tracker access");
  if (workflow.ensure === "create-or-link" && !workflow.profile) fail(`${path}.profile`, "is required when ensure is create-or-link");
  if (workflow.cardinality === "one-parent-plus-plan-tasks" && !workflow.child_profile) fail(`${path}.child_profile`, "is required for one-parent-plus-plan-tasks");
  return { work_tracker: workflow };
}

function normalizeConventions(value) {
  if (value === undefined) return {};
  value = object(value, "onboarding.conventions");
  rejectUnknown(value, new Set(["branches", "pull_requests", "work_items"]), "onboarding.conventions");
  const result = {};
  for (const field of ["branches", "pull_requests", "work_items"]) {
    if (value[field] !== undefined) result[field] = singleLine(value[field], `onboarding.conventions.${field}`);
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
  rejectUnknown(raw, new Set(["schema", "web_access", "execution", "documentation", "development", "integrations", "workflows", "conventions", "local"]), "onboarding");
  if (raw.schema !== 1) fail("onboarding.schema", "must equal 1");
  const providers = readProviderRegistry(pluginRoot);
  const { integrations, networkDomains } = normalizeIntegrations(raw.integrations, providers);
  const agentTools = "both";
  const webAccess = raw.web_access === undefined
    ? "public-pages"
    : enumValue(raw.web_access, WEB_ACCESS_MODES, "onboarding.web_access");
  const normalized = {
    schema: 1,
    agentTools,
    webAccess,
    documentation: normalizeDocumentation(raw.documentation) ?? { delivery: "direct-push" },
    development: normalizeDevelopment(raw.development),
    integrations,
    networkDomains,
    workflows: normalizeWorkflow(raw.workflows, integrations),
    conventions: normalizeConventions(raw.conventions),
    local: normalizeLocalConfiguration(raw.local, integrations, pluginRoot, "onboarding.local"),
  };
  const execution = normalizeExecution(raw.execution);
  if (execution) normalized.execution = execution;
  normalized.digest = onboardingDigest(normalized);
  return normalized;
}

export function defaultOnboarding() {
  const onboarding = {
    schema: 1,
    agentTools: "both",
    webAccess: "public-pages",
    documentation: { delivery: "direct-push" },
    development: { runtimeVersions: {} },
    integrations: {},
    networkDomains: [],
    workflows: {},
    conventions: {},
    local: { identity: {}, integrations: {} },
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
  const integrations = {};
  for (const capability of CAPABILITIES) {
    const integration = onboarding.integrations?.[capability];
    if (!integration) continue;
    integrations[capability] = {
      provider: integration.provider,
      requirement: integration.requirement,
      ...(integration.transport === undefined ? {} : { transport: integration.transport }),
      ...(integration.access === undefined ? {} : { access: integration.access }),
      settings: Object.keys(integration.settings ?? {}).sort(),
    };
  }
  return {
    schema: 1,
    agent_tools: onboarding.agentTools,
    web_access: onboarding.webAccess,
    execution: onboarding.execution?.isolation ?? null,
    documentation_delivery: onboarding.documentation?.delivery ?? null,
    runtime_versions: onboarding.development?.runtimeVersions ?? {},
    integrations,
    network_domains: [...(onboarding.networkDomains ?? [])],
    workflows: onboarding.workflows ?? {},
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
