import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeDb } from "../lib/db.js";
import {
  createPrompt,
  deletePrompt,
  importPromptLibrary,
  listPromptLibrary,
  togglePromptFavorite,
  updatePrompt,
} from "../lib/promptLibraryStore.js";

let tempDir;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ima2-prompt-library-"));
  process.env.IMA2_DB_PATH = join(tempDir, "sessions.db");
});

afterEach(() => {
  closeDb();
  delete process.env.IMA2_DB_PATH;
  rmSync(tempDir, { recursive: true, force: true });
});

describe("prompt library store", () => {
  it("creates, filters, favorites, updates, and soft-deletes prompts", () => {
    const prompt = createPrompt({
      name: "Studio portrait",
      text: "A crisp studio portrait with rim light",
      tags: ["portrait", "studio"],
      mode: "direct",
    });

    assert.equal(prompt.name, "Studio portrait");
    assert.deepEqual(prompt.tags, ["portrait", "studio"]);
    assert.equal(prompt.isFavorite, false);

    assert.equal(listPromptLibrary({ search: "rim" }).prompts.length, 1);
    assert.equal(listPromptLibrary({ favoritesOnly: true }).prompts.length, 0);

    const favorite = togglePromptFavorite(prompt.id);
    assert.deepEqual(favorite?.isFavorite, true);
    assert.equal(listPromptLibrary({ favoritesOnly: true }).prompts[0].id, prompt.id);

    const updated = updatePrompt(prompt.id, {
      name: "Updated portrait",
      tags: ["updated"],
    });
    assert.equal(updated?.name, "Updated portrait");
    assert.deepEqual(updated?.tags, ["updated"]);

    assert.equal(deletePrompt(prompt.id), true);
    assert.equal(listPromptLibrary().prompts.length, 0);
  });

  it("imports prompts and skips duplicates by text and folder", () => {
    const first = importPromptLibrary({
      prompts: [
        { name: "One", text: "same text", tags: ["a"] },
        { name: "Two", text: "same text", tags: ["b"] },
      ],
    });

    assert.equal(first.promptsImported, 1);
    assert.equal(first.duplicatesSkipped, 1);
    assert.equal(listPromptLibrary().prompts.length, 1);

    const second = importPromptLibrary({
      prompts: [{ name: "Three", text: "new text", isFavorite: true }],
    });

    assert.equal(second.promptsImported, 1);
    assert.equal(listPromptLibrary({ favoritesOnly: true }).prompts.length, 1);
  });
});
