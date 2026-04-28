import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function readSource(path) {
  return readFileSync(join(root, path), "utf8");
}

function readCssBundle() {
  return [
    "ui/src/index.css",
    "ui/src/styles/base-layout.css",
    "ui/src/styles/classic-canvas.css",
    "ui/src/styles/gallery-history.css",
    "ui/src/styles/prompt-library.css",
    "ui/src/styles/overlays.css",
    "ui/src/styles/mobile.css",
    "ui/src/styles/node.css",
  ].map(readSource).join("\n");
}

describe("prompt library UI contract", () => {
  it("keeps prompt library modules standalone for later integration", () => {
    const panel = readSource("ui/src/components/PromptLibraryPanel.tsx");
    const sidebar = readSource("ui/src/components/SidebarPromptLibrary.tsx");
    const app = readSource("ui/src/App.tsx");
    const css = readCssBundle();
    const client = readSource("ui/src/lib/promptLibrary.ts");

    assert.match(panel, /export type PromptLibraryPanelProps/);
    assert.match(panel, /onCreate\?:/);
    assert.match(panel, /onUpdate\?:/);
    assert.match(panel, /onDelete\?:/);
    assert.match(panel, /onToggleFavorite\?:/);
    assert.match(panel, /onImport\?:/);
    assert.match(panel, /onUse\?:/);
    assert.match(panel, /onInsert\?:/);
    assert.match(panel, /targetLabel\?:/);
    assert.match(panel, /targetAvailable\?:/);
    assert.match(panel, /replacePrompt/);
    assert.match(panel, /appendPrompt/);
    assert.match(panel, /prompt-library-panel__dialog/);
    assert.doesNotMatch(panel, /prompt-library-panel__drawer/);
    assert.doesNotMatch(panel, /useAppStore/);
    assert.doesNotMatch(panel, /useI18n/);

    assert.match(sidebar, /sidebar-workspace__tabs/);
    assert.match(sidebar, /mini-library/);
    assert.match(sidebar, /insertPromptLibraryItem/);
    assert.match(sidebar, /InFlightList/);
    assert.match(app, /targetLabel=\{promptTargetLabel\}/);
    assert.match(app, /targetAvailable=\{promptTargetAvailable\}/);
    assert.match(css, /\.prompt-library-panel__dialog/);
    assert.match(css, /@media \(max-width: 800px\)[\s\S]*\.prompt-library-panel__dialog/);
    assert.doesNotMatch(css, /\.prompt-library-panel__drawer/);

    assert.match(client, /export function getPromptLibrary/);
    assert.match(client, /export function createPrompt/);
    assert.match(client, /export function updatePrompt/);
    assert.match(client, /export function deletePrompt/);
    assert.match(client, /export function togglePromptFavorite/);
    assert.match(client, /export function importPromptLibrary/);
  });
});
