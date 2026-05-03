import type { GenerateItem } from "../types";
import { saveSelectedFilename } from "./storage";

export const HISTORY_LIMIT = 500;
export const HISTORY_INITIAL_PAGE_SIZE = 72;
export const HISTORY_PAGE_SIZE = 48;

export function narrowGenerateKind(k?: string | null): GenerateItem["kind"] {
  return k === "classic" || k === "edit" || k === "generate" || k === "import" ? k : null;
}

export function sameGenerateItem(
  a: GenerateItem | null | undefined,
  b: GenerateItem | null | undefined,
): boolean {
  if (!a || !b) return false;
  if (a.filename && b.filename) return a.filename === b.filename;
  return a.image === b.image;
}

export function historyItemKey(item: Pick<GenerateItem, "filename" | "url" | "image">): string {
  return item.filename || item.url || item.image;
}

export function normalizeGenerateItem(item: GenerateItem): GenerateItem {
  const image = item.image || item.url || "";
  const url = item.url ?? item.image;
  return {
    ...item,
    image,
    url,
    thumb: item.thumb ?? url ?? image,
    createdAt: item.createdAt || Date.now(),
    kind: narrowGenerateKind(item.kind),
  };
}

export function isNodeOwnedImport(item: Pick<GenerateItem, "kind">): boolean {
  return item.kind === "import";
}

function isHistoryTombstoned(item: GenerateItem, tombstones: string[]): boolean {
  return !!item.filename && tombstones.includes(item.filename);
}

function mergeGenerateItem(existing: GenerateItem, incoming: GenerateItem): GenerateItem {
  return {
    ...existing,
    ...incoming,
    image: incoming.image || existing.image,
    url: incoming.url ?? existing.url,
    thumb: incoming.thumb ?? existing.thumb,
    createdAt: incoming.createdAt ?? existing.createdAt,
    isFavorite: incoming.isFavorite ?? existing.isFavorite,
  };
}

function compareHistoryItems(a: GenerateItem, b: GenerateItem): number {
  const timeDelta = (b.createdAt ?? 0) - (a.createdAt ?? 0);
  if (timeDelta !== 0) return timeDelta;
  return (b.filename ?? historyItemKey(b)).localeCompare(a.filename ?? historyItemKey(a));
}

export function upsertHistoryItems(
  history: GenerateItem[],
  incoming: GenerateItem[],
  tombstones: string[],
  options: { includeNodeImports?: boolean; ignoreTombstones?: boolean } = {},
): GenerateItem[] {
  const next = history
    .map(normalizeGenerateItem)
    .filter((item) => options.includeNodeImports || !isNodeOwnedImport(item))
    .filter((item) => options.ignoreTombstones || !isHistoryTombstoned(item, tombstones));

  for (const raw of [...incoming].reverse()) {
    const item = normalizeGenerateItem(raw);
    if (!options.includeNodeImports && isNodeOwnedImport(item)) continue;
    if (!options.ignoreTombstones && isHistoryTombstoned(item, tombstones)) continue;
    const key = historyItemKey(item);
    if (!key) continue;
    const existingIndex = next.findIndex((candidate) => historyItemKey(candidate) === key);
    const merged =
      existingIndex >= 0 ? mergeGenerateItem(next[existingIndex], item) : item;
    if (existingIndex >= 0) next.splice(existingIndex, 1);
    next.unshift(merged);
  }

  return next.slice(0, HISTORY_LIMIT);
}

export function mergeHistoryPageItems(
  history: GenerateItem[],
  incoming: GenerateItem[],
  tombstones: string[],
  options: { includeNodeImports?: boolean; ignoreTombstones?: boolean } = {},
): GenerateItem[] {
  const byKey = new Map<string, GenerateItem>();
  for (const raw of [...history, ...incoming]) {
    const item = normalizeGenerateItem(raw);
    if (!options.includeNodeImports && isNodeOwnedImport(item)) continue;
    if (!options.ignoreTombstones && isHistoryTombstoned(item, tombstones)) continue;
    const key = historyItemKey(item);
    if (!key) continue;
    const existing = byKey.get(key);
    byKey.set(key, existing ? mergeGenerateItem(existing, item) : item);
  }
  return Array.from(byKey.values()).sort(compareHistoryItems).slice(0, HISTORY_LIMIT);
}

export function currentImageFromHistory(
  history: GenerateItem[],
  currentImage: GenerateItem | null,
): GenerateItem | null {
  if (!currentImage) return history[0] ?? null;
  const key = historyItemKey(currentImage);
  return history.find((item) => historyItemKey(item) === key) ?? history[0] ?? null;
}

export function currentHistoryIndex(
  history: GenerateItem[],
  currentImage: GenerateItem | null,
): number {
  if (!currentImage) return -1;
  return history.findIndex((item) => sameGenerateItem(item, currentImage));
}

export function selectHistoryItem(
  item: GenerateItem,
  set: (patch: { currentImage: GenerateItem }) => void,
): void {
  saveSelectedFilename(item.filename ?? null);
  set({ currentImage: item });
}
