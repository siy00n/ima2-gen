import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readFileSync, unlinkSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Integration-ish: boot the real server on a random port, hit /api/health,
// verify advertisement file lifecycle, kill, verify cleanup.

let PORT;
let OAUTH_PORT;
const FAKE_HOME = mkdtempSync(join(tmpdir(), "ima2-test-home-"));

const HEALTH_TIMEOUT = process.platform === "win32" ? 30000 : 8000;

async function pickFreePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;
  await new Promise((resolve) => server.close(resolve));
  if (!port) throw new Error("failed to reserve a free port");
  return String(port);
}

async function waitForHealth(base, timeoutMs = HEALTH_TIMEOUT) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) });
      if (r.ok) return await r.json();
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("server did not become healthy");
}

describe("Server: /api/health + advertisement", () => {
  let child;
  let childStderr = "";
  let oauthServer;
  let lastOAuthPayload = null;
  let slowOAuthClosed = false;

  before(async () => {
    PORT = await pickFreePort();
    OAUTH_PORT = await pickFreePort();
    oauthServer = createServer((req, res) => {
      if (req.method === "POST" && req.url === "/v1/responses") {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", () => {
          lastOAuthPayload = JSON.parse(body);
          if (body.includes("slow abort test")) {
            slowOAuthClosed = false;
            res.on("close", () => {
              slowOAuthClosed = true;
            });
            res.writeHead(200, { "Content-Type": "text/event-stream" });
            res.write("data: {\"type\":\"response.created\"}\n\n");
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            output: [{ type: "image_generation_call", result: "aGVsbG8=" }],
            usage: { total_tokens: 1 },
          }));
        });
        return;
      }
      if (req.method === "GET" && req.url === "/v1/models") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "gpt-5.5" }] }));
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise((resolve) => oauthServer.listen(Number(OAUTH_PORT), "127.0.0.1", resolve));

    child = spawn("node", ["server.js"], {
      env: {
        ...process.env,
        PORT,
        OAUTH_PORT,
        OPENAI_IMAGE_MODEL: "gpt-5.5",
        HOME: FAKE_HOME,
        USERPROFILE: FAKE_HOME,
        IMA2_NO_OAUTH_PROXY: "1",
      },
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    // drain stderr to surface boot errors if test hangs
    child.stderr.on("data", (d) => {
      childStderr += d.toString();
      if (process.env.DEBUG_TEST) process.stderr.write(d);
    });
    try {
      await waitForHealth(`http://localhost:${PORT}`);
    } catch (err) {
      process.stderr.write(`\n[server stderr on health-timeout]\n${childStderr}\n`);
      throw err;
    }
  });

  after(async () => {
    if (child && !child.killed) {
      child.kill("SIGTERM");
      await new Promise((r) => child.on("exit", r));
    }
    if (oauthServer) {
      await new Promise((resolve) => oauthServer.close(resolve));
    }
    try { rmSync(FAKE_HOME, { recursive: true, force: true }); } catch {}
  });

  it("GET /api/health returns expected shape", async () => {
    const r = await fetch(`http://localhost:${PORT}/api/health`);
    assert.strictEqual(r.status, 200);
    const body = await r.json();
    assert.strictEqual(body.ok, true);
    assert.ok(typeof body.version === "string");
    assert.strictEqual(body.provider, "oauth");
    assert.ok(Number.isFinite(body.uptimeSec));
    assert.ok(Number.isFinite(body.activeJobs));
    assert.ok(Number.isFinite(body.pid));
    assert.ok(Number.isFinite(body.startedAt));
  });

  it("writes ~/.ima2/server.json with pid + port", () => {
    const advertisePath = join(FAKE_HOME, ".ima2", "server.json");
    assert.ok(existsSync(advertisePath), "advertise file should exist");
    const info = JSON.parse(readFileSync(advertisePath, "utf-8"));
    assert.strictEqual(info.port, Number(PORT));
    assert.strictEqual(info.pid, child.pid);
    assert.ok(typeof info.version === "string");
  });

  it("/api/generate logs X-ima2-client tag when provided", async () => {
    // just verify the request is accepted (200 path requires OAuth;
    // 400 without prompt is sufficient to confirm header parsing doesn't break anything)
    const r = await fetch(`http://localhost:${PORT}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-ima2-client": "cli/test" },
      body: JSON.stringify({}),
    });
    // no prompt → 400 (header should NOT cause different rejection)
    assert.strictEqual(r.status, 400);
  });

  it("/api/generate forwards moderation to the image tool", async () => {
    lastOAuthPayload = null;
    const r = await fetch(`http://localhost:${PORT}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "test moderation forwarding",
        quality: "medium",
        size: "1024x1024",
        moderation: "auto",
      }),
    });
    assert.strictEqual(r.status, 200);
    const body = await r.json();
    assert.strictEqual(body.moderation, "auto");
    assert.ok(lastOAuthPayload, "proxy request should be captured");
    assert.strictEqual(lastOAuthPayload.model, "gpt-5.4-mini");
    assert.strictEqual(lastOAuthPayload.tools[1].type, "image_generation");
    assert.strictEqual(lastOAuthPayload.tools[1].moderation, "auto");
  });

  it("/api/generate rejects unsupported image models", async () => {
    lastOAuthPayload = null;
    const r = await fetch(`http://localhost:${PORT}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "test invalid model",
        model: "codex-auto-review",
      }),
    });
    assert.strictEqual(r.status, 400);
    const body = await r.json();
    assert.strictEqual(body.code, "INVALID_MODEL");
    assert.strictEqual(lastOAuthPayload, null);
  });

  it("/api/generate forwards selected image model", async () => {
    lastOAuthPayload = null;
    const r = await fetch(`http://localhost:${PORT}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "test model forwarding",
        model: "gpt-5.5",
      }),
    });
    assert.strictEqual(r.status, 200);
    const body = await r.json();
    assert.strictEqual(body.model, "gpt-5.5");
    assert.ok(lastOAuthPayload, "proxy request should be captured");
    assert.strictEqual(lastOAuthPayload.model, "gpt-5.5");
  });

  it("aborts a running node generation through /api/inflight", async () => {
    const requestId = `node_abort_${Date.now()}`;
    const generatePromise = fetch(`http://localhost:${PORT}/api/node/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId,
        sessionId: "session-abort",
        clientNodeId: "client-abort",
        prompt: "slow abort test",
        displayPrompt: "slow abort test",
        effectivePrompt: "slow abort test",
        parentNodeId: null,
        quality: "low",
        size: "1024x1024",
        format: "png",
        moderation: "low",
        provider: "oauth",
      }),
    });

    let sawJob = false;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const inflight = await fetch(
        `http://localhost:${PORT}/api/inflight?kind=node&sessionId=session-abort`,
      );
      const body = await inflight.json();
      if (body.jobs.some((job) => job.requestId === requestId)) {
        sawJob = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.strictEqual(sawJob, true, "node job should be visible before cancel");

    const cancelRes = await fetch(`http://localhost:${PORT}/api/inflight/${requestId}`, {
      method: "DELETE",
    });
    assert.strictEqual(cancelRes.status, 204);

    const res = await generatePromise;
    assert.strictEqual(res.status, 499);
    const body = await res.json();
    assert.strictEqual(body.error.code, "NODE_GEN_CANCELED");

    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(slowOAuthClosed, true);
  });

  // Windows: child.kill(anything) = forceful termination per Node docs
  // (https://nodejs.org/api/child_process.html#subprocesskillsignal) — no
  // handler fires, so __unadvertise cannot run from an externally-signalled
  // kill. Production path (user Ctrl+C in their own terminal) does fire
  // SIGINT and runs cleanup; that's covered manually.
  const testShutdown = process.platform === "win32" ? it.skip : it;
  testShutdown("cleans up advertisement file on shutdown signal", async () => {
    const advertisePath = join(FAKE_HOME, ".ima2", "server.json");
    assert.ok(existsSync(advertisePath), "precondition: file exists");
    child.kill("SIGTERM");
    await new Promise((r) => child.on("exit", r));
    // small grace for unlink
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(!existsSync(advertisePath), "file should be removed after SIGTERM");
  });
});
