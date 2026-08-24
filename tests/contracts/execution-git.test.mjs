import assert from "node:assert/strict";
import test from "node:test";
import { porcelainPaths } from "../../plugin/lib/execution-git.mjs";

test("porcelain v2 parser retains ordinary, untracked, and rename paths", () => {
  const rows = "1 .M N... 100644 100644 100644 a b file.txt\0? odd name\0" + "2 R. N... 100644 100644 100644 100644 a b R100 renamed.txt\0old.txt\0";
  assert.deepEqual(porcelainPaths(Buffer.from(rows)), ["file.txt", "odd name", "renamed.txt", "old.txt"]);
});
