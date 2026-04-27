import { writeFile, readFile, access, copyFile, realpath, readdir } from "fs/promises";
import { extname, join, resolve, sep } from "path";
import { randomBytes } from "crypto";
import { embedImageMetadataBestEffort } from "./imageMetadataStore.js";

const DIR = "generated";
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp"]);

export function newNodeId() {
  return "n_" + randomBytes(5).toString("hex");
}

export async function saveNode(rootDir, { nodeId, b64, meta, ext = "png" }) {
  const filename = `${nodeId}.${ext}`;
  const raw = Buffer.from(b64, "base64");
  const embedded = await embedImageMetadataBestEffort(raw, ext, meta);
  await writeFile(join(rootDir, DIR, filename), embedded.buffer);
  await writeFile(join(rootDir, DIR, filename + ".json"), JSON.stringify(meta, null, 2));
  return { filename };
}

export async function loadNodeB64(rootDir, filename) {
  const p = resolveGeneratedPath(rootDir, filename);
  try { await access(p); } catch {
    const err = new Error(`Node file not found: ${filename}`);
    err.code = "NODE_NOT_FOUND";
    err.status = 404;
    throw err;
  }
  const buf = await readFile(p);
  return buf.toString("base64");
}

export async function loadNodeImage(rootDir, nodeId) {
  const filename = await findNodeImageFilename(rootDir, nodeId);
  return {
    filename,
    b64: await loadNodeB64(rootDir, filename),
    mime: mimeForImageFilename(filename),
  };
}

export async function loadNodeImageB64(rootDir, nodeId) {
  const image = await loadNodeImage(rootDir, nodeId);
  return image.b64;
}

async function findNodeImageFilename(rootDir, nodeId) {
  const candidates = [];
  const meta = await loadNodeMeta(rootDir, nodeId, null);
  const metaFormat = meta?.options?.format || meta?.format;
  if (typeof metaFormat === "string" && metaFormat.length > 0) {
    candidates.push(`${nodeId}.${metaFormat}`);
    if (metaFormat === "jpeg") candidates.push(`${nodeId}.jpg`);
    if (metaFormat === "jpg") candidates.push(`${nodeId}.jpeg`);
  }
  candidates.push(`${nodeId}.png`, `${nodeId}.jpeg`, `${nodeId}.jpg`, `${nodeId}.webp`);

  for (const filename of [...new Set(candidates)]) {
    const ext = extname(filename).slice(1).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) continue;
    try {
      await access(resolveGeneratedPath(rootDir, filename));
      return filename;
    } catch {}
  }

  try {
    const entries = await readdir(join(rootDir, DIR));
    const found = entries.find((name) => {
      const ext = extname(name).slice(1).toLowerCase();
      return name.startsWith(`${nodeId}.`) && IMAGE_EXTS.has(ext);
    });
    if (found) return found;
  } catch {}

  const err = new Error(`Node image not found: ${nodeId}`);
  err.code = "NODE_NOT_FOUND";
  err.status = 404;
  throw err;
}

function mimeForImageFilename(filename) {
  const ext = extname(filename).slice(1).toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  return "image/png";
}

export async function loadNodeMeta(rootDir, nodeId, ext = "png") {
  if (ext) {
    try {
      return JSON.parse(await readFile(join(rootDir, DIR, `${nodeId}.${ext}.json`), "utf-8"));
    } catch {}
  }
  try {
    const entries = await readdir(join(rootDir, DIR));
    const sidecar = entries.find((name) => name.startsWith(`${nodeId}.`) && name.endsWith(".json"));
    if (!sidecar) return null;
    return JSON.parse(await readFile(join(rootDir, DIR, sidecar), "utf-8"));
  } catch {
    return null;
  }
}

export async function loadAssetB64(rootDir, externalSrc) {
  const p = resolveGeneratedPath(rootDir, externalSrc);
  try { await access(p); } catch {
    const err = new Error(`Asset file not found: ${externalSrc}`);
    err.code = "NODE_NOT_FOUND";
    err.status = 404;
    throw err;
  }
  const buf = await readFile(p);
  return buf.toString("base64");
}

export async function importAssetAsNode(rootDir, { filename, nodeId, meta }) {
  const src = resolveGeneratedPath(rootDir, filename);
  try { await access(src); } catch {
    const err = new Error(`Asset file not found: ${filename}`);
    err.code = "NODE_NOT_FOUND";
    err.status = 404;
    throw err;
  }
  const realBase = await realpath(join(rootDir, DIR));
  const realSrc = await realpath(src);
  if (realSrc !== realBase && !realSrc.startsWith(realBase + sep)) {
    const err = new Error(`Asset path escapes generated/: ${filename}`);
    err.code = "NODE_SOURCE_INVALID";
    err.status = 400;
    throw err;
  }

  const ext = extname(src).slice(1).toLowerCase();
  if (!IMAGE_EXTS.has(ext)) {
    const err = new Error("Asset must be a png, jpg, jpeg, or webp image");
    err.code = "NODE_SOURCE_INVALID";
    err.status = 400;
    throw err;
  }

  const outMeta = {
    ...meta,
    format: meta?.format || ext,
    options: {
      ...(meta?.options || {}),
      format: meta?.options?.format || meta?.format || ext,
    },
  };
  const outFilename = `${nodeId}.${ext}`;
  await copyFile(src, join(rootDir, DIR, outFilename));
  await writeFile(join(rootDir, DIR, `${outFilename}.json`), JSON.stringify(outMeta, null, 2));
  return { filename: outFilename, ext };
}

export async function loadAssetMeta(rootDir, filename) {
  const p = resolveGeneratedPath(rootDir, filename);
  try {
    return JSON.parse(await readFile(`${p}.json`, "utf-8"));
  } catch {
    return null;
  }
}

function resolveGeneratedPath(rootDir, relPath) {
  if (typeof relPath !== "string" || relPath.length === 0) {
    const err = new Error("Asset path is required");
    err.code = "NODE_SOURCE_INVALID";
    err.status = 400;
    throw err;
  }
  if (relPath.includes("\0")) {
    const err = new Error("Asset path is invalid");
    err.code = "NODE_SOURCE_INVALID";
    err.status = 400;
    throw err;
  }
  const baseDir = resolve(rootDir, DIR);
  const target = resolve(baseDir, relPath);
  if (target !== baseDir && !target.startsWith(baseDir + sep)) {
    const err = new Error(`Asset path escapes generated/: ${relPath}`);
    err.code = "NODE_SOURCE_INVALID";
    err.status = 400;
    throw err;
  }
  return target;
}
