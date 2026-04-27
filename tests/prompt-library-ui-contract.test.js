import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function readSource(path) {
  return readFileSync(join(root, path), "utf8");
}

describe("prompt library UI contract", () => {
  it("keeps prompt library modules standalone for later integration", () => {
    const panel = readSource("ui/src/components/PromptLibraryPanel.tsx");
    const client = readSource("ui/src/lib/promptLibrary.ts");

    assert.match(panel, /export type PromptLibraryPanelProps/);
    assert.match(panel, /onCreate\?:/);
    assert.match(panel, /onUpdate\?:/);
    assert.match(panel, /onDelete\?:/);
    assert.match(panel, /onToggleFavorite\?:/);
    assert.match(panel, /onImport\?:/);
    assert.match(panel, /onUse\?:/);
    assert.match(panel, /onInsert\?:/);
    assert.doesNotMatch(panel, /useAppStore/);
    assert.doesNotMatch(panel, /useI18n/);

    assert.match(client, /export function getPromptLibrary/);
    assert.match(client, /export function createPrompt/);
    assert.match(client, /export function updatePrompt/);
    assert.match(client, /export function deletePrompt/);
    assert.match(client, /export function togglePromptFavorite/);
    assert.match(client, /export function importPromptLibrary/);
  });
});
