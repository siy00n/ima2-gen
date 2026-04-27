import { getDb } from "./db.js";

function now() {
  return Date.now();
}

export function ensureGalleryFavoritesSchema(db = getDb()) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS gallery_favorites (
      filename      TEXT PRIMARY KEY,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );
  `);
}

export function listGalleryFavoriteFilenames(db = getDb()) {
  ensureGalleryFavoritesSchema(db);
  return new Set(
    db.prepare("SELECT filename FROM gallery_favorites").all().map((row) => row.filename),
  );
}

export function isGalleryFavorite(filename, db = getDb()) {
  ensureGalleryFavoritesSchema(db);
  return !!db.prepare("SELECT 1 FROM gallery_favorites WHERE filename = ?").get(filename);
}

export function setGalleryFavorite(filename, favorite, db = getDb()) {
  ensureGalleryFavoritesSchema(db);
  const t = now();
  if (favorite) {
    db.prepare(
      `INSERT INTO gallery_favorites (filename, created_at, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(filename) DO UPDATE SET updated_at = excluded.updated_at`,
    ).run(filename, t, t);
    return { filename, isFavorite: true, updatedAt: t };
  }
  db.prepare("DELETE FROM gallery_favorites WHERE filename = ?").run(filename);
  return { filename, isFavorite: false, updatedAt: t };
}

export function toggleGalleryFavorite(filename, db = getDb()) {
  return setGalleryFavorite(filename, !isGalleryFavorite(filename, db), db);
}
