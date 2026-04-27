import test from "node:test";
import assert from "node:assert/strict";
import { compressReferenceB64ForOAuth } from "../lib/referenceImageCompress.js";

test("compressReferenceB64ForOAuth leaves small references unchanged by default", async () => {
  const input = Buffer.from("small reference").toString("base64");

  const result = await compressReferenceB64ForOAuth(`data:image/png;base64,${input}`, {
    maxB64Bytes: 1_000,
  });

  assert.equal(result.b64, input);
  assert.equal(result.compressed, false);
  assert.equal(result.inputBytes, input.length);
  assert.equal(result.outputBytes, input.length);
});

test("compressReferenceB64ForOAuth force-normalizes valid images when sharp is available", async (t) => {
  let sharp;
  try {
    sharp = (await import("sharp")).default;
  } catch (error) {
    if (error.code === "SHARP_UNAVAILABLE") {
      t.skip("sharp is not installed in this checkout");
    }
    return;
  }

  const png = await sharp({
    create: {
      width: 32,
      height: 32,
      channels: 3,
      background: "#336699",
    },
  }).png().toBuffer();

  const result = await compressReferenceB64ForOAuth(png.toString("base64"), {
    maxB64Bytes: 1_000_000,
    force: true,
  });

  assert.equal(result.compressed, true);
  assert.equal(result.inputBytes, png.toString("base64").length);
  assert.ok(result.outputBytes <= 1_000_000);
});
