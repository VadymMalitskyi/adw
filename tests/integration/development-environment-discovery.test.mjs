import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { discoverDevelopmentEnvironment } from "../../plugin/skills/init/scripts/development-environment.mjs";

test("runtime discovery preserves unresolved repository evidence without invented versions", () => {
  const root = mkdtempSync(join(tmpdir(), "adw-runtime-evidence-"));
  writeFileSync(join(root, "package.json"), `${JSON.stringify({ name: "unversioned-node" }, null, 2)}\n`);
  writeFileSync(join(root, ".nvmrc"), "lts/iron\n");
  writeFileSync(join(root, "requirements.txt"), "flask==3.1.0\n");
  writeFileSync(join(root, ".python-version"), "latest\n");

  const result = discoverDevelopmentEnvironment(root);
  const node = result.runtimes.find((runtime) => runtime.name === "node");
  const python = result.runtimes.find((runtime) => runtime.name === "python");

  assert.deepEqual({ version: node.version, requested: node.requested, source: node.source }, { version: null, requested: "lts/iron", source: ".nvmrc" });
  assert.deepEqual({ version: python.version, requested: python.requested, source: python.source }, { version: null, requested: "latest", source: ".python-version" });
  assert.deepEqual(result.selected_versions, {});
  assert.ok(result.unresolved.some(({ requirement, source }) => requirement === "node runtime version" && source === ".nvmrc"));
  assert.ok(result.unresolved.some(({ requirement, source }) => requirement === "python runtime version" && source === ".python-version"));
});

test("globbed workspace members inherit root runtime and lockfile evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "adw-glob-workspace-"));
  mkdirSync(join(root, "libs/zeta"), { recursive: true });
  mkdirSync(join(root, "libs/alpha"), { recursive: true });
  writeFileSync(join(root, "package.json"), `${JSON.stringify({
    private: true,
    workspaces: ["libs/*"],
    engines: { node: ">=20" },
  }, null, 2)}\n`);
  writeFileSync(join(root, "package-lock.json"), `${JSON.stringify({ name: "workspace", lockfileVersion: 3, packages: {} }, null, 2)}\n`);
  writeFileSync(join(root, "libs/zeta/package.json"), `${JSON.stringify({ name: "zeta" }, null, 2)}\n`);
  writeFileSync(join(root, "libs/alpha/package.json"), `${JSON.stringify({ name: "alpha" }, null, 2)}\n`);

  const result = discoverDevelopmentEnvironment(root);
  const nodeRuntimes = result.runtimes.filter(({ name }) => name === "node");

  assert.deepEqual(nodeRuntimes.map(({ component }) => component), [".", "libs/alpha", "libs/zeta"]);
  assert.ok(nodeRuntimes.every(({ version, requested, source }) => version === "20" && requested === ">=20" && source === "package.json#engines.node"));
  assert.deepEqual(result.setup_commands.filter(({ command }) => command.includes("npm ci")), [{ command: "npm ci", source: "package-lock.json" }]);
  assert.ok(!result.unresolved.some(({ requirement }) => requirement.startsWith("install Node dependencies in libs/")));
});

test("source-only runtime discovery is ordered independently of directory insertion order", () => {
  const root = mkdtempSync(join(tmpdir(), "adw-source-order-"));
  mkdirSync(join(root, "zeta"));
  mkdirSync(join(root, "alpha"));
  writeFileSync(join(root, "zeta/worker.py"), "pass\n");
  writeFileSync(join(root, "alpha/index.js"), "export {};\n");

  const result = discoverDevelopmentEnvironment(root);
  assert.deepEqual(result.unresolved.map(({ requirement, source }) => [requirement, source]), [
    ["node source runtime", "alpha/index.js"],
    ["python source runtime", "zeta/worker.py"],
  ]);
});

test("an explicit onboarding choice provisions a detected but unpinned .NET SDK", () => {
  const root = mkdtempSync(join(tmpdir(), "adw-runtime-choice-"));
  writeFileSync(join(root, "App.csproj"), "<Project Sdk=\"Microsoft.NET.Sdk\"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>\n");

  const result = discoverDevelopmentEnvironment(root, { runtimeVersions: { dotnet: "8" } });
  const dotnet = result.runtimes.find((runtime) => runtime.name === "dotnet");

  assert.deepEqual(result.selected_versions, { dotnet: "8" });
  assert.equal(dotnet.source, "onboarding.development.runtime_versions.dotnet");
  assert.equal(dotnet.detected_source, "App.csproj");
  assert.ok(!result.unresolved.some(({ requirement }) => requirement.startsWith(".NET SDK version")));
  assert.ok(result.setup_commands.some(({ command }) => command === "dotnet restore"));
});

test("an explicit onboarding choice provisions a source-only language", () => {
  const root = mkdtempSync(join(tmpdir(), "adw-source-runtime-choice-"));
  writeFileSync(join(root, "worker.py"), "print('ready')\n");

  const result = discoverDevelopmentEnvironment(root, { runtimeVersions: { python: "3.12" } });

  assert.deepEqual(result.selected_versions, { python: "3.12" });
  assert.ok(!result.unresolved.some(({ requirement }) => requirement === "python source runtime"));
});
