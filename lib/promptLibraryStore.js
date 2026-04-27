import { ulid } from "ulid";
import { getDb } from "./db.js";

const ROOT_FOLDER_ID = "__root__";
const TRASH_FOLDER_ID = "__trash__";

function now() {
  return Date.now();
}

function promptId() {
  return `p_${ulid()}`;
}

function folderId() {
  return `pf_${ulid()}`;
}

function cleanString(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function cleanTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags
    .map((tag) => cleanString(tag))
    .filter(Boolean)
    .slice(0, 32);
}

function encodeTags(tags) {
  return JSON.stringify(cleanTags(tags));
}

function decodeTags(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return cleanTags(parsed);
  } catch {
    return [];
  }
}

function normalizePrompt(row) {
  if (!row) return null;
  return {
    id: row.id,
    folderId: row.folder_id,
    name: row.name,
    text: row.text,
    tags: decodeTags(row.tags),
    mode: row.mode || null,
    isFavorite: !!row.is_favorite,
    favoritedAt: row.favorited_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeFolder(row) {
  if (!row) return null;
  return {
    id: row.id,
    parentId: row.parent_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function ensurePromptLibrarySchema(db = getDb()) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS prompt_folders (
      id          TEXT PRIMARY KEY,
      parent_id   TEXT NOT NULL,
      name        TEXT NOT NULL COLLATE NOCASE,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      UNIQUE(parent_id, name)
    );

    CREATE TABLE IF NOT EXISTS prompts (
      id            TEXT PRIMARY KEY,
      folder_id     TEXT NOT NULL DEFAULT '${ROOT_FOLDER_ID}',
      name          TEXT NOT NULL,
      text          TEXT NOT NULL,
      tags          TEXT,
      mode          TEXT,
      is_favorite   INTEGER NOT NULL DEFAULT 0,
      favorited_at  INTEGER,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_prompts_folder ON prompts(folder_id);
    CREATE INDEX IF NOT EXISTS idx_prompts_updated ON prompts(updated_at);
    CREATE INDEX IF NOT EXISTS idx_prompts_favorite ON prompts(is_favorite, favorited_at);
  `);

  const t = now();
  db.prepare(
    "INSERT OR IGNORE INTO prompt_folders (id, parent_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).run(ROOT_FOLDER_ID, ROOT_FOLDER_ID, ROOT_FOLDER_ID, t, t);
  db.prepare(
    "INSERT OR IGNORE INTO prompt_folders (id, parent_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).run(TRASH_FOLDER_ID, ROOT_FOLDER_ID, TRASH_FOLDER_ID, t, t);
}

export function listPromptLibrary({
  search = "",
  folderId = null,
  favoritesOnly = false,
} = {}) {
  const db = getDb();
  ensurePromptLibrarySchema(db);

  const where = [];
  const params = [];
  if (folderId) {
    where.push("p.folder_id = ?");
    params.push(folderId);
  } else {
    where.push("p.folder_id != ?");
    params.push(TRASH_FOLDER_ID);
  }
  if (favoritesOnly) {
    where.push("p.is_favorite = 1");
  }
  const term = cleanString(search);
  if (term) {
    where.push("(p.name LIKE ? OR p.text LIKE ? OR p.tags LIKE ?)");
    const like = `%${term}%`;
    params.push(like, like, like);
  }

  const prompts = db
    .prepare(
      `SELECT p.*
       FROM prompts p
       WHERE ${where.join(" AND ")}
       ORDER BY p.is_favorite DESC, p.updated_at DESC`,
    )
    .all(...params)
    .map(normalizePrompt);

  const folders = db
    .prepare(
      "SELECT * FROM prompt_folders WHERE id NOT IN (?, ?) ORDER BY name COLLATE NOCASE",
    )
    .all(ROOT_FOLDER_ID, TRASH_FOLDER_ID)
    .map(normalizeFolder);

  return { prompts, folders };
}

export function createPrompt({ name, text, tags = [], folderId, mode = null }) {
  const cleanText = cleanString(text);
  if (!cleanText) {
    const err = new Error("text is required");
    err.status = 400;
    throw err;
  }

  const db = getDb();
  ensurePromptLibrarySchema(db);
  const id = promptId();
  const t = now();
  const promptName = cleanString(name) || cleanText.slice(0, 40);
  const targetFolder = cleanString(folderId) || ROOT_FOLDER_ID;

  db.prepare(
    `INSERT INTO prompts
      (id, folder_id, name, text, tags, mode, is_favorite, favorited_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)`,
  ).run(
    id,
    targetFolder,
    promptName,
    cleanText,
    encodeTags(tags),
    mode || null,
    t,
    t,
  );

  return normalizePrompt(db.prepare("SELECT * FROM prompts WHERE id = ?").get(id));
}

export function getPrompt(id) {
  const db = getDb();
  ensurePromptLibrarySchema(db);
  return normalizePrompt(db.prepare("SELECT * FROM prompts WHERE id = ?").get(id));
}

export function updatePrompt(id, payload = {}) {
  const db = getDb();
  ensurePromptLibrarySchema(db);

  const sets = [];
  const params = [];
  if (typeof payload.name === "string") {
    sets.push("name = ?");
    params.push(payload.name.trim());
  }
  if (typeof payload.text === "string") {
    const cleanText = payload.text.trim();
    if (!cleanText) {
      const err = new Error("text is required");
      err.status = 400;
      throw err;
    }
    sets.push("text = ?");
    params.push(cleanText);
  }
  if (Array.isArray(payload.tags)) {
    sets.push("tags = ?");
    params.push(encodeTags(payload.tags));
  }
  if (typeof payload.folderId === "string") {
    sets.push("folder_id = ?");
    params.push(payload.folderId || ROOT_FOLDER_ID);
  }
  if ("mode" in payload) {
    sets.push("mode = ?");
    params.push(payload.mode || null);
  }
  if (sets.length === 0) {
    const err = new Error("No fields to update");
    err.status = 400;
    throw err;
  }

  sets.push("updated_at = ?");
  params.push(now(), id);
  const result = db
    .prepare(`UPDATE prompts SET ${sets.join(", ")} WHERE id = ?`)
    .run(...params);
  if (result.changes === 0) return null;
  return getPrompt(id);
}

export function deletePrompt(id) {
  const db = getDb();
  ensurePromptLibrarySchema(db);
  const result = db
    .prepare("UPDATE prompts SET folder_id = ?, updated_at = ? WHERE id = ?")
    .run(TRASH_FOLDER_ID, now(), id);
  return result.changes > 0;
}

export function togglePromptFavorite(id) {
  const db = getDb();
  ensurePromptLibrarySchema(db);
  const row = db
    .prepare("SELECT is_favorite FROM prompts WHERE id = ?")
    .get(id);
  if (!row) return null;

  const isFavorite = row.is_favorite ? 0 : 1;
  const favoritedAt = isFavorite ? now() : null;
  db.prepare(
    "UPDATE prompts SET is_favorite = ?, favorited_at = ?, updated_at = ? WHERE id = ?",
  ).run(isFavorite, favoritedAt, now(), id);

  return { isFavorite: !!isFavorite, favoritedAt };
}

export function createPromptFolder({ name, parentId = ROOT_FOLDER_ID }) {
  const cleanName = cleanString(name);
  if (!cleanName) {
    const err = new Error("name is required");
    err.status = 400;
    throw err;
  }

  const db = getDb();
  ensurePromptLibrarySchema(db);
  const id = folderId();
  const t = now();
  db.prepare(
    "INSERT INTO prompt_folders (id, parent_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, parentId || ROOT_FOLDER_ID, cleanName, t, t);
  return normalizeFolder(
    db.prepare("SELECT * FROM prompt_folders WHERE id = ?").get(id),
  );
}

export function importPromptLibrary({ folders = [], prompts = [] } = {}) {
  const db = getDb();
  ensurePromptLibrarySchema(db);
  const result = {
    foldersCreated: 0,
    promptsImported: 0,
    duplicatesSkipped: 0,
  };
  const t = now();

  const tx = db.transaction(() => {
    const knownFolders = new Set(
      db.prepare("SELECT id FROM prompt_folders").all().map((row) => row.id),
    );

    for (const folder of folders) {
      const name = cleanString(folder?.name);
      if (!name) continue;
      const id = cleanString(folder.id) || folderId();
      const parentId = cleanString(folder.parentId) || ROOT_FOLDER_ID;
      if (knownFolders.has(id)) continue;
      db.prepare(
        "INSERT INTO prompt_folders (id, parent_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).run(id, parentId, name, t, t);
      knownFolders.add(id);
      result.foldersCreated += 1;
    }

    for (const prompt of prompts) {
      const text = cleanString(prompt?.text);
      if (!text) continue;
      const targetFolder =
        cleanString(prompt.folderId) && knownFolders.has(prompt.folderId)
          ? prompt.folderId
          : ROOT_FOLDER_ID;
      const duplicate = db
        .prepare(
          "SELECT 1 FROM prompts WHERE text = ? AND folder_id = ? AND folder_id != ? LIMIT 1",
        )
        .get(text, targetFolder, TRASH_FOLDER_ID);
      if (duplicate) {
        result.duplicatesSkipped += 1;
        continue;
      }
      const id = cleanString(prompt.id) || promptId();
      const isFavorite = prompt.isFavorite ? 1 : 0;
      db.prepare(
        `INSERT INTO prompts
          (id, folder_id, name, text, tags, mode, is_favorite, favorited_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        targetFolder,
        cleanString(prompt.name) || text.slice(0, 40),
        text,
        encodeTags(prompt.tags),
        prompt.mode || null,
        isFavorite,
        isFavorite ? t : null,
        t,
        t,
      );
      result.promptsImported += 1;
    }
  });

  tx();
  return result;
}
