import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { useI18n } from "../i18n";
import { useAppStore } from "../store/useAppStore";
import { GenerateButton } from "./GenerateButton";
import { PromptComposer } from "./PromptComposer";

const MAX_REFS = 5;

function extractClipboardImages(items: DataTransferItemList | null): File[] {
  if (!items) return [];
  const files: File[] = [];
  for (const item of Array.from(items)) {
    if (item.kind !== "file") continue;
    if (!item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return files;
}

export function ClassicFloatingComposer() {
  const { t } = useI18n();
  const prompt = useAppStore((s) => s.prompt);
  const setPrompt = useAppStore((s) => s.setPrompt);
  const generate = useAppStore((s) => s.generate);
  const refs = useAppStore((s) => s.referenceImages);
  const addReferences = useAppStore((s) => s.addReferences);
  const openPromptLibrary = useAppStore((s) => s.openPromptLibrary);
  const activeGenerations = useAppStore((s) => s.activeGenerations);
  const expanded = useAppStore((s) => s.classicComposerExpanded);
  const setExpanded = useAppStore((s) => s.setClassicComposerExpanded);
  const dockRef = useRef<HTMLElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const previousActive = useRef(activeGenerations);
  const [dragOver, setDragOver] = useState(false);
  const canAddMore = refs.length < MAX_REFS;

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!expanded) return;
      const target = event.target as Node | null;
      if (target && dockRef.current?.contains(target)) return;
      if (refs.length > 0) return;
      setExpanded(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (!expanded) return;
      if (refs.length > 0) return;
      setExpanded(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [expanded, refs.length, setExpanded]);

  useEffect(() => {
    if (previousActive.current > 0 && activeGenerations === 0) {
      setExpanded(false);
    }
    previousActive.current = activeGenerations;
  }, [activeGenerations, setExpanded]);

  useEffect(() => {
    if (!expanded) return;
    const frame = window.requestAnimationFrame(() => {
      const textarea = dockRef.current?.querySelector<HTMLTextAreaElement>(".composer__textarea");
      textarea?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [expanded]);

  const attachFiles = (files: File[]) => {
    if (!canAddMore || files.length === 0) return;
    const room = MAX_REFS - refs.length;
    setExpanded(true);
    void addReferences(files.slice(0, room));
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragOver(false);
    attachFiles(Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith("image/")));
  };

  const onPaste = (event: ClipboardEvent<HTMLElement>) => {
    const files = extractClipboardImages(event.clipboardData?.items ?? null);
    if (files.length === 0) return;
    event.preventDefault();
    attachFiles(files);
  };

  return (
    <section
      ref={dockRef}
      className={`classic-composer-dock${expanded ? " classic-composer-dock--expanded" : " classic-composer-dock--compact"}${dragOver ? " classic-composer-dock--drag" : ""}`}
      aria-label={t("prompt.floatingComposer")}
      onDrop={onDrop}
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
        setExpanded(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDragOver(false);
      }}
      onPaste={onPaste}
    >
      {expanded ? (
        <>
          <PromptComposer variant="floating" />
          <GenerateButton variant="dock" />
        </>
      ) : (
        <>
          <button
            type="button"
            className="classic-composer-dock__tool"
            onClick={() => canAddMore && fileInput.current?.click()}
            disabled={!canAddMore}
            title={t("prompt.attachTitle")}
            aria-label={t("prompt.attachTitle")}
          >
            +
          </button>
          <input
            className="classic-composer-dock__input"
            value={prompt}
            placeholder={refs.length > 0 ? t("prompt.placeholderWithRefs") : t("prompt.placeholder")}
            onFocus={() => setExpanded(true)}
            onClick={() => setExpanded(true)}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void generate();
              }
            }}
          />
          <button
            type="button"
            className="classic-composer-dock__tool classic-composer-dock__library"
            onClick={() => void openPromptLibrary()}
            title={t("promptLibrary.open")}
            aria-label={t("promptLibrary.open")}
          >
            {t("promptLibrary.short")}
          </button>
          <GenerateButton variant="compact" />
        </>
      )}
      {dragOver ? (
        <div className="classic-composer-dock__dropzone" aria-hidden="true">
          {t("prompt.dropHere", { max: MAX_REFS })}
        </div>
      ) : null}
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          attachFiles(files);
          event.target.value = "";
        }}
      />
    </section>
  );
}
