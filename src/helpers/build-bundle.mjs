#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(sourceDirectory, "../..");
const sourcePath = resolve(sourceDirectory, "runtime-bundle.mjs");
const outputPath = resolve(repositoryRoot, "plugin/lib/adw-helper.mjs");

const options = {
  entryPoints: [sourcePath],
  outfile: outputPath,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  legalComments: "none",
  sourcemap: false,
  logLevel: "silent",
  banner: { js: 'import { createRequire as __adwCreateRequire } from "node:module"; const require = __adwCreateRequire(import.meta.url);' },
};

if (process.argv.includes("--write")) {
  await build({ ...options, write: true });
  process.stdout.write(`wrote ${outputPath}\n`);
} else {
  const generated = await build({ ...options, write: false });
  const output = await readFile(outputPath);
  const bundled = generated.outputFiles.find(({ path }) => resolve(path) === outputPath)?.contents ?? generated.outputFiles[0]?.contents;
  if (!bundled || !Buffer.from(bundled).equals(output)) {
    process.stderr.write("plugin/lib/adw-helper.mjs is stale; run npm run build:helper\n");
    process.exitCode = 1;
  } else {
    process.stdout.write("helper bundle is reproducible and current\n");
  }
}
