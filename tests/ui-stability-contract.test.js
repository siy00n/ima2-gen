import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function readSource(path) {
  return readFileSync(join(root, path), "utf8");
}

describe("UI stability contracts", () => {
  it("keeps node attach state in the store and hides node-owned imports from gallery history", () => {
    const store = readSource("ui/src/store/useAppStore.ts");
    const inspector = readSource("ui/src/components/NodeInspector.tsx");
    const imageNode = readSource("ui/src/components/ImageNode.tsx");

    assert.match(store, /attachingNodeIds:/);
    assert.match(store, /finally[\s\S]*attachingNodeIds:/);
    assert.match(store, /function upsertHistoryItems/);
    assert.match(store, /item\.kind === "import"/);
    assert.doesNotMatch(store, /async attachImageToNode[\s\S]*get\(\)\.addHistoryItem\(\{[\s\S]*kind: "import"/);
    assert.doesNotMatch(store, /async importHistoryItemAsNode[\s\S]*get\(\)\.addHistoryItem\(\{[\s\S]*kind: "import"/);
    assert.match(inspector, /attachingNodeIds\.includes/);
    assert.match(imageNode, /attachingNodeIds\.includes/);
  });

  it("removes the nonfunctional node menu placeholder and enables classic navigation", () => {
    const imageNode = readSource("ui/src/components/ImageNode.tsx");
    const canvas = readSource("ui/src/components/Canvas.tsx");
    const css = readSource("ui/src/index.css");

    assert.doesNotMatch(imageNode, /image-node__menu/);
    assert.doesNotMatch(css, /\.image-node__menu/);
    assert.match(canvas, /ArrowLeft/);
    assert.match(canvas, /ArrowRight/);
    assert.match(canvas, /isEditableTarget/);
    assert.match(css, /\.result-nav\s*\{/);
  });

  it("uses a desktop edge popover without switching the right inspector", () => {
    const store = readSource("ui/src/store/useAppStore.ts");
    const edge = readSource("ui/src/components/WorkflowEdge.tsx");
    const canvas = readSource("ui/src/components/NodeCanvas.tsx");
    const inspector = readSource("ui/src/components/NodeInspector.tsx");

    assert.match(store, /edgePopoverId: string \| null/);
    assert.match(store, /openEdgePopover:/);
    assert.match(store, /closeEdgePopover:/);
    assert.match(store, /updateEdgeTransferQuiet:/);
    assert.match(store, /setEdgeImageTransferQuiet:/);
    assert.match(edge, /edgePopoverId === id && !isMobile/);
    assert.match(edge, /if \(isMobile\) selectEdge\(id\);\s*else openEdgePopover\(id\);/);
    assert.match(edge, /updateEdgeTransferQuiet\(id, \{ transferContext/);
    assert.match(edge, /setEdgeImageTransferQuiet\(id, mode\)/);
    assert.match(edge, /maxAncestorImages/);
    assert.match(canvas, /if \(isMobile\) selectEdge\(edge\.id\);\s*else openEdgePopover\(edge\.id\);/);
    assert.match(inspector, /if \(isMobile && selectedEdge && edgeParent && edgeChild\)/);
  });

  it("keeps classic desktop result-first with compact composer and overlay rail", () => {
    const store = readSource("ui/src/store/useAppStore.ts");
    const app = readSource("ui/src/App.tsx");
    const sidebar = readSource("ui/src/components/Sidebar.tsx");
    const canvas = readSource("ui/src/components/Canvas.tsx");
    const dock = readSource("ui/src/components/ClassicFloatingComposer.tsx");
    const rightPanel = readSource("ui/src/components/RightPanel.tsx");
    const css = readSource("ui/src/index.css");

    assert.match(store, /classicComposerExpanded: boolean/);
    assert.match(store, /classicRailDrawer: "library" \| "activity" \| null/);
    assert.match(app, /app--classic-rail/);
    assert.match(app, /app--classic-composer-open/);
    assert.match(sidebar, /sidebar--classic-rail/);
    assert.match(sidebar, /classic-rail-drawer/);
    assert.match(sidebar, /setClassicRailDrawer/);
    assert.match(sidebar, /SidebarPromptLibrary[\s\S]*compactTabs/);
    assert.match(canvas, /ClassicFloatingComposer/);
    assert.match(dock, /classic-composer-dock--compact/);
    assert.match(dock, /classic-composer-dock--expanded/);
    assert.match(dock, /GenerateButton variant="compact"/);
    assert.match(dock, /PromptComposer variant="floating"/);
    assert.match(dock, /GenerateButton variant="dock"/);
    assert.match(rightPanel, /<ProviderSelect \/>/);
    assert.match(css, /\.classic-composer-dock/);
    assert.match(css, /\.classic-composer-dock--compact/);
    assert.match(css, /\.classic-rail-drawer/);
    assert.match(css, /\.composer--floating/);
    assert.match(css, /\.app--classic-rail/);
  });
});
