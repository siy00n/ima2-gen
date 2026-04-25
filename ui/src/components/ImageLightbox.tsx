import { useEffect, useRef, useState, type MouseEvent, type PointerEvent, type WheelEvent } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n";

type Props = {
  open: boolean;
  imageSrc: string | null;
  title?: string;
  meta?: string;
  onClose: () => void;
};

type Pan = { x: number; y: number };
type ViewState = { scale: number; pan: Pan };
type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const ZOOM_STEP = 0.25;

function clampScale(value: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(value.toFixed(2))));
}

export function ImageLightbox({ open, imageSrc, title, meta, onClose }: Props) {
  const { t } = useI18n();
  const [view, setView] = useState<ViewState>({ scale: 1, pan: { x: 0, y: 0 } });
  const dragRef = useRef<DragState | null>(null);
  const { scale, pan } = view;

  const resetView = () => {
    setView({ scale: 1, pan: { x: 0, y: 0 } });
  };

  const zoomBy = (delta: number) => {
    setView((current) => {
      const scale = clampScale(current.scale + delta);
      return {
        scale,
        pan: scale === 1 ? { x: 0, y: 0 } : current.pan,
      };
    });
  };

  useEffect(() => {
    if (!open) return;
    resetView();
  }, [imageSrc, open]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomBy(ZOOM_STEP);
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        zoomBy(-ZOOM_STEP);
      } else if (event.key === "0") {
        event.preventDefault();
        resetView();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open || !imageSrc) return null;

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    zoomBy(event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP);
  };

  const handleStageClick = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.target === event.currentTarget) onClose();
  };

  const handlePointerDown = (event: PointerEvent<HTMLImageElement>) => {
    if (scale <= 1) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: pan.x,
      originY: pan.y,
    };
  };

  const handlePointerMove = (event: PointerEvent<HTMLImageElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    setView((current) => ({
      ...current,
      pan: {
        x: drag.originX + event.clientX - drag.startX,
        y: drag.originY + event.clientY - drag.startY,
      },
    }));
  };

  const endDrag = (event: PointerEvent<HTMLImageElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
  };

  return createPortal(
    <div className="image-lightbox" role="dialog" aria-modal="true" aria-label={title ?? t("node.nodeImageAlt")} onClick={onClose}>
      <div className="image-lightbox__topbar" onClick={(event) => event.stopPropagation()}>
        <div className="image-lightbox__title">
          <strong>{title}</strong>
          {meta ? <span>{meta}</span> : null}
        </div>
        <button type="button" className="image-lightbox__close" onClick={onClose} aria-label={t("lightbox.close")} title={t("lightbox.close")}>
          ×
        </button>
      </div>
      <div className="image-lightbox__stage" onClick={handleStageClick} onWheel={handleWheel}>
        <img
          src={imageSrc}
          alt={title ?? t("node.nodeImageAlt")}
          draggable={false}
          className="image-lightbox__image"
          style={{
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${scale})`,
            cursor: scale > 1 ? "grab" : "default",
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />
      </div>
      <div className="image-lightbox__controls" onClick={(event) => event.stopPropagation()}>
        <button type="button" onClick={() => zoomBy(-ZOOM_STEP)} disabled={scale <= MIN_SCALE} aria-label={t("lightbox.zoomOut")} title={t("lightbox.zoomOut")}>
          -
        </button>
        <span>{Math.round(scale * 100)}%</span>
        <button type="button" onClick={() => zoomBy(ZOOM_STEP)} disabled={scale >= MAX_SCALE} aria-label={t("lightbox.zoomIn")} title={t("lightbox.zoomIn")}>
          +
        </button>
        <button type="button" onClick={resetView} aria-label={t("lightbox.resetZoom")} title={t("lightbox.resetZoom")}>
          0
        </button>
      </div>
    </div>,
    document.body,
  );
}
