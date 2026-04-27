import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildIma2MetadataPayload,
  buildIma2Xmp,
  parseIma2Xmp,
} from "../lib/imageMetadata.js";
import {
  embedImageMetadata,
  embedImageMetadataBestEffort,
  isSupportedMetadataFormat,
  normalizeImageMetadataFormat,
  readEmbeddedImageMetadata,
  readImageMetadataWithSidecar,
  writeGenerationMetadataSidecar,
} from "../lib/imageMetadataStore.js";

describe("image metadata helpers", () => {
  it("round-trips ima2.generation.v1 metadata through XMP", () => {
    const payload = buildIma2MetadataPayload({
      kind: "classic",
      prompt: "fallback prompt",
      userPrompt: "neon cat",
      promptMode: "direct",
      quality: "high",
      size: "1536x1024",
      format: "png",
      provider: "oauth",
      refsCount: 2,
    }, { version: "test-version" });

    const parsed = parseIma2Xmp(buildIma2Xmp(payload));

    assert.equal(parsed.schema, "ima2.generation.v1");
    assert.equal(parsed.app, "ima2-gen");
    assert.equal(parsed.userPrompt, "neon cat");
    assert.equal(parsed.promptMode, "direct");
    assert.equal(parsed.version, "test-version");
    assert.equal(parsed.refsCount, 2);
  });

  it("normalizes supported metadata formats", () => {
    assert.equal(normalizeImageMetadataFormat("jpg"), "jpeg");
    assert.equal(isSupportedMetadataFormat("png"), true);
    assert.equal(isSupportedMetadataFormat("jpeg"), true);
    assert.equal(isSupportedMetadataFormat("webp"), true);
    assert.equal(isSupportedMetadataFormat("gif"), false);
  });

  it("keeps sidecar metadata readable when embedded metadata is unavailable", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ima2-metadata-"));
    const imagePath = join(dir, "sample.png");
    try {
      await writeFile(imagePath, Buffer.from("not a real image"));
      await writeGenerationMetadataSidecar(imagePath, {
        prompt: "legacy sidecar prompt",
        userPrompt: "legacy sidecar user prompt",
        format: "png",
      }, { version: "sidecar-test" });

      const read = await readImageMetadataWithSidecar(imagePath);

      assert.equal(read.source, "sidecar");
      assert.equal(read.metadata.schema, "ima2.generation.v1");
      assert.equal(read.metadata.userPrompt, "legacy sidecar user prompt");
      assert.equal(read.metadata.version, "sidecar-test");
      assert.ok(read.warnings.length >= 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("best-effort embedding preserves the original buffer on unsupported formats", async () => {
    const buffer = Buffer.from("image bytes");
    const result = await embedImageMetadataBestEffort(buffer, "gif", { prompt: "x" });

    assert.equal(result.embedded, false);
    assert.equal(result.buffer, buffer);
    assert.equal(result.code, "IMAGE_METADATA_UNSUPPORTED_FORMAT");
  });

  it("round-trips embedded metadata for PNG, JPEG, and WebP when sharp is available", async (t) => {
    let sharp;
    try {
      sharp = (await import("sharp")).default;
    } catch {
      t.skip("sharp is not installed in this checkout");
      return;
    }

    for (const format of ["png", "jpeg", "webp"]) {
      const source = await sharp({
        create: {
          width: 16,
          height: 12,
          channels: 3,
          background: "#336699",
        },
      }).toFormat(format).toBuffer();

      const embedded = await embedImageMetadata(source, format, {
        prompt: "format prompt",
        userPrompt: `format ${format}`,
        format,
      }, { version: "format-test" });
      const read = await readEmbeddedImageMetadata(embedded.buffer);

      assert.equal(read.source, "xmp");
      assert.equal(read.metadata.schema, "ima2.generation.v1");
      assert.equal(read.metadata.userPrompt, `format ${format}`);
      assert.equal(read.metadata.format, format);
    }
  });
});
