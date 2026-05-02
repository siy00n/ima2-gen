import { useCallback, useEffect, useRef } from "react";
import { useIsMobile } from "./useIsMobile";

const HISTORY_MARKER = "__ima2MobileOverlay";

let overlaySequence = 0;
let overlayStack: string[] = [];
let suppressNextPop = false;
let handledPopEvent: PopStateEvent | null = null;

function removeOverlay(id: string) {
  overlayStack = overlayStack.filter((item) => item !== id);
}

function currentHistoryMarker() {
  const state = window.history.state;
  if (!state || typeof state !== "object") return null;
  return (state as Record<string, unknown>)[HISTORY_MARKER];
}

function withOverlayMarker(id: string) {
  const state = window.history.state;
  const base = state && typeof state === "object" ? { ...(state as Record<string, unknown>) } : {};
  return { ...base, [HISTORY_MARKER]: id };
}

export function useMobileBackDismiss(active: boolean, onDismiss: () => void) {
  const isMobile = useIsMobile();
  const idRef = useRef<string>("");
  const pushedRef = useRef(false);
  const activeRef = useRef(active);
  const onDismissRef = useRef(onDismiss);

  if (!idRef.current) {
    overlaySequence += 1;
    idRef.current = `overlay-${overlaySequence}`;
  }

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const dismiss = useCallback(() => {
    const id = idRef.current;
    if (isMobile && activeRef.current && currentHistoryMarker() === id) {
      window.history.back();
      return;
    }
    onDismissRef.current();
  }, [isMobile]);

  useEffect(() => {
    if (!isMobile || !active) return;

    const id = idRef.current;
    overlayStack.push(id);
    window.history.pushState(withOverlayMarker(id), "", window.location.href);
    pushedRef.current = true;

    const onPopState = (event: PopStateEvent) => {
      if (handledPopEvent === event) return;
      if (suppressNextPop) {
        suppressNextPop = false;
        handledPopEvent = event;
        queueMicrotask(() => {
          if (handledPopEvent === event) handledPopEvent = null;
        });
        return;
      }
      if (overlayStack[overlayStack.length - 1] !== id) return;
      handledPopEvent = event;
      removeOverlay(id);
      pushedRef.current = false;
      onDismissRef.current();
      queueMicrotask(() => {
        if (handledPopEvent === event) handledPopEvent = null;
      });
    };

    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      removeOverlay(id);
      if (pushedRef.current && currentHistoryMarker() === id) {
        pushedRef.current = false;
        suppressNextPop = true;
        window.history.back();
      }
    };
  }, [active, isMobile]);

  return dismiss;
}
