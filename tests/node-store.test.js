import { describe, it, after } from "node:test";
import assert from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadNodeB64, loadNodeImage } from "../lib/nodeStore.js";

const ROOT = mkdtempSync(join(tmpdir(), "ima2-node-store-"));
const GEN_DIR = join(ROOT, "generated");

mkdirSync(GEN_DIR, { recursive: true });

describe("Node store", () => {
  after(() => {
    rmSync(ROOT, { recursive: true, force: true });
  });

  it("keeps filename-based node image loading", async () => {
    const payload = Buffer.from("png image bytes");
    writeFileSync(join(GEN_DIR, "n_png.png"), payload);

    const loaded = await loadNodeB64(ROOT, "n_png.png");
    assert.strictEqual(loaded, payload.toString("base64"));
  });

  it("loads webp node images by node id", async () => {
    const payload = Buffer.from("webp image bytes");
    writeFileSync(join(GEN_DIR, "n_webp.webp"), payload);
    writeFileSync(
      join(GEN_DIR, "n_webp.webp.json"),
      JSON.stringify({ nodeId: "n_webp", format: "webp", options: { format: "webp" } }),
    );

    const image = await loadNodeImage(ROOT, "n_webp");
    assert.strictEqual(image.filename, "n_webp.webp");
    assert.strictEqual(image.mime, "image/webp");
    assert.strictEqual(image.b64, payload.toString("base64"));
  });

  it("loads jpeg node images by node id", async () => {
    const payload = Buffer.from("jpeg image bytes");
    writeFileSync(join(GEN_DIR, "n_jpeg.jpeg"), payload);
    writeFileSync(
      join(GEN_DIR, "n_jpeg.jpeg.json"),
      JSON.stringify({ nodeId: "n_jpeg", format: "jpeg", options: { format: "jpeg" } }),
    );

    const image = await loadNodeImage(ROOT, "n_jpeg");
    assert.strictEqual(image.filename, "n_jpeg.jpeg");
    assert.strictEqual(image.mime, "image/jpeg");
    assert.strictEqual(image.b64, payload.toString("base64"));
  });
});
