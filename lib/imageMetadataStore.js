import { readFile, writeFile } from "fs/promises";
import sharp from "sharp";
import {
  buildIma2MetadataPayload,
  buildIma2Xmp,
  normalizeSidecarMetadata,
  parseIma2Xmp,
} from "./imageMetadata.js";

const SUPPORTED_FORMATS = new Set(["png", "jpeg", "jpg", "webp"]);

export function normalizeImageMetadataFormat(format) {
  const normalized = String(format || "").toLowerCase();
  return normalized === "jpg" ? "jpeg" : normalized;
}

export function isSupportedMetadataFormat(format) {
  return SUPPORTED_FORMATS.has(String(format || "").toLowerCase());
}

export async function embedImageMetadata(buffer, format, metadata, context = {}) {
  const normalizedFormat = normalizeImageMetadataFormat(format);
  if (!isSupportedMetadataFormat(normalizedFormat)) {
    const err = new Error(`Unsupported image metadata format: ${format}`);
    err.code = "IMAGE_METADATA_UNSUPPORTED_FORMAT";
    throw err;
  }
  const payload = buildIma2MetadataPayload(metadata, context);
  const xmp = buildIma2Xmp(payload);
  const next = await sharp(buffer, { failOn: "none" })
    .toFormat(normalizedFormat)
    .withXmp(xmp)
    .toBuffer();
  return { buffer: next, embedded: true, metadata: payload };
}

export async function embedImageMetadataBestEffort(buffer, format, metadata, context = {}) {
  try {
    return await embedImageMetadata(buffer, format, metadata, context);
  } catch (error) {
    return {
      buffer,
      embedded: false,
      warning: error?.message || "metadata embedding failed",
      code: error?.code || "IMAGE_METADATA_EMBED_FAILED",
    };
  }
}

export async function readEmbeddedImageMetadata(buffer) {
  const meta = await sharp(buffer, { failOn: "none" }).metadata();
  const xmpString = meta.xmpAsString || (meta.xmp ? meta.xmp.toString("utf8") : "");
  const xmp = parseIma2Xmp(xmpString);
  if (xmp) return { metadata: xmp, source: "xmp", warnings: [] };

  for (const comment of meta.comments || []) {
    const parsed = parseIma2Xmp(comment?.text || "");
    if (parsed) return { metadata: parsed, source: "png-comment", warnings: [] };
  }
  return {
    metadata: null,
    source: null,
    warnings: ["No ima2 metadata found in this image."],
  };
}

export async function readEmbeddedImageMetadataFromFile(path) {
  return readEmbeddedImageMetadata(await readFile(path));
}

export async function writeGenerationMetadataSidecar(imagePath, metadata, context = {}) {
  const payload = normalizeSidecarMetadata(metadata, context);
  await writeFile(`${imagePath}.json`, JSON.stringify({ ...metadata, embeddedMetadata: payload }, null, 2));
  return payload;
}

export async function readGenerationMetadataSidecar(imagePath, context = {}) {
  try {
    const parsed = JSON.parse(await readFile(`${imagePath}.json`, "utf-8"));
    return normalizeSidecarMetadata(parsed.embeddedMetadata || parsed, context);
  } catch {
    return null;
  }
}

export async function readImageMetadataWithSidecar(imagePath, context = {}) {
  const warnings = [];
  try {
    const embedded = await readEmbeddedImageMetadataFromFile(imagePath);
    if (embedded.metadata) return embedded;
    warnings.push(...(embedded.warnings || []));
  } catch (error) {
    warnings.push(error?.message || "Failed to read embedded metadata.");
  }

  const sidecar = await readGenerationMetadataSidecar(imagePath, context);
  if (sidecar) {
    return { metadata: sidecar, source: "sidecar", warnings };
  }
  return { metadata: null, source: null, warnings };
}
