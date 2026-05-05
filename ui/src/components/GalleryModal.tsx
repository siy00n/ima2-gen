import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useAppStore } from "../store/useAppStore";
import type { GenerateItem } from "../types";
import {
  deleteHistoryItem,
  getHistory,
  restoreHistoryItem,
  getHistoryGrouped,
  toggleHistoryFavorite as toggleHistoryFavoriteApi,
  type HistoryCursor,
  type HistoryItem,
} from "../lib/api";
import { getGalleryItemKey, getGalleryItemReactKey } from "../lib/galleryNavigation";
import { useI18n } from "../i18n";
import { useMobileBackDismiss } from "../hooks/useMobileBackDismiss";
import { ImageLightbox } from "./ImageLightbox";
import {
  HISTORY_INITIAL_PAGE_SIZE,
  HISTORY_PAGE_SIZE,
  mergeHistoryPageItems,
  narrowGenerateKind,
} from "../store/historyHelpers";

type TrashPending = {
  filename: string;
  trashId: string;
  item: GenerateItem;
  expiresAt: number;
};

type SessionGroup = {
  sessionId: string;
  label: string;
  items: GenerateItem[];
};

type DateBucketKey = "earlier" | "today" | "yesterday" | "thisWeek" | string;
type FavoriteActions = {
  toggleGalleryFavorite?: (filename: string) => void | Promise<void>;
};

function dateBucket(createdAt: number | undefined): DateBucketKey {
  if (!createdAt) return "earlier";
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return "earlier";
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return "thisWeek";
  return d.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function imageSrcForItem(item: GenerateItem): string {
  return item.url ?? item.image;
}

function createdAtLabel(createdAt: number | undefined): string | null {
  if (!createdAt) return null;
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}

function previewMetaForItem(item: GenerateItem): string {
  return [
    item.filename,
    item.size,
    item.quality,
    item.model,
    item.provider,
    createdAtLabel(item.createdAt),
  ].filter((value): value is string => Boolean(value)).join(" · ");
}

function isVisibleGalleryItem(item: GenerateItem, tombstones: string[]): boolean {
  if (item.kind === "import") return false;
  if (item.filename && tombstones.includes(item.filename)) return false;
  return true;
}

function historyItemToGalleryItem(h: HistoryItem): GenerateItem {
  return {
    image: h.url,
    url: h.url,
    thumb: h.thumb ?? h.url,
    filename: h.filename,
    prompt: h.prompt ?? undefined,
    size: h.size ?? undefined,
    quality: h.quality ?? undefined,
    provider: h.provider,
    model: h.model ?? undefined,
    createdAt: h.createdAt,
    sessionId: h.sessionId ?? null,
    nodeId: h.nodeId ?? null,
    clientNodeId: h.clientNodeId ?? null,
    kind: narrowGenerateKind(h.kind),
    isFavorite: h.isFavorite ?? false,
  };
}

function mergeGalleryItems(
  existing: GenerateItem[],
  incoming: GenerateItem[],
  tombstones: string[],
): GenerateItem[] {
  return mergeHistoryPageItems(existing, incoming, tombstones);
}

function mergeSessionGroups(
  existing: SessionGroup[],
  incoming: SessionGroup[],
  tombstones: string[],
): SessionGroup[] {
  const bySession = new Map(existing.map((group) => [group.sessionId, {
    ...group,
    items: [...group.items],
  }]));
  for (const group of incoming) {
    const current = bySession.get(group.sessionId);
    if (!current) {
      bySession.set(group.sessionId, { ...group, items: [...group.items] });
      continue;
    }
    current.label = group.label || current.label;
    current.items = mergeGalleryItems(current.items, group.items, tombstones);
  }
  return Array.from(bySession.values());
}

function itemMatchesGalleryFilter(item: GenerateItem, query: string, favoritesOnly: boolean): boolean {
  if (favoritesOnly && !item.isFavorite) return false;
  const q = query.trim().toLowerCase().normalize("NFC");
  if (!q) return true;
  return (
    (item.prompt ?? "").toLowerCase().normalize("NFC").includes(q) ||
    (item.filename ?? "").toLowerCase().normalize("NFC").includes(q)
  );
}

function removeGalleryItemFromGroups(groups: SessionGroup[], filename: string): SessionGroup[] {
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => item.filename !== filename),
    }))
    .filter((group) => group.items.length > 0);
}

export function GalleryModal() {
  const { t } = useI18n();
  const open = useAppStore((s) => s.galleryOpen);
  const close = useAppStore((s) => s.closeGallery);
  const uiMode = useAppStore((s) => s.uiMode);
  const history = useAppStore((s) => s.history);
  const historyTotal = useAppStore((s) => s.historyTotal);
  const historyHasMore = useAppStore((s) => s.historyHasMore);
  const historyLoadingMore = useAppStore((s) => s.historyLoadingMore);
  const loadMoreHistory = useAppStore((s) => s.loadMoreHistory);
  const historyTombstones = useAppStore((s) => s.historyTombstones);
  const selectHistory = useAppStore((s) => s.selectHistory);
  const currentImage = useAppStore((s) => s.currentImage);
  const removeFromHistory = useAppStore((s) => s.removeFromHistory);
  const addHistoryItem = useAppStore((s) => s.addHistoryItem);
  const importHistoryItemAsNode = useAppStore((s) => s.importHistoryItemAsNode);
  const toggleGalleryFavorite = useAppStore((s) => (s as typeof s & FavoriteActions).toggleGalleryFavorite);

  const [query, setQuery] = useState("");
  const [groupBy, setGroupBy] = useState<"date" | "session">("date");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [sessionGroups, setSessionGroups] = useState<SessionGroup[]>([]);
  const [loose, setLoose] = useState<GenerateItem[]>([]);
  const [groupCursor, setGroupCursor] = useState<HistoryCursor | null>(null);
  const [groupTotal, setGroupTotal] = useState(0);
  const [groupLoadingMore, setGroupLoadingMore] = useState(false);
  const [searchItems, setSearchItems] = useState<GenerateItem[]>([]);
  const [searchCursor, setSearchCursor] = useState<HistoryCursor | null>(null);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchLoadingMore, setSearchLoadingMore] = useState(false);
  const [pending, setPending] = useState<TrashPending | null>(null);
  const [previewItem, setPreviewItem] = useState<GenerateItem | null>(null);
  const [brokenImageKeys, setBrokenImageKeys] = useState<Set<string>>(() => new Set());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Record<string, HTMLElement | null>>({});
  const lastScrollTopRef = useRef(0);
  const didInitialScrollRef = useRef(false);
  const lastOpenRef = useRef(false);
  const restoreScrollTopRef = useRef<number | null>(null);

  const dismissGallery = useMobileBackDismiss(open, close);
  const showSessions = groupBy === "session";
  const dateSearchQuery = query.trim();
  const dateSearchActive = !showSessions && (dateSearchQuery.length > 0 || favoritesOnly);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (previewItem) return;
      if (e.key === "Escape") dismissGallery();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, dismissGallery, previewItem]);

  useEffect(() => {
    if (open && !lastOpenRef.current) {
      didInitialScrollRef.current = false;
      restoreScrollTopRef.current = null;
    }
    lastOpenRef.current = open;
    if (!open) {
      setQuery("");
      setPending(null);
      setPreviewItem(null);
      setBrokenImageKeys(new Set());
    }
  }, [open]);

  useEffect(() => {
    if (!open || groupBy !== "session") return;
    let cancelled = false;
    (async () => {
      try {
        setGroupLoadingMore(true);
        setSessionGroups([]);
        setLoose([]);
        setGroupCursor(null);
        setGroupTotal(0);
        const page = await getHistoryGrouped({
          limit: HISTORY_INITIAL_PAGE_SIZE,
          q: dateSearchQuery || undefined,
          favoritesOnly,
        });
        if (cancelled) return;
        setSessionGroups(
          page.sessions.map((s) => ({
            sessionId: s.sessionId,
            label: s.sessionId.slice(0, 8),
            items: s.items.map(historyItemToGalleryItem).filter((item) => isVisibleGalleryItem(item, historyTombstones)),
          })).filter((group) => group.items.length > 0),
        );
        setLoose(page.loose.map(historyItemToGalleryItem).filter((item) => isVisibleGalleryItem(item, historyTombstones)));
        setGroupCursor(page.nextCursor);
        setGroupTotal(page.total);
      } catch (err) {
        if (!cancelled) console.warn("[gallery] session load failed", err);
      } finally {
        if (!cancelled) setGroupLoadingMore(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dateSearchQuery, favoritesOnly, open, groupBy, historyTombstones]);

  useEffect(() => {
    if (!open || groupBy !== "date") return;
    setGroupCursor(null);
    setGroupTotal(0);
    setGroupLoadingMore(false);
  }, [groupBy, open]);

  useEffect(() => {
    if (!open || !dateSearchActive) {
      setSearchItems([]);
      setSearchCursor(null);
      setSearchTotal(0);
      setSearchLoading(false);
      setSearchLoadingMore(false);
      return;
    }
    let cancelled = false;
    restoreScrollTopRef.current = 0;
    lastScrollTopRef.current = 0;
    (async () => {
      try {
        setSearchLoading(true);
        setSearchItems([]);
        setSearchCursor(null);
        setSearchTotal(0);
        const page = await getHistory({
          limit: HISTORY_INITIAL_PAGE_SIZE,
          q: dateSearchQuery || undefined,
          favoritesOnly,
        });
        if (cancelled) return;
        const items = page.items
          .map(historyItemToGalleryItem)
          .filter((item) => isVisibleGalleryItem(item, historyTombstones));
        setSearchItems(items);
        setSearchCursor(page.nextCursor);
        setSearchTotal(page.total);
      } catch (err) {
        if (!cancelled) console.warn("[gallery] search failed", err);
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dateSearchActive, dateSearchQuery, favoritesOnly, historyTombstones, open]);

  const filtered = useMemo(() => {
    const source = dateSearchActive ? searchItems : history;
    return source.filter((h) => {
      if (!isVisibleGalleryItem(h, historyTombstones)) return false;
      return !dateSearchActive || itemMatchesGalleryFilter(h, dateSearchQuery, favoritesOnly);
    });
  }, [dateSearchActive, dateSearchQuery, favoritesOnly, history, historyTombstones, searchItems]);

  const visibleSessionGroups = useMemo(() => {
    return sessionGroups
      .map((group) => ({
        ...group,
        items: group.items
          .filter((item) => isVisibleGalleryItem(item, historyTombstones))
          .filter((item) => !favoritesOnly || item.isFavorite),
      }))
      .filter((group) => group.items.length > 0);
  }, [sessionGroups, historyTombstones, favoritesOnly]);

  const visibleLoose = useMemo(() => {
    return loose
      .filter((item) => isVisibleGalleryItem(item, historyTombstones))
      .filter((item) => !favoritesOnly || item.isFavorite);
  }, [loose, historyTombstones, favoritesOnly]);

  const dateGroups = useMemo(() => {
    const map = new Map<string, GenerateItem[]>();
    for (const item of filtered) {
      const key = dateBucket(item.createdAt);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const totalVisible = showSessions
    ? groupTotal
    : dateSearchActive
      ? searchTotal
      : filtered.length;
  const hasMoreItems = showSessions ? !!groupCursor : dateSearchActive ? !!searchCursor : historyHasMore;
  const loadingMore = showSessions ? groupLoadingMore : dateSearchActive ? searchLoadingMore : historyLoadingMore;
  const shownItemCount = showSessions
    ? sessionGroups.reduce((a, g) => a + g.items.length, 0) + loose.length
    : dateSearchActive
      ? searchItems.length
      : history.length;
  const totalItemCount = showSessions ? groupTotal : dateSearchActive ? searchTotal : historyTotal;

  useLayoutEffect(() => {
    if (!open) return;
    if (restoreScrollTopRef.current != null) {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = restoreScrollTopRef.current;
        lastScrollTopRef.current = restoreScrollTopRef.current;
      }
      restoreScrollTopRef.current = null;
      return;
    }
    if (!didInitialScrollRef.current) {
      didInitialScrollRef.current = true;
      const selectedKey = currentImage ? getGalleryItemKey(currentImage) : null;
      const selectedEl = selectedKey ? itemRefs.current[selectedKey] : null;
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: "center" });
        lastScrollTopRef.current = scrollRef.current?.scrollTop ?? lastScrollTopRef.current;
        return;
      }
      if (scrollRef.current) scrollRef.current.scrollTop = lastScrollTopRef.current;
    }
  }, [
    open,
    currentImage,
    groupBy,
    totalVisible,
    dateGroups.length,
    visibleSessionGroups.length,
    visibleLoose.length,
  ]);

  async function loadMoreGalleryItems() {
    if (loadingMore) return;
    restoreScrollTopRef.current = scrollRef.current?.scrollTop ?? lastScrollTopRef.current;
    if (showSessions) {
      if (!groupCursor) return;
      setGroupLoadingMore(true);
      try {
        const page = await getHistoryGrouped({
          limit: HISTORY_PAGE_SIZE,
          cursor: groupCursor,
          q: dateSearchQuery || undefined,
          favoritesOnly,
        });
        const nextGroups = page.sessions.map((s) => ({
          sessionId: s.sessionId,
          label: s.sessionId.slice(0, 8),
          items: s.items
            .map(historyItemToGalleryItem)
            .filter((item) => isVisibleGalleryItem(item, historyTombstones)),
        })).filter((group) => group.items.length > 0);
        const nextLoose = page.loose
          .map(historyItemToGalleryItem)
          .filter((item) => isVisibleGalleryItem(item, historyTombstones));
        setSessionGroups((groups) => mergeSessionGroups(groups, nextGroups, historyTombstones));
        setLoose((items) => mergeGalleryItems(items, nextLoose, historyTombstones));
        setGroupCursor(page.nextCursor);
        setGroupTotal(page.total);
      } finally {
        setGroupLoadingMore(false);
      }
      return;
    }
    if (dateSearchActive) {
      if (!searchCursor) return;
      setSearchLoadingMore(true);
      try {
        const page = await getHistory({
          limit: HISTORY_PAGE_SIZE,
          cursor: searchCursor,
          q: dateSearchQuery || undefined,
          favoritesOnly,
        });
        const nextItems = page.items
          .map(historyItemToGalleryItem)
          .filter((item) => isVisibleGalleryItem(item, historyTombstones));
        setSearchItems((items) => mergeGalleryItems(items, nextItems, historyTombstones));
        setSearchCursor(page.nextCursor);
        setSearchTotal(page.total);
      } finally {
        setSearchLoadingMore(false);
      }
      return;
    }
    await loadMoreHistory();
  }

  useEffect(() => {
    if (!pending) return;
    const id = setInterval(() => {
      setPending((cur) => {
        if (!cur) return null;
        if (Date.now() >= cur.expiresAt) return null;
        return { ...cur };
      });
    }, 500);
    return () => clearInterval(id);
  }, [pending]);

  async function handleDelete(item: GenerateItem, e: MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    if (!item.filename) return;
    try {
      const r = await deleteHistoryItem(item.filename);
      removeFromHistory(item.filename);
      setSearchItems((items) => items.filter((candidate) => candidate.filename !== item.filename));
      setSearchTotal((total) => Math.max(0, total - 1));
      setSessionGroups((groups) => removeGalleryItemFromGroups(groups, item.filename!));
      setLoose((items) => items.filter((candidate) => candidate.filename !== item.filename));
      setGroupTotal((total) => Math.max(0, total - 1));
      setPending({
        filename: item.filename,
        trashId: r.trashId,
        item,
        expiresAt: Date.now() + 9500,
      });
    } catch (err) {
      console.error("[gallery] delete failed", err);
    }
  }

  async function handleImportToNode(item: GenerateItem, e: MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    await importHistoryItemAsNode(item);
    setPreviewItem(null);
    close();
  }

  function handleToggleFavorite(item: GenerateItem, e: MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    if (!item.filename) return;
    if (historyTombstones.includes(item.filename)) return;
    const storeItem = history.find((candidate) => candidate.filename === item.filename);
    const nextFavorite = !(storeItem?.isFavorite ?? item.isFavorite ?? false);
    const updateItem = (candidate: GenerateItem): GenerateItem =>
      candidate.filename === item.filename ? { ...candidate, isFavorite: nextFavorite } : candidate;
    setSessionGroups((groups) =>
      groups
        .map((group) => ({
          ...group,
          items: group.items
            .map(updateItem)
            .filter((candidate) => !favoritesOnly || candidate.isFavorite),
        }))
        .filter((group) => group.items.length > 0),
    );
    setLoose((items) =>
      items
        .map(updateItem)
        .filter((candidate) => !favoritesOnly || candidate.isFavorite),
    );
    setSearchItems((items) => {
      const next = items.map(updateItem);
      return favoritesOnly && !nextFavorite
        ? next.filter((candidate) => candidate.filename !== item.filename)
        : next;
    });
    if (favoritesOnly && !nextFavorite) {
      setSearchTotal((total) => Math.max(0, total - 1));
      setGroupTotal((total) => Math.max(0, total - 1));
    }
    setPreviewItem((preview) => preview && preview.filename === item.filename ? { ...preview, isFavorite: nextFavorite } : preview);
    if (storeItem && toggleGalleryFavorite) {
      void toggleGalleryFavorite(item.filename);
    } else {
      void toggleHistoryFavoriteApi(item.filename, nextFavorite).catch((err) => {
        console.error("[gallery] favorite failed", err);
      });
    }
  }

  function handleTileClick(item: GenerateItem) {
    selectHistory(item);
    if (uiMode === "node") {
      setPreviewItem(item);
      return;
    }
    close();
  }

  async function handleUndo() {
    if (!pending) return;
    try {
      await restoreHistoryItem(pending.filename, pending.trashId);
      addHistoryItem(pending.item);
      if (dateSearchActive && itemMatchesGalleryFilter(pending.item, dateSearchQuery, favoritesOnly)) {
        setSearchItems((items) => mergeGalleryItems(items, [pending.item], historyTombstones));
        setSearchTotal((total) => total + 1);
      }
      if (showSessions && itemMatchesGalleryFilter(pending.item, dateSearchQuery, favoritesOnly)) {
        if (pending.item.sessionId) {
          setSessionGroups((groups) =>
            mergeSessionGroups(
              groups,
              [{
                sessionId: pending.item.sessionId!,
                label: pending.item.sessionId!.slice(0, 8),
                items: [pending.item],
              }],
              historyTombstones,
            ),
          );
        } else {
          setLoose((items) => mergeGalleryItems(items, [pending.item], historyTombstones));
        }
        setGroupTotal((total) => total + 1);
      }
    } catch (err) {
      console.error("[gallery] restore failed", err);
    } finally {
      setPending(null);
    }
  }

  if (!open) return null;

  const localizeBucket = (key: string): string => {
    if (key === "earlier" || key === "today" || key === "yesterday" || key === "thisWeek") {
      return t(`gallery.${key}`);
    }
    return key;
  };

  const renderTile = (item: GenerateItem, keyPrefix: string) => {
    const active = currentImage?.image === item.image;
    const opensPreview = uiMode === "node";
    const itemKey = getGalleryItemKey(item);
    const imageFailed = brokenImageKeys.has(itemKey);
    const setItemRef = (node: HTMLDivElement | null) => {
      itemRefs.current[itemKey] = node;
    };
    return (
      <div
        key={getGalleryItemReactKey(item, keyPrefix)}
        ref={setItemRef}
        className={`gallery__tile-wrap${active ? " gallery__tile-wrap--active" : ""}${item.isFavorite ? " gallery__tile-wrap--favorite" : ""}`}
      >
        <button
          type="button"
          className={`gallery__tile${active ? " gallery__tile--active" : ""}`}
          onClick={() => handleTileClick(item)}
          title={opensPreview ? t("gallery.openPreviewTitle") : item.prompt ?? ""}
          aria-label={opensPreview ? t("gallery.openPreviewAria") : undefined}
        >
          {imageFailed ? (
            <span className="gallery__image-placeholder">{t("gallery.imageAltFallback")}</span>
          ) : (
            <img
              src={item.thumb || item.image}
              alt={item.prompt ?? t("gallery.imageAltFallback")}
              loading="lazy"
              decoding="async"
              onError={() => {
                setBrokenImageKeys((prev) => {
                  if (prev.has(itemKey)) return prev;
                  const next = new Set(prev);
                  next.add(itemKey);
                  return next;
                });
              }}
            />
          )}
          {item.prompt && (
            <div className="gallery__caption">
              <span className="gallery__caption-text">{item.prompt}</span>
            </div>
          )}
        </button>
        {item.filename && (
          <>
            <button
              type="button"
              className={`gallery__favorite${item.isFavorite ? " gallery__favorite--on" : ""}`}
              onClick={(e) => handleToggleFavorite(item, e)}
              title={item.isFavorite ? t("gallery.unfavoriteTitle") : t("gallery.favoriteTitle")}
              aria-label={item.isFavorite ? t("gallery.unfavoriteAria") : t("gallery.favoriteAria")}
              aria-pressed={item.isFavorite}
            >
              ★
            </button>
            <button
              type="button"
              className="gallery__import-node"
              onClick={(e) => void handleImportToNode(item, e)}
              title={t("gallery.importToNodeTitle")}
              aria-label={t("gallery.importToNodeAria")}
            >
              ↗
            </button>
            <button
              type="button"
              className="gallery__delete"
              onClick={(e) => handleDelete(item, e)}
              title={t("gallery.deleteTitle")}
              aria-label={t("gallery.deleteAria")}
            >
              ×
            </button>
          </>
        )}
      </div>
    );
  };

  const previewTitle =
    previewItem?.prompt?.trim() ||
    previewItem?.filename ||
    t("gallery.imageAltFallback");
  const previewMeta = previewItem ? previewMetaForItem(previewItem) : "";

  return (
    <>
      <div className="gallery-backdrop" onClick={dismissGallery} role="presentation">
        <div
          className="gallery"
          role="dialog"
          aria-modal="true"
          aria-label={t("gallery.ariaLabel")}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="gallery__header">
            <div className="gallery__title-row">
              <h2 className="gallery__title">{t("gallery.title")}</h2>
              <div className="gallery__meta">
                {t("gallery.total", { n: totalVisible })}
              </div>
            </div>
            <input
              type="search"
              className="gallery__search"
              placeholder={t("gallery.searchPlaceholder")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="gallery__filter-row">
              <div className="gallery__favorite-filter" role="tablist" aria-label={t("gallery.favoriteFilterAria")}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={!favoritesOnly}
                  className={!favoritesOnly ? "active" : ""}
                  onClick={() => setFavoritesOnly(false)}
                >
                  {t("gallery.filterAll")}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={favoritesOnly}
                  className={favoritesOnly ? "active" : ""}
                  onClick={() => setFavoritesOnly(true)}
                >
                  {t("gallery.filterFavorites")}
                </button>
              </div>
              <div className="gallery__group-toggle" role="tablist" aria-label={t("gallery.sortByAria")}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={groupBy === "date"}
                  className={groupBy === "date" ? "active" : ""}
                  onClick={() => setGroupBy("date")}
                >
                  {t("gallery.sortByDate")}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={groupBy === "session"}
                  className={groupBy === "session" ? "active" : ""}
                  onClick={() => setGroupBy("session")}
                >
                  {t("gallery.sortBySession")}
                </button>
              </div>
            </div>
          </div>

          <div
            className="gallery__scroll"
            ref={scrollRef}
            onScroll={() => {
              lastScrollTopRef.current = scrollRef.current?.scrollTop ?? 0;
            }}
          >
            {(searchLoading && !showSessions) ||
            (showSessions && groupLoadingMore && sessionGroups.length === 0 && loose.length === 0) ? (
              <div className="gallery__empty">{t("gallery.loadingMore")}</div>
            ) : showSessions ? (
              <>
                {visibleSessionGroups.map((g) => (
                  <section key={g.sessionId} className="gallery__group">
                    <header className="gallery__group-header gallery__group-header--session">
                      <span className="gallery__group-heading">
                        <span className="gallery__group-marker" aria-hidden="true" />
                        <span className="gallery__group-label">{t("gallery.sessionLabel", { name: g.label })}</span>
                      </span>
                      <span className="gallery__group-count">{t("gallery.groupCount", { count: g.items.length })}</span>
                    </header>
                    <div className="gallery__grid">
                      {g.items.map((item) => renderTile(item, g.sessionId))}
                    </div>
                  </section>
                ))}
                {visibleLoose.length > 0 && (
                  <section className="gallery__group">
                    <header className="gallery__group-header gallery__group-header--session">
                      <span className="gallery__group-heading">
                        <span className="gallery__group-marker" aria-hidden="true" />
                        <span className="gallery__group-label">{t("gallery.standalone")}</span>
                      </span>
                      <span className="gallery__group-count">{t("gallery.groupCount", { count: visibleLoose.length })}</span>
                    </header>
                    <div className="gallery__grid">
                      {visibleLoose.map((item) => renderTile(item, "loose"))}
                    </div>
                  </section>
                )}
                {visibleSessionGroups.length === 0 && visibleLoose.length === 0 && (
                  <div className="gallery__empty">
                    {favoritesOnly
                      ? t("gallery.emptyFavorites")
                      : query.trim()
                        ? t("gallery.noResults")
                        : t("gallery.emptySessions")}
                  </div>
                )}
              </>
            ) : filtered.length === 0 ? (
              <div className="gallery__empty">
                {!dateSearchActive && history.length === 0
                  ? t("gallery.emptyAll")
                  : favoritesOnly
                    ? t("gallery.emptyFavorites")
                  : t("gallery.noResults")}
              </div>
            ) : (
              dateGroups.map(([label, items]) => (
                <section key={label} className="gallery__group">
                  <header className="gallery__group-header">
                    <span className="gallery__group-heading">
                      <span className="gallery__group-label">{localizeBucket(label)}</span>
                    </span>
                    <span className="gallery__group-count">{t("gallery.groupCount", { count: items.length })}</span>
                  </header>
                  <div className="gallery__grid">
                    {items.map((item) => renderTile(item, label))}
                  </div>
                </section>
              ))
            )}
            {hasMoreItems && (
              <div className="gallery__load-more">
                <button
                  type="button"
                  onClick={() => void loadMoreGalleryItems()}
                  disabled={loadingMore}
                >
                  {loadingMore
                    ? t("gallery.loadingMore")
                    : t("gallery.loadMore", { shown: shownItemCount, total: totalItemCount })}
                </button>
              </div>
            )}
          </div>

          {pending && (
            <div className="gallery__undo">
              <span>{t("gallery.deleted", { filename: pending.filename })}</span>
              <button type="button" onClick={handleUndo}>
                {t("gallery.undo")}
              </button>
              <span className="gallery__undo-timer">
                {t("gallery.secondsSuffix", { n: Math.max(0, Math.ceil((pending.expiresAt - Date.now()) / 1000)) })}
              </span>
            </div>
          )}
        </div>
      </div>
      <ImageLightbox
        open={!!previewItem}
        imageSrc={previewItem ? imageSrcForItem(previewItem) : null}
        title={previewTitle}
        meta={previewMeta}
        onClose={() => setPreviewItem(null)}
      />
    </>
  );
}
