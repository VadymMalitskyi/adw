// Runtime discovery must be evidence-only: it may report what a repository
// pins, and it may report what it could not settle, but it may never invent a
// version. These tests exercise `discoverDevelopmentEnvironment` directly.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { discoverDevelopmentEnvironment } from "../../plugin/lib/managed-environment.mjs";

function scratch(prefix) {
  return mkdtempSync(join(tmpdir(), `${prefix}-`));
}

test("runtime discovery reports evidence without describing the codebase", () => {
  const root = scratch("adw-discovery-shape");
  writeFileSync(join(root, "package.json"), `${JSON.stringify({ name: "app", engines: { node: "20" } }, null, 2)}\n`);
  writeFileSync(join(root, "package-lock.json"), `${JSON.stringify({ name: "app", lockfileVersion: 3, packages: {} }, null, 2)}\n`);

  const result = discoverDevelopmentEnvironment(root);

  assert.deepEqual(Object.keys(result).sort(), [
    "allowed_domains",
    "environment_variables",
    "features",
    "forward_ports",
    "runtimes",
    "schema",
    "selected_versions",
    "setup_commands",
    "system_packages",
    "unresolved",
  ]);
  assert.equal(result.dependencies, undefined, "dependency enumeration is no longer part of discovery");
});

test("runtime discovery preserves unresolved repository evidence without invented versions", () => {
  const root = scratch("adw-runtime-evidence");
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
  const root = scratch("adw-glob-workspace");
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
  assert.deepEqual(result.selected_versions, { node: "20" });
});

test("source-only runtime discovery is ordered independently of directory insertion order", () => {
  const root = scratch("adw-source-order");
  mkdirSync(join(root, "zeta"));
  mkdirSync(join(root, "alpha"));
  writeFileSync(join(root, "zeta/worker.py"), "pass\n");
  writeFileSync(join(root, "alpha/index.js"), "export {};\n");

  const result = discoverDevelopmentEnvironment(root);
  assert.deepEqual(result.unresolved.map(({ requirement, source }) => [requirement, source]), [
    ["node source runtime", "alpha/index.js"],
    ["python source runtime", "zeta/worker.py"],
  ]);

  // The same evidence in the opposite creation order yields the same report.
  const mirrored = scratch("adw-source-order-mirrored");
  mkdirSync(join(mirrored, "alpha"));
  mkdirSync(join(mirrored, "zeta"));
  writeFileSync(join(mirrored, "alpha/index.js"), "export {};\n");
  writeFileSync(join(mirrored, "zeta/worker.py"), "pass\n");
  assert.deepEqual(discoverDevelopmentEnvironment(mirrored).unresolved, result.unresolved);
});

test("an explicit adw.yaml choice provisions a detected but unpinned .NET SDK", () => {
  const root = scratch("adw-runtime-choice");
  writeFileSync(join(root, "App.csproj"), "<Project Sdk=\"Microsoft.NET.Sdk\" />\n");

  const result = discoverDevelopmentEnvironment(root, { runtimeVersions: { dotnet: "8" } });
  const dotnet = result.runtimes.find((runtime) => runtime.name === "dotnet");

  assert.deepEqual(result.selected_versions, { dotnet: "8" });
  assert.equal(dotnet.source, "adw.yaml#development.runtime_versions.dotnet");
  assert.equal(dotnet.detected_source, "App.csproj");
  assert.ok(!result.unresolved.some(({ requirement }) => requirement.startsWith(".NET SDK version")));
  assert.ok(result.setup_commands.some(({ command }) => command === "dotnet restore"));
  assert.equal(result.features["ghcr.io/devcontainers/features/dotnet:1"].version, "8");
});

test("an explicit adw.yaml choice provisions a source-only language", () => {
  const root = scratch("adw-source-runtime-choice");
  writeFileSync(join(root, "worker.py"), "print('ready')\n");

  const result = discoverDevelopmentEnvironment(root, { runtimeVersions: { python: "3.12" } });
  const python = result.runtimes.find((runtime) => runtime.name === "python");

  assert.deepEqual(result.selected_versions, { python: "3.12" });
  assert.equal(python.source, "adw.yaml#development.runtime_versions.python");
  assert.equal(python.detected_source, "worker.py");
  assert.ok(!result.unresolved.some(({ requirement }) => requirement === "python source runtime"));
});

test("a Conda environment provisions Conda and creates the declared environment", () => {
  const root = scratch("adw-conda-environment");
  writeFileSync(join(root, "environment.yml"), [
    "name: analytics",
    "channels:",
    "  - conda-forge",
    "dependencies:",
    "  - python=3.12",
    "  - pandas=2.2",
  ].join("\n"));

  const result = discoverDevelopmentEnvironment(root);
  const python = result.runtimes.find((runtime) => runtime.name === "python");

  assert.deepEqual({ version: python.version, source: python.source }, { version: "3.12", source: "environment.yml" });
  assert.equal(result.features["ghcr.io/devcontainers/features/conda:2"].version, "24.11.3");
  assert.equal(result.features["ghcr.io/devcontainers/features/python:1"], undefined);
  assert.ok(result.setup_commands.some(({ command, source }) => command === "conda env create --file environment.yml" && source === "environment.yml"));
  assert.ok(result.allowed_domains.includes("repo.anaconda.com"));
  assert.ok(result.allowed_domains.includes("conda.anaconda.org"));
});

test("an unpinned Conda environment remains an explicit setup blocker", () => {
  const root = scratch("adw-conda-unpinned");
  writeFileSync(join(root, "environment.yaml"), "name: analytics\ndependencies:\n  - python\n");

  const result = discoverDevelopmentEnvironment(root);

  assert.ok(result.unresolved.some(({ requirement, source }) => requirement === "Python runtime in Conda environment for ." && source === "environment.yaml"));
  assert.equal(result.features["ghcr.io/devcontainers/features/conda:2"].version, "24.11.3");
});

test("a chosen runtime is provisioned even when nothing in the repository mentions it", () => {
  const root = scratch("adw-chosen-only");
  writeFileSync(join(root, "README.md"), "# empty\n");

  const result = discoverDevelopmentEnvironment(root, { runtimeVersions: { go: "1.22" } });
  const go = result.runtimes.find((runtime) => runtime.name === "go");

  assert.deepEqual(result.selected_versions, { go: "1.22" });
  assert.equal(go.source, "adw.yaml#development.runtime_versions.go");
  assert.equal(go.detected_source, undefined);
  assert.equal(result.features["ghcr.io/devcontainers/features/go:1"].version, "1.22");
});

test("a .NET target framework pins the managed SDK when global.json is absent", () => {
  const root = scratch("adw-target-framework");
  writeFileSync(join(root, "App.csproj"), "<Project Sdk=\"Microsoft.NET.Sdk\"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>\n");

  const result = discoverDevelopmentEnvironment(root);
  const dotnet = result.runtimes.find((runtime) => runtime.name === "dotnet");

  assert.deepEqual(result.selected_versions, { dotnet: "8.0" });
  assert.equal(dotnet.source, "App.csproj#TargetFramework");
  assert.ok(result.setup_commands.some(({ command }) => command === "dotnet restore"));
});

test("Node below 20 is refused into unresolved instead of being selected", () => {
  const root = scratch("adw-node-too-old");
  writeFileSync(join(root, "package.json"), `${JSON.stringify({ name: "legacy", engines: { node: ">=18" } }, null, 2)}\n`);
  writeFileSync(join(root, "package-lock.json"), `${JSON.stringify({ name: "legacy", lockfileVersion: 3, packages: {} }, null, 2)}\n`);

  const result = discoverDevelopmentEnvironment(root);

  assert.equal(result.selected_versions.node, undefined);
  assert.ok(result.unresolved.some(({ requirement, source, reason }) => requirement === "Node runtime version"
    && source === "package.json#engines.node"
    && /Node\.js 20 or newer/.test(reason)));
});

test("an unsupported or non-numeric runtime choice is refused", () => {
  const root = scratch("adw-bad-choice");
  writeFileSync(join(root, "README.md"), "# empty\n");

  assert.throws(() => discoverDevelopmentEnvironment(root, { runtimeVersions: { elixir: "1.16" } }), /unsupported runtime: elixir/);
  assert.throws(() => discoverDevelopmentEnvironment(root, { runtimeVersions: { node: "lts/iron" } }), /must be numeric/);
  assert.throws(() => discoverDevelopmentEnvironment(root, { runtimeVersions: ["node"] }), /must be a mapping object/);
});
