import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const PORT = String(4100 + Math.floor(Math.random() * 100));
const FAKE_HOME = mkdtempSync(join(tmpdir(), "ima2-node-import-home-"));
const GEN_DIR = join(process.cwd(), "generated");
const TEST_PREFIX = `node_import_${Date.now()}_`;
const SOURCE_FILENAME = `${TEST_PREFIX}source.png`;

async function waitForHealth(base, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) });
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("server did not start");
}

describe("Node import API", () => {
  let child;
  const base = `http://localhost:${PORT}`;
  const createdFiles = new Set([SOURCE_FILENAME, `${SOURCE_FILENAME}.json`]);
  let importedFilename = null;
  let attachedFilename = null;

  before(async () => {
    mkdirSync(GEN_DIR, { recursive: true });
    const pngStub = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    writeFileSync(join(GEN_DIR, SOURCE_FILENAME), pngStub);
    writeFileSync(
      join(GEN_DIR, `${SOURCE_FILENAME}.json`),
      JSON.stringify({
        prompt: "source prompt",
        quality: "medium",
        size: "1536x1024",
        format: "png",
        moderation: "low",
        provider: "oauth",
        createdAt: Date.now() - 1000,
        usage: { input_tokens: 10 },
        webSearchCalls: 2,
      }),
    );

    child = spawn("node", ["server.js"], {
      env: {
        ...process.env,
        PORT,
        HOME: FAKE_HOME,
        USERPROFILE: FAKE_HOME,
        IMA2_DB_PATH: join(FAKE_HOME, "sessions.db"),
        IMA2_NO_OAUTH_PROXY: "1",
      },
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    await waitForHealth(base);
  });

  after(async () => {
    if (child && !child.killed) {
      child.kill(process.platform === "win32" ? "SIGINT" : "SIGTERM");
      await new Promise((r) => child.on("exit", r));
    }
    if (importedFilename) {
      createdFiles.add(importedFilename);
      createdFiles.add(`${importedFilename}.json`);
    }
    if (attachedFilename) {
      createdFiles.add(attachedFilename);
      createdFiles.add(`${attachedFilename}.json`);
    }
    for (const fn of createdFiles) {
      rmSync(join(GEN_DIR, fn), { force: true });
    }
    rmSync(FAKE_HOME, { recursive: true, force: true });
  });

  it("copies an existing generated asset into a node-owned file with import metadata", async () => {
    const res = await fetch(`${base}/api/node/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: SOURCE_FILENAME,
        sessionId: "session-import",
        clientNodeId: "client-node-import",
      }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    importedFilename = body.filename;

    assert.match(body.nodeId, /^n_[a-f0-9]+$/);
    assert.strictEqual(body.filename, `${body.nodeId}.png`);
    assert.strictEqual(body.url, `/generated/${body.filename}`);
    assert.strictEqual(body.prompt, "source prompt");
    assert.strictEqual(body.provider, "oauth");
    assert.ok(existsSync(join(GEN_DIR, body.filename)), "copied node image exists");

    const meta = JSON.parse(readFileSync(join(GEN_DIR, `${body.filename}.json`), "utf-8"));
    assert.strictEqual(meta.nodeId, body.nodeId);
    assert.strictEqual(meta.parentNodeId, null);
    assert.strictEqual(meta.sessionId, "session-import");
    assert.strictEqual(meta.clientNodeId, "client-node-import");
    assert.strictEqual(meta.prompt, "source prompt");
    assert.deepStrictEqual(meta.options, {
      quality: "medium",
      size: "1536x1024",
      format: "png",
      moderation: "low",
    });
    assert.strictEqual(meta.kind, "import");
    assert.strictEqual(meta.elapsed, null);
    assert.strictEqual(meta.usage, null);
    assert.strictEqual(meta.webSearchCalls, 2);
  });

  it("rejects filenames that escape generated", async () => {
    const res = await fetch(`${base}/api/node/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "../outside.png" }),
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.error.code, "NODE_SOURCE_INVALID");
  });

  it("attaches an uploaded image into a node-owned file with upload metadata", async () => {
    const res = await fetch(`${base}/api/node/attach`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image: "data:image/webp;base64,UklGRg==",
        prompt: "uploaded start",
        sessionId: "session-attach",
        clientNodeId: "client-node-attach",
      }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    attachedFilename = body.filename;

    assert.match(body.nodeId, /^n_[a-f0-9]+$/);
    assert.strictEqual(body.filename, `${body.nodeId}.webp`);
    assert.strictEqual(body.url, `/generated/${body.filename}`);
    assert.strictEqual(body.prompt, "uploaded start");
    assert.strictEqual(body.provider, "upload");
    assert.strictEqual(body.format, "webp");
    assert.ok(existsSync(join(GEN_DIR, body.filename)), "attached node image exists");

    const meta = JSON.parse(readFileSync(join(GEN_DIR, `${body.filename}.json`), "utf-8"));
    assert.strictEqual(meta.nodeId, body.nodeId);
    assert.strictEqual(meta.parentNodeId, null);
    assert.strictEqual(meta.sessionId, "session-attach");
    assert.strictEqual(meta.clientNodeId, "client-node-attach");
    assert.strictEqual(meta.prompt, "uploaded start");
    assert.deepStrictEqual(meta.options, {
      quality: null,
      size: null,
      format: "webp",
      moderation: null,
    });
    assert.strictEqual(meta.kind, "import");
    assert.strictEqual(meta.source, "upload");
    assert.strictEqual(meta.provider, "upload");
    assert.strictEqual(meta.elapsed, null);
    assert.strictEqual(meta.usage, null);
    assert.strictEqual(meta.webSearchCalls, 0);
  });

  it("rejects unsupported uploaded image types", async () => {
    const res = await fetch(`${base}/api/node/attach`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: "data:image/gif;base64,R0lGODlh" }),
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.error.code, "NODE_SOURCE_INVALID");
  });

  it("returns 404 for a missing generated asset", async () => {
    const res = await fetch(`${base}/api/node/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: `${TEST_PREFIX}missing.png` }),
    });
    assert.strictEqual(res.status, 404);
    const body = await res.json();
    assert.strictEqual(body.error.code, "NODE_NOT_FOUND");
  });

  it("shows imported node assets in history", async () => {
    assert.ok(importedFilename, "successful import test produced a filename");
    const res = await fetch(`${base}/api/history?sessionId=session-import&limit=10`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    const item = body.items.find((row) => row.filename === importedFilename);
    assert.ok(item, "imported file appears in history");
    assert.strictEqual(item.kind, "import");
    assert.strictEqual(item.nodeId, importedFilename.replace(/\.png$/, ""));
    assert.strictEqual(item.sessionId, "session-import");
    assert.strictEqual(item.prompt, "source prompt");
  });
});
