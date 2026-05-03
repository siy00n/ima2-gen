import { describe, it } from "node:test";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const VALID_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);

function runCleanup(root, args = []) {
  const result = spawnSync(
    process.execPath,
    ["scripts/cleanup-invalid-generated.mjs", "--root", root, ...args],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    },
  );
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  return result;
}

describe("cleanup-invalid-generated script", () => {
  it("dry-runs invalid generated assets without moving files", () => {
    const root = mkdtempSync(join(tmpdir(), "ima2-cleanup-dry-"));
    try {
      writeFileSync(join(root, "valid.png"), VALID_PNG);
      writeFileSync(join(root, "broken.png"), "hello");
      writeFileSync(join(root, "broken.png.json"), JSON.stringify({ prompt: "broken" }));

      const result = runCleanup(root);

      assert.match(result.stdout, /Mode: dry-run/);
      assert.match(result.stdout, /Invalid images: 1/);
      assert.ok(existsSync(join(root, "broken.png")));
      assert.ok(existsSync(join(root, "broken.png.json")));
      assert.ok(!existsSync(join(root, ".trash")));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("moves invalid assets and sidecars to trash when applied", () => {
    const root = mkdtempSync(join(tmpdir(), "ima2-cleanup-apply-"));
    try {
      const thumbs = join(root, ".thumbs");
      mkdirSync(thumbs, { recursive: true });
      writeFileSync(join(root, "valid.png"), VALID_PNG);
      writeFileSync(join(root, "broken.png"), "hello");
      writeFileSync(join(root, "broken.png.json"), JSON.stringify({ prompt: "broken" }));
      writeFileSync(join(thumbs, "old.webp"), "thumb");

      runCleanup(root, ["--apply", "--purge-thumbs"]);

      assert.ok(existsSync(join(root, "valid.png")));
      assert.ok(!existsSync(join(root, "broken.png")));
      assert.ok(!existsSync(join(root, "broken.png.json")));
      const trashBase = join(root, ".trash");
      const trashDirs = readdirSync(trashBase).filter((name) => name.startsWith("invalid-cleanup-"));
      assert.strictEqual(trashDirs.length, 1);
      const trashDir = join(trashBase, trashDirs[0]);
      assert.strictEqual(readFileSync(join(trashDir, "broken.png"), "utf8"), "hello");
      assert.ok(existsSync(join(trashDir, "broken.png.json")));
      assert.deepStrictEqual(readdirSync(thumbs), []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
