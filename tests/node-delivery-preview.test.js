import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
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

const PORT = String(4200 + Math.floor(Math.random() * 100));
const FAKE_HOME = mkdtempSync(join(tmpdir(), "ima2-node-preview-home-"));
const GEN_DIR = join(process.cwd(), "generated");
const NODE_IDS = ["n_preview_a", "n_preview_b", "n_preview_c"];

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

function writeNodeAsset(nodeId, prompt) {
  const filename = `${nodeId}.png`;
  writeFileSync(join(GEN_DIR, filename), Buffer.from("preview image bytes"));
  writeFileSync(
    join(GEN_DIR, `${filename}.json`),
    JSON.stringify({
      nodeId,
      prompt,
      displayPrompt: prompt,
      format: "png",
      options: { format: "png", size: "1024x1024", quality: "low", moderation: "low" },
      provider: "oauth",
      kind: "generate",
      createdAt: Date.now(),
    }),
  );
}

describe("Node delivery preview", () => {
  let child;
  const base = `http://localhost:${PORT}`;

  before(async () => {
    mkdirSync(GEN_DIR, { recursive: true });
    writeNodeAsset("n_preview_a", "A generated prompt");
    writeNodeAsset("n_preview_b", "B generated prompt");
    writeNodeAsset("n_preview_c", "C generated prompt");
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
    for (const nodeId of NODE_IDS) {
      rmSync(join(GEN_DIR, `${nodeId}.png`), { force: true });
      rmSync(join(GEN_DIR, `${nodeId}.png.json`), { force: true });
    }
    rmSync(FAKE_HOME, { recursive: true, force: true });
  });

  it("maps ancestor and parent images to labeled OpenAI preview content in order", async () => {
    const res = await fetch(`${base}/api/node/generate/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parentNodeId: "n_preview_c",
        ancestorNodeIds: ["n_preview_a", "n_preview_b"],
        visualContext: [
          {
            relation: "ancestor",
            nodeId: "n_preview_a",
            clientNodeId: "client-a",
            name: "Idea A",
            currentPrompt: "A current prompt",
          },
          {
            relation: "ancestor",
            nodeId: "n_preview_b",
            clientNodeId: "client-b",
            name: "Idea B",
            currentPrompt: "B current prompt",
          },
          {
            relation: "parent",
            nodeId: "n_preview_c",
            clientNodeId: "client-c",
            name: "Parent C",
            currentPrompt: "C current prompt",
          },
        ],
        prompt: "Previous workflow context\n\nCurrent node instruction:\nMake D",
        displayPrompt: "Make D",
        effectivePrompt: "Previous workflow context\n\nCurrent node instruction:\nMake D",
        quality: "low",
        size: "1024x1024",
        format: "png",
        moderation: "low",
        model: "gpt-5.4-mini",
      }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();

    assert.strictEqual(body.kind, "edit");
    assert.deepStrictEqual(
      body.images.map((image) => [image.relation, image.nodeId, image.filename]),
      [
        ["ancestor", "n_preview_a", "n_preview_a.png"],
        ["ancestor", "n_preview_b", "n_preview_b.png"],
        ["parent", "n_preview_c", "n_preview_c.png"],
      ],
    );
    assert.match(body.contentOrder[0].text, /Image 1 is an ancestor node/);
    assert.match(body.contentOrder[0].text, /Idea A/);
    assert.strictEqual(body.contentOrder[1].type, "input_image");
    assert.match(body.contentOrder[2].text, /Image 2 is an ancestor node/);
    assert.strictEqual(body.contentOrder[3].type, "input_image");
    assert.match(body.contentOrder[4].text, /direct parent node and primary visual source/);
    assert.strictEqual(body.contentOrder[5].type, "input_image");
    assert.match(body.contentOrder.at(-1).text, /Current node instruction/);
  });

  it("returns a structured preview error when a parent image is missing", async () => {
    const res = await fetch(`${base}/api/node/generate/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parentNodeId: "n_preview_missing",
        prompt: "Make child",
        quality: "low",
        size: "1024x1024",
        format: "png",
        moderation: "low",
        model: "gpt-5.4-mini",
      }),
    });
    assert.strictEqual(res.status, 404);
    const body = await res.json();
    assert.strictEqual(body.error.code, "NODE_NOT_FOUND");
  });

  it("keeps client preview and generation on the same delivery helper", () => {
    const source = readFileSync(join(process.cwd(), "ui/src/store/useAppStore.ts"), "utf8");
    assert.match(source, /buildNodeGeneratePreview:[\s\S]*buildNodeGenerateDelivery/);
    assert.match(source, /async generateNode[\s\S]*const delivery = buildNodeGenerateDelivery/);
    assert.match(source, /imageTransfer === "off"\) break/);
    assert.match(source, /slice\(-maxAncestorImages\)/);
  });
});
