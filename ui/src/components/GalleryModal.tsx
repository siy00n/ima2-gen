import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useAppStore } from "../store/useAppStore";
import type { GenerateItem } from "../types";
import { deleteHistoryItem, restoreHistoryItem, getHistoryGrouped } from "../lib/api";
import { getGalleryItemKey, getGalleryItemReactKey } from "../lib/galleryNavigation";
import { useI18n } from "../i18n";
import { useMobileBackDismiss } from "../hooks/useMobileBackDismiss";
import { ImageLightbox } from "./ImageLightbox";

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

const GALLERY_INITIAL_LIMIT = 72;
const GALLERY_LOAD_MORE_STEP = 48;

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

function limitDateGroups(
  groups: Array<[string, GenerateItem[]]>,
  limit: number,
): Array<[string, GenerateItem[], number]> {
  let remaining = limit;
  const limited: Array<[string, GenerateItem[], number]> = [];
  for (const [label, items] of groups) {
    if (remaining <= 0) break;
    const shown = items.slice(0, remaining);
    if (shown.length > 0) limited.push([label, shown, items.length]);
    remaining -= shown.length;
  }
  return limited;
}

function limitSessionGroups(
  groups: SessionGroup[],
  looseItems: GenerateItem[],
  limit: number,
): { groups: Array<SessionGroup & { total: number }>; loose: GenerateItem[]; looseTotal: number } {
  let remaining = limit;
  const limitedGroups: Array<SessionGroup & { total: number }> = [];
  for (const group of groups) {
    if (remaining <= 0) break;
    const shown = group.items.slice(0, remaining);
    if (shown.length > 0) limitedGroups.push({ ...group, items: shown, total: group.items.length });
    remaining -= shown.length;
  }
  const loose = remaining > 0 ? looseItems.slice(0, remaining) : [];
  return { groups: limitedGroups, loose, looseTotal: looseItems.length };
}

export function GalleryModal() {
  const { t } = useI18n();
  const open = useAppStore((s) => s.galleryOpen);
  const close = useAppStore((s) => s.closeGallery);
  const uiMode = useAppStore((s) => s.uiMode);
  const history = useAppStore((s) => s.history);
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
  const [pending, setPending] = useState<TrashPending | null>(null);
  const [previewItem, setPreviewItem] = useState<GenerateItem | null>(null);
  const [visibleLimit, setVisibleLimit] = useState(GALLERY_INITIAL_LIMIT);
  const [brokenImageKeys, setBrokenImageKeys] = useState<Set<string>>(() => new Set());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Record<string, HTMLElement | null>>({});
  const lastScrollTopRef = useRef(0);

  const dismissGallery = useMobileBackDismiss(open, close);

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
        const page = await getHistoryGrouped({ limit: 500 });
        if (cancelled) return;
        const toItem = (h: (typeof page.loose)[number]): GenerateItem => {
          const k = h.kind;
          const narrowedKind: GenerateItem["kind"] =
            k === "classic" || k === "edit" || k === "generate" || k === "import" ? k : null;
          return {
            image: h.url,
            url: h.url,
            thumb: h.thumb ?? h.url,
            filename: h.filename,
            prompt: h.prompt ?? undefined,
            size: h.size ?? undefined,
            quality: h.quality ?? undefined,
            provider: h.provider,
            createdAt: h.createdAt,
            sessionId: h.sessionId ?? null,
            nodeId: h.nodeId ?? null,
            clientNodeId: h.clientNodeId ?? null,
            kind: narrowedKind,
            isFavorite: (h as typeof h & { isFavorite?: boolean }).isFavorite ?? false,
          };
        };
        setSessionGroups(
          page.sessions.map((s) => ({
            sessionId: s.sessionId,
            label: s.sessionId.slice(0, 8),
            items: s.items.map(toItem).filter((item) => isVisibleGalleryItem(item, historyTombstones)),
          })).filter((group) => group.items.length > 0),
        );
        setLoose(page.loose.map(toItem).filter((item) => isVisibleGalleryItem(item, historyTombstones)));
      } catch {
        // Fallback: use current history only.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, groupBy, historyTombstones]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase().normalize("NFC");
    return history.filter((h) => {
      if (!isVisibleGalleryItem(h, historyTombstones)) return false;
      if (favoritesOnly && !h.isFavorite) return false;
      if (!q) return true;
      return (
        (h.prompt ?? "").toLowerCase().normalize("NFC").includes(q) ||
        (h.filename ?? "").toLowerCase().normalize("NFC").includes(q)
      );
    });
  }, [history, historyTombstones, query, favoritesOnly]);

  const visibleSessionGroups = useMemo(() => {
    if (!favoritesOnly) return sessionGroups;
    return sessionGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => item.isFavorite),
      }))
      .filter((group) => group.items.length > 0);
  }, [sessionGroups, favoritesOnly]);

  const visibleLoose = useMemo(() => {
    if (!favoritesOnly) return loose;
    return loose.filter((item) => item.isFavorite);
  }, [loose, favoritesOnly]);

  const dateGroups = useMemo(() => {
    const map = new Map<string, GenerateItem[]>();
    for (const item of filtered) {
      const key = dateBucket(item.createdAt);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const showSessions = groupBy === "session";
  const totalVisible = showSessions
    ? visibleSessionGroups.reduce((a, g) => a + g.items.length, 0) + visibleLoose.length
    : filtered.length;
  const flatVisibleItems = useMemo(
    () => (showSessions ? [...visibleSessionGroups.flatMap((group) => group.items), ...visibleLoose] : filtered),
    [filtered, showSessions, visibleLoose, visibleSessionGroups],
  );
  const selectedVisibleIndex = useMemo(() => {
    if (!currentImage) return -1;
    const selectedKey = getGalleryItemKey(currentImage);
    return flatVisibleItems.findIndex((item) => getGalleryItemKey(item) === selectedKey);
  }, [currentImage, flatVisibleItems]);
  const effectiveVisibleLimit = Math.max(
    visibleLimit,
    selectedVisibleIndex >= 0 ? selectedVisibleIndex + 1 : GALLERY_INITIAL_LIMIT,
  );
  const limitedDateGroups = useMemo(
    () => limitDateGroups(dateGroups, effectiveVisibleLimit),
    [dateGroups, effectiveVisibleLimit],
  );
  const limitedSessionGroups = useMemo(
    () => limitSessionGroups(visibleSessionGroups, visibleLoose, effectiveVisibleLimit),
    [effectiveVisibleLimit, visibleLoose, visibleSessionGroups],
  );
  const hasMoreItems = totalVisible > effectiveVisibleLimit;
  const shownItemCount = Math.min(totalVisible, effectiveVisibleLimit);

  useEffect(() => {
    if (open) setVisibleLimit(GALLERY_INITIAL_LIMIT);
  }, [favoritesOnly, groupBy, open, query]);

  useLayoutEffect(() => {
    if (!open) return;
    const selectedKey = currentImage ? getGalleryItemKey(currentImage) : null;
    const selectedEl = selectedKey ? itemRefs.current[selectedKey] : null;
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: "center" });
      return;
    }
    if (scrollRef.current) scrollRef.current.scrollTop = lastScrollTopRef.current;
  }, [
    open,
    currentImage,
    effectiveVisibleLimit,
    groupBy,
    totalVisible,
    dateGroups.length,
    visibleSessionGroups.length,
    visibleLoose.length,
  ]);

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
    if (!item.filename || !toggleGalleryFavorite) return;
    if (historyTombstones.includes(item.filename)) return;
    const storeItem = history.find((candidate) => candidate.filename === item.filename);
    if (!storeItem) return;
    const nextFavorite = !(storeItem.isFavorite ?? item.isFavorite ?? false);
    const updateItem = (candidate: GenerateItem): GenerateItem =>
      candidate.filename === item.filename ? { ...candidate, isFavorite: nextFavorite } : candidate;
    setSessionGroups((groups) =>
      groups.map((group) => ({
        ...group,
        items: group.items.map(updateItem),
      })),
    );
    setLoose((items) => items.map(updateItem));
    setPreviewItem((preview) => preview && preview.filename === item.filename ? { ...preview, isFavorite: nextFavorite } : preview);
    void toggleGalleryFavorite(item.filename);
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
                {query || favoritesOnly ? t("gallery.totalFiltered", { n: history.length }) : ""}
              </div>
            </div>
            <input
              type="search"
              className="gallery__search"
              placeholder={showSessions ? t("gallery.searchDisabledPlaceholder") : t("gallery.searchPlaceholder")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={showSessions}
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
            {showSessions ? (
              <>
                {limitedSessionGroups.groups.map((g) => (
                  <section key={g.sessionId} className="gallery__group">
                    <header className="gallery__group-header">
                      <span className="gallery__group-label">{t("gallery.sessionLabel", { name: g.label })}</span>
                      <span className="gallery__group-count">{g.total}</span>
                    </header>
                    <div className="gallery__grid">
                      {g.items.map((item) => renderTile(item, g.sessionId))}
                    </div>
                  </section>
                ))}
                {limitedSessionGroups.loose.length > 0 && (
                  <section className="gallery__group">
                    <header className="gallery__group-header">
                      <span className="gallery__group-label">{t("gallery.standalone")}</span>
                      <span className="gallery__group-count">{limitedSessionGroups.looseTotal}</span>
                    </header>
                    <div className="gallery__grid">
                      {limitedSessionGroups.loose.map((item) => renderTile(item, "loose"))}
                    </div>
                  </section>
                )}
                {visibleSessionGroups.length === 0 && visibleLoose.length === 0 && (
                  <div className="gallery__empty">
                    {favoritesOnly ? t("gallery.emptyFavorites") : t("gallery.emptySessions")}
                  </div>
                )}
              </>
            ) : filtered.length === 0 ? (
              <div className="gallery__empty">
                {history.length === 0
                  ? t("gallery.emptyAll")
                  : favoritesOnly
                    ? t("gallery.emptyFavorites")
                  : t("gallery.noResults")}
              </div>
            ) : (
              limitedDateGroups.map(([label, items, total]) => (
                <section key={label} className="gallery__group">
                  <header className="gallery__group-header">
                    <span className="gallery__group-label">{localizeBucket(label)}</span>
                    <span className="gallery__group-count">{total}</span>
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
                  onClick={() => setVisibleLimit((limit) => limit + GALLERY_LOAD_MORE_STEP)}
                >
                  {t("gallery.loadMore", { shown: shownItemCount, total: totalVisible })}
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
