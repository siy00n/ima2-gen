import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "../ui/node_modules/typescript/lib/typescript.js";

const IMAGE_MODES = ["off", "parent", "ancestor"];
const BOOLEAN_VALUES = [false, true];
const MAX_ANCESTOR_COUNTS = [1, 3, 5, 8];

const SETTINGS = {
  A: {
    model: "gpt-5.5",
    quality: "high",
    sizePreset: "1536x1024",
    customW: 1920,
    customH: 1088,
    format: "webp",
    moderation: "auto",
  },
  B: {
    model: "gpt-5.4",
    quality: "medium",
    sizePreset: "1024x1536",
    customW: 1920,
    customH: 1088,
    format: "jpeg",
    moderation: "low",
  },
  C: {
    model: "gpt-5.4-mini",
    quality: "low",
    sizePreset: "2048x2048",
    customW: 1920,
    customH: 1088,
    format: "png",
    moderation: "low",
  },
  D: {
    model: "gpt-5.4",
    quality: "medium",
    sizePreset: "1024x1024",
    customW: 1920,
    customH: 1088,
    format: "webp",
    moderation: "auto",
  },
};

let deliveryModulePromise;

async function loadDeliveryModule() {
  if (!deliveryModulePromise) {
    deliveryModulePromise = (async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "ima2-node-delivery-"));
      const source = readFileSync(join(process.cwd(), "ui/src/lib/nodeDelivery.ts"), "utf8");
      const transpiled = ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.ES2022,
          target: ts.ScriptTarget.ES2022,
          verbatimModuleSyntax: true,
        },
      }).outputText;
      const outputPath = join(tempDir, "nodeDelivery.mjs");
      writeFileSync(outputPath, transpiled);
      try {
        return await import(pathToFileURL(outputPath).href);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    })();
  }
  return deliveryModulePromise;
}

function makeNode(id, overrides = {}) {
  return {
    id,
    data: {
      serverNodeId: `n_${id}`,
      name: `Node ${id}`,
      prompt: `Prompt ${id}`,
      settings: { ...SETTINGS[id] },
      ...overrides,
    },
  };
}

function makeNodes(overrides = {}) {
  return ["A", "B", "C", "D"].map((id) => makeNode(id, overrides[id]));
}

function makeEdge(source, target, data = {}) {
  return {
    id: `${source}-${target}`,
    source,
    target,
    data: {
      imageTransfer: "parent",
      transferContext: true,
      transferSettings: true,
      maxAncestorImages: 8,
      ...data,
    },
  };
}

function makeEdges(finalEdgeData, overrides = {}) {
  return [
    makeEdge("A", "B", overrides.AB),
    makeEdge("B", "C", overrides.BC),
    makeEdge("C", "D", finalEdgeData),
  ];
}

function expectedAncestorsFor(maxAncestorImages) {
  return ["n_A", "n_B"].slice(-maxAncestorImages);
}

function assertPromptContext(delivery, { imageMode, transferContext }) {
  assert.strictEqual(delivery.payload.prompt, delivery.effectivePrompt);
  assert.match(delivery.effectivePrompt, /Current node instruction:\nPrompt D|^Prompt D$/);

  const hasWorkflowContextLines =
    delivery.effectivePrompt.includes("1. n_A: Prompt A") &&
    delivery.effectivePrompt.includes("2. n_B: Prompt B") &&
    delivery.effectivePrompt.includes("3. n_C: Prompt C");
  assert.strictEqual(
    hasWorkflowContextLines,
    transferContext,
    `workflow prompt chain mismatch for ${imageMode} / CTX ${transferContext}`,
  );

  const hasVisualReferenceSection = delivery.effectivePrompt.includes("Attached visual references:");
  assert.strictEqual(
    hasVisualReferenceSection,
    imageMode !== "off",
    `visual reference section mismatch for ${imageMode}`,
  );
}

function assertSettings(delivery, transferSettings) {
  const expected = transferSettings ? SETTINGS.A : SETTINGS.D;
  assert.deepStrictEqual(delivery.nodeSettings, expected);
  assert.strictEqual(delivery.payload.model, expected.model);
  assert.strictEqual(delivery.payload.quality, expected.quality);
  assert.strictEqual(delivery.payload.size, expected.sizePreset);
  assert.strictEqual(delivery.payload.format, expected.format);
  assert.strictEqual(delivery.payload.moderation, expected.moderation);
}

describe("Node delivery matrix", () => {
  it("covers IMG / CTX / SET / max ancestor combinations with the real delivery helper", async () => {
    const { buildNodeGenerateDelivery } = await loadDeliveryModule();
    const rows = [];

    for (const imageMode of IMAGE_MODES) {
      for (const transferContext of BOOLEAN_VALUES) {
        for (const transferSettings of BOOLEAN_VALUES) {
          for (const maxAncestorImages of MAX_ANCESTOR_COUNTS) {
            const delivery = buildNodeGenerateDelivery(
              makeNodes(),
              makeEdges({
                imageTransfer: imageMode,
                transferContext,
                transferSettings,
                maxAncestorImages,
              }),
              "D",
              { sessionId: "session_matrix", requestId: "request_matrix" },
            );
            assert.ok(delivery, `delivery missing for ${imageMode}/${transferContext}/${transferSettings}/${maxAncestorImages}`);

            const expectedAncestorIds =
              imageMode === "ancestor" ? expectedAncestorsFor(maxAncestorImages) : [];
            const expectedVisualNodeIds =
              imageMode === "off"
                ? []
                : imageMode === "parent"
                  ? ["n_C"]
                  : [...expectedAncestorIds, "n_C"];

            assert.strictEqual(delivery.imageTransfer, imageMode);
            assert.strictEqual(delivery.payload.imageTransfer, undefined);
            assert.strictEqual(delivery.parentNode?.id ?? null, "C");
            assert.strictEqual(delivery.parentNodeId, imageMode === "off" ? null : "n_C");
            assert.strictEqual(delivery.payload.parentNodeId, imageMode === "off" ? null : "n_C");
            assert.deepStrictEqual(delivery.ancestorNodeIds, expectedAncestorIds);
            assert.deepStrictEqual(delivery.payload.ancestorNodeIds, expectedAncestorIds);
            assert.deepStrictEqual(
              delivery.visualContext.map((item) => item.nodeId),
              expectedVisualNodeIds,
            );
            assert.deepStrictEqual(delivery.payload.visualContext, delivery.visualContext);
            assert.strictEqual(delivery.mode, imageMode === "off" ? "generate" : "edit");
            assert.strictEqual(delivery.payload.displayPrompt, "Prompt D");
            assert.strictEqual(delivery.payload.clientNodeId, "D");
            assert.strictEqual(delivery.payload.sessionId, "session_matrix");
            assert.strictEqual(delivery.payload.requestId, "request_matrix");
            assert.deepStrictEqual(delivery.issues, []);
            assertSettings(delivery, transferSettings);
            assertPromptContext(delivery, { imageMode, transferContext });

            rows.push({
              IMG: imageMode === "off" ? "-" : imageMode === "parent" ? "P" : "A",
              CTX: transferContext ? "ON" : "OFF",
              SET: transferSettings ? "ON" : "OFF",
              maxAncestorImages,
              mode: delivery.mode,
              parent: delivery.parentNodeId ?? "-",
              ancestors: delivery.ancestorNodeIds.join(">") || "-",
              visuals: delivery.visualContext.map((item) => `${item.relation}:${item.nodeId}`).join(">") || "-",
              settingsModel: delivery.nodeSettings.model,
              workflowContext: transferContext ? "A>B>C" : "-",
            });
          }
        }
      }
    }

    console.table(rows);
    assert.strictEqual(rows.length, IMAGE_MODES.length * 2 * 2 * MAX_ANCESTOR_COUNTS.length);
  });

  it("cuts ancestor images at an upstream IMG off edge even when the max count is high", async () => {
    const { buildNodeGenerateDelivery } = await loadDeliveryModule();
    const delivery = buildNodeGenerateDelivery(
      makeNodes(),
      makeEdges(
        {
          imageTransfer: "ancestor",
          transferContext: true,
          transferSettings: true,
          maxAncestorImages: 8,
        },
        { AB: { imageTransfer: "off" } },
      ),
      "D",
    );

    assert.ok(delivery);
    assert.deepStrictEqual(delivery.ancestorNodeIds, ["n_B"]);
    assert.deepStrictEqual(
      delivery.visualContext.map((item) => [item.relation, item.nodeId]),
      [
        ["ancestor", "n_B"],
        ["parent", "n_C"],
      ],
    );
  });

  it("cuts prompt context at an upstream CTX off edge", async () => {
    const { buildNodeGenerateDelivery } = await loadDeliveryModule();
    const delivery = buildNodeGenerateDelivery(
      makeNodes(),
      makeEdges(
        {
          imageTransfer: "off",
          transferContext: true,
          transferSettings: false,
          maxAncestorImages: 8,
        },
        { BC: { transferContext: false } },
      ),
      "D",
    );

    assert.ok(delivery);
    assert.match(delivery.effectivePrompt, /1\. n_C: Prompt C/);
    assert.doesNotMatch(delivery.effectivePrompt, /Prompt A/);
    assert.doesNotMatch(delivery.effectivePrompt, /Prompt B/);
    assert.deepStrictEqual(delivery.visualContext, []);
    assert.strictEqual(delivery.parentNodeId, null);
  });

  it("cuts inherited settings at an upstream SET off edge", async () => {
    const { buildNodeGenerateDelivery } = await loadDeliveryModule();
    const delivery = buildNodeGenerateDelivery(
      makeNodes(),
      makeEdges(
        {
          imageTransfer: "off",
          transferContext: false,
          transferSettings: true,
          maxAncestorImages: 8,
        },
        { BC: { transferSettings: false } },
      ),
      "D",
    );

    assert.ok(delivery);
    assert.deepStrictEqual(delivery.nodeSettings, SETTINGS.C);
    assert.strictEqual(delivery.payload.model, SETTINGS.C.model);
    assert.strictEqual(delivery.payload.size, SETTINGS.C.sizePreset);
  });

  it("allows text-only parent context without requiring a parent image", async () => {
    const { buildNodeGenerateDelivery } = await loadDeliveryModule();
    const delivery = buildNodeGenerateDelivery(
      makeNodes({ C: { serverNodeId: null } }),
      makeEdges({
        imageTransfer: "off",
        transferContext: true,
        transferSettings: true,
        maxAncestorImages: 8,
      }),
      "D",
    );

    assert.ok(delivery);
    assert.strictEqual(delivery.mode, "generate");
    assert.strictEqual(delivery.parentNodeId, null);
    assert.deepStrictEqual(delivery.ancestorNodeIds, []);
    assert.deepStrictEqual(delivery.visualContext, []);
    assert.strictEqual(delivery.issues.find((issue) => issue.code === "missing-parent-image"), undefined);
    assert.match(delivery.effectivePrompt, /Prompt C/);
  });

  it("blocks image delivery when the direct parent image is missing", async () => {
    const { buildNodeGenerateDelivery } = await loadDeliveryModule();
    for (const imageMode of ["parent", "ancestor"]) {
      const delivery = buildNodeGenerateDelivery(
        makeNodes({ C: { serverNodeId: null } }),
        makeEdges({
          imageTransfer: imageMode,
          transferContext: true,
          transferSettings: true,
          maxAncestorImages: 8,
        }),
        "D",
        { parentRequiredMessage: "Parent image required for test" },
      );

      assert.ok(delivery);
      assert.strictEqual(delivery.parentNodeId, null);
      assert.ok(
        delivery.issues.some(
          (issue) =>
            issue.code === "missing-parent-image" &&
            issue.blocking &&
            issue.message === "Parent image required for test",
        ),
        `expected missing parent image issue for IMG ${imageMode}`,
      );
    }
  });
});
