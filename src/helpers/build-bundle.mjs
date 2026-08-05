#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(sourceDirectory, "../..");
const sourcePath = resolve(sourceDirectory, "runtime-bundle.mjs");
const outputPath = resolve(repositoryRoot, "plugin/lib/adw-helper.mjs");
const source = await readFile(sourcePath);

if (process.argv.includes("--write")) {
  await writeFile(outputPath, source);
  process.stdout.write(`wrote ${outputPath}\n`);
} else {
  const output = await readFile(outputPath);
  if (!source.equals(output)) {
    process.stderr.write("plugin/lib/adw-helper.mjs is stale; run npm run build:helper\n");
    process.exitCode = 1;
  } else {
    process.stdout.write("helper bundle is reproducible and current\n");
  }
}
