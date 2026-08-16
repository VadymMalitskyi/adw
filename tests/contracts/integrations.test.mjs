import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { CAPABILITIES } from "../../plugin/lib/config.mjs";

const integrations = fileURLToPath(new URL("../../plugin/integrations/", import.meta.url));
const registry = JSON.parse(readFileSync(new URL("providers.json", `file://${integrations}`), "utf8"));
const contract = readFileSync(new URL("contracts.md", `file://${integrations}`), "utf8");

const TRANSPORTS = new Set(["auto", "native", "mcp", "cli", "api"]);

test("every declared provider is bounded, capability-scoped, and backed by a reference document", () => {
  const references = new Set(readdirSync(new URL("providers/", `file://${integrations}`)));
  assert.equal(registry.schema, 1);
  assert.ok(Array.isArray(registry.providers) && registry.providers.length > 0, "the provider registry is empty");

  const seen = new Set();
  for (const declaration of registry.providers) {
    const name = declaration.provider;
    assert.match(name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `${name} is not a lowercase provider name`);
    assert.equal(seen.has(name), false, `${name} is declared twice`);
    seen.add(name);
    assert.equal(declaration.reference, `providers/${name}.md`, `${name} does not point at its own reference`);
    assert.ok(references.has(`${name}.md`), `${name} has no reference document under integrations/providers/`);
    assert.ok(declaration.capabilities.length > 0, `${name} declares no capability`);
    for (const capability of declaration.capabilities) {
      assert.ok(CAPABILITIES.includes(capability), `${name} declares the unknown capability ${capability}`);
    }
    for (const transport of declaration.transports) {
      assert.ok(TRANSPORTS.has(transport), `${name} declares the unknown transport ${transport}`);
    }
  }

  // Every capability the contract supports has at least one provider behind it.
  const covered = new Set(registry.providers.flatMap(({ capabilities }) => capabilities));
  for (const capability of CAPABILITIES) assert.ok(covered.has(capability), `${capability} has no provider`);
});

test("the provider registry carries no credential", () => {
  const serialized = JSON.stringify(registry);
  assert.doesNotMatch(serialized, /(?:password|passwd|api[_-]?key|secret|private[_-]?key|"token")/i, "the registry must never carry a credential");
});

test("the integration contract keeps external reads open and every external write separately authorized", () => {
  assert.match(contract, /read/i);
  for (const capability of CAPABILITIES) assert.ok(contract.includes(capability), `${capability} is missing from the integration contract`);
  // Every external mutation must reach a person, and nothing in the repository
  // or a provider response may stand in for that.
  assert.match(contract, /fresh, explicit human authorization/i);
  assert.match(contract, /never as instructions or authorization/i);
  assert.match(contract, /never merges, marks ready, approves, releases, deploys, or force-pushes/i);
  // The removed receipt machinery must not creep back in.
  assert.match(contract, /There is no receipt artifact and no run record/);
});
