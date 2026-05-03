#!/usr/bin/env node
import { open, readdir, mkdir, rename, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import sharp from "sharp";

const IMAGE_EXT_RE = /\.(png|jpe?g|webp)$/i;
const DEFAULT_ROOT = resolve(process.cwd(), "generated");

function parseArgs(argv) {
  const args = {
    apply: false,
    purgeThumbs: false,
    root: DEFAULT_ROOT,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") {
      args.apply = true;
    } else if (arg === "--purge-thumbs") {
      args.purgeThumbs = true;
    } else if (arg === "--root") {
      const value = argv[i + 1];
      if (!value) throw new Error("--root requires a path");
      args.root = resolve(value);
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

async function hasSupportedImageSignature(file) {
  const fh = await open(file, "r");
  try {
    const buf = Buffer.alloc(12);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    if (bytesRead < 4) return false;
    const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    const isWebp =
      bytesRead >= 12 &&
      buf.subarray(0, 4).toString("ascii") === "RIFF" &&
      buf.subarray(8, 12).toString("ascii") === "WEBP";
    return isPng || isJpeg || isWebp;
  } finally {
    await fh.close();
  }
}

async function isValidImage(file) {
  try {
    if (!(await hasSupportedImageSignature(file))) return false;
    await sharp(file, { failOn: "warning" }).metadata();
    return true;
  } catch {
    return false;
  }
}

async function walkImages(root, dir = root) {
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err?.code === "ENOENT") return [];
    throw err;
  }
  const files = [];
  for (const entry of entries) {
    if (entry.name === ".trash" || entry.name === ".thumbs") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkImages(root, full));
    } else if (entry.isFile() && IMAGE_EXT_RE.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

async function collectInvalid(root) {
  const files = await walkImages(root);
  const invalid = [];
  for (const file of files) {
    if (!(await isValidImage(file))) invalid.push(file);
  }
  return invalid;
}

async function dirStats(dir) {
  const files = [];
  async function walk(current) {
    let entries = [];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (err) {
      if (err?.code === "ENOENT") return;
      throw err;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        files.push(full);
      }
    }
  }
  await walk(dir);
  let bytes = 0;
  for (const file of files) bytes += (await stat(file)).size;
  return { count: files.length, bytes };
}

async function purgeDirectoryContents(dir) {
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err?.code === "ENOENT") return;
    throw err;
  }
  for (const entry of entries) {
    await rm(join(dir, entry.name), { recursive: true, force: true });
  }
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return [
    d.getFullYear(),
    pad(d.getMonth() + 1),
    pad(d.getDate()),
    "-",
    pad(d.getHours()),
    pad(d.getMinutes()),
    pad(d.getSeconds()),
  ].join("");
}

async function movePreservingRoot(file, root, trashRoot) {
  const rel = relative(root, file);
  const dest = join(trashRoot, rel);
  await mkdir(dirname(dest), { recursive: true });
  await rename(file, dest);
  return dest;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = args.root;
  const invalid = await collectInvalid(root);
  const sidecars = invalid.map((file) => `${file}.json`).filter((file) => existsSync(file));
  let bytes = 0;
  for (const file of [...invalid, ...sidecars]) {
    bytes += (await stat(file)).size;
  }

  const thumbsDir = join(root, ".thumbs");
  const thumbs = args.purgeThumbs ? await dirStats(thumbsDir) : { count: 0, bytes: 0 };

  console.log(`Generated root: ${root}`);
  console.log(`Mode: ${args.apply ? "apply" : "dry-run"}`);
  console.log(`Invalid images: ${invalid.length}`);
  console.log(`Sidecars: ${sidecars.length}`);
  console.log(`Bytes to move: ${bytes}`);
  if (args.purgeThumbs) {
    console.log(`Thumbnail cache entries: ${thumbs.count}`);
    console.log(`Thumbnail cache bytes: ${thumbs.bytes}`);
  }
  for (const file of invalid.slice(0, 20)) {
    console.log(`- ${relative(root, file)}`);
  }
  if (invalid.length > 20) {
    console.log(`... ${invalid.length - 20} more`);
  }

  if (!args.apply) {
    console.log("Dry run only. Re-run with --apply to move invalid assets.");
    return;
  }

  const trashRoot = join(root, ".trash", `invalid-cleanup-${timestamp()}`);
  await mkdir(trashRoot, { recursive: true });
  for (const file of invalid) {
    await movePreservingRoot(file, root, trashRoot);
    const sidecar = `${file}.json`;
    if (existsSync(sidecar)) await movePreservingRoot(sidecar, root, trashRoot);
  }
  if (args.purgeThumbs) await purgeDirectoryContents(thumbsDir);
  console.log(`Moved invalid assets to: ${trashRoot}`);
}

main().catch((err) => {
  console.error(err?.stack || err);
  process.exit(1);
});
