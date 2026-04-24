import { useRef, type TouchEvent } from "react";
import { useAppStore } from "../store/useAppStore";
import { ResultActions } from "./ResultActions";
import { useI18n } from "../i18n";
import { useIsMobile } from "../hooks/useIsMobile";
import { copyTextToClipboard } from "../lib/clipboard";

function sameImage(a: { filename?: string; image: string } | null, b: { filename?: string; image: string } | null) {
  if (!a || !b) return false;
  if (a.filename && b.filename) return a.filename === b.filename;
  return a.image === b.image;
}

export function Canvas() {
  const currentImage = useAppStore((s) => s.currentImage);
  const history = useAppStore((s) => s.history);
  const selectPreviousImage = useAppStore((s) => s.selectPreviousImage);
  const selectNextImage = useAppStore((s) => s.selectNextImage);
  const activeGenerations = useAppStore((s) => s.activeGenerations);
  const quality = useAppStore((s) => s.quality);
  const getResolvedSize = useAppStore((s) => s.getResolvedSize);
  const showToast = useAppStore((s) => s.showToast);
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const copyPrompt = async () => {
    if (!currentImage?.prompt) return;
    try {
      await copyTextToClipboard(currentImage.prompt);
      showToast(t("toast.promptCopied"));
    } catch {
      showToast(t("toast.copyFailed"), true);
    }
  };

  const displayQuality = currentImage?.quality ?? quality;
  const displaySize = currentImage?.size ?? getResolvedSize();
  const currentIndex = history.findIndex((item) => sameImage(item, currentImage));
  const showNav = isMobile && history.length > 1 && currentIndex >= 0;
  const canPrevious = currentIndex > 0;
  const canNext = currentIndex >= 0 && currentIndex < history.length - 1;

  const onTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    const t0 = e.touches[0];
    if (!t0) return;
    touchStart.current = { x: t0.clientX, y: t0.clientY };
  };

  const onTouchEnd = (e: TouchEvent<HTMLDivElement>) => {
    const start = touchStart.current;
    touchStart.current = null;
    const t0 = e.changedTouches[0];
    if (!start || !t0 || !showNav) return;
    const dx = t0.clientX - start.x;
    const dy = t0.clientY - start.y;
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
    if (dx < 0 && canNext) selectNextImage();
    if (dx > 0 && canPrevious) selectPreviousImage();
  };

  return (
    <main className="canvas">
      <div className={`progress-bar${activeGenerations > 0 ? " active" : ""}`} />
      {currentImage ? (
        <div className="result-container visible">
          <div
            className="result-stage"
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
          >
            {showNav ? (
              <>
                <button
                  type="button"
                  className="result-nav result-nav--prev"
                  onClick={selectPreviousImage}
                  disabled={!canPrevious}
                  aria-label={t("result.previousImage")}
                  title={t("result.previousImage")}
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="result-nav result-nav--next"
                  onClick={selectNextImage}
                  disabled={!canNext}
                  aria-label={t("result.nextImage")}
                  title={t("result.nextImage")}
                >
                  ›
                </button>
                <div className="result-counter">
                  {t("result.imageCounter", { current: currentIndex + 1, total: history.length })}
                </div>
              </>
            ) : null}
            <img
              className="result-img"
              key={currentImage.filename ?? currentImage.url ?? currentImage.image}
              src={currentImage.url ?? currentImage.image}
              alt={t("canvas.resultAlt")}
            />
          </div>
          {currentImage.prompt ? (
            <div className="result-prompt" onClick={() => void copyPrompt()}>
              {currentImage.prompt}
            </div>
          ) : null}
          <div className="result-meta">
            {[
              currentImage.elapsed != null ? `${currentImage.elapsed}s` : null,
              currentImage.usage
                ? t("canvas.tokens", { n: currentImage.usage.total_tokens ?? "?" })
                : null,
              displayQuality,
              displaySize,
              currentImage.provider ?? null,
            ]
              .filter((v): v is string => Boolean(v))
              .join(" · ")}
          </div>
          <ResultActions />
        </div>
      ) : null}
    </main>
  );
}
