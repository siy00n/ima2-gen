import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useAppStore } from "../store/useAppStore";
import { useI18n } from "../i18n";
import { getGalleryItemKey } from "../lib/galleryNavigation";
import { handleHorizontalWheel } from "../lib/horizontalWheel";
import type { GenerateItem } from "../types";
import { ImageLightbox } from "./ImageLightbox";

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

type FavoriteActions = {
  toggleGalleryFavorite?: (filename: string) => void | Promise<void>;
};

export function HistoryStrip() {
  const history = useAppStore((s) => s.history);
  const currentImage = useAppStore((s) => s.currentImage);
  const selectHistory = useAppStore((s) => s.selectHistory);
  const openGallery = useAppStore((s) => s.openGallery);
  const toggleGalleryFavorite = useAppStore((s) => (s as typeof s & FavoriteActions).toggleGalleryFavorite);
  const { t } = useI18n();
  const [previewItem, setPreviewItem] = useState<GenerateItem | null>(null);
  const thumbRefs = useRef<Record<string, HTMLElement | null>>({});
  const activeKey = currentImage ? getGalleryItemKey(currentImage) : null;

  useEffect(() => {
    if (!activeKey) return;
    thumbRefs.current[activeKey]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeKey, history]);

  const openPreview = (item: GenerateItem) => {
    selectHistory(item);
    setPreviewItem(item);
  };

  const toggleFavorite = (item: GenerateItem, event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!item.filename || !toggleGalleryFavorite) return;
    void toggleGalleryFavorite(item.filename);
  };

  const previewTitle =
    previewItem?.prompt?.trim() ||
    previewItem?.filename ||
    t("gallery.imageAltFallback");
  const previewMeta = previewItem ? previewMetaForItem(previewItem) : "";

  return (
    <>
      <div className="history-strip" onWheel={handleHorizontalWheel}>
        <button
          type="button"
          className="history-thumb history-thumb--add"
          onClick={openGallery}
          aria-label={t("history.openGalleryAria")}
          title={t("history.openGalleryTitle")}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
        </button>
        {history.map((item) => {
          const key = getGalleryItemKey(item);
          const active = activeKey === key;
          return (
            <div
              key={key}
              ref={(node) => {
                thumbRefs.current[key] = node;
              }}
              className={`history-thumb-wrap${item.isFavorite ? " history-thumb-wrap--favorite" : ""}`}
            >
              <button
                type="button"
                className={`history-thumb${active ? " active" : ""}`}
                onClick={() => openPreview(item)}
                aria-label={t("history.openPreviewAria")}
                title={t("history.openPreviewTitle")}
              >
                <img
                  src={item.thumb || item.url || item.image}
                  alt=""
                  className="history-thumb__image"
                />
              </button>
              {item.filename && (
                <button
                  type="button"
                  className={`history-thumb__favorite${item.isFavorite ? " history-thumb__favorite--on" : ""}`}
                  onClick={(event) => toggleFavorite(item, event)}
                  title={item.isFavorite ? t("gallery.unfavoriteTitle") : t("gallery.favoriteTitle")}
                  aria-label={item.isFavorite ? t("gallery.unfavoriteAria") : t("gallery.favoriteAria")}
                  aria-pressed={item.isFavorite}
                >
                  ★
                </button>
              )}
            </div>
          );
        })}
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
