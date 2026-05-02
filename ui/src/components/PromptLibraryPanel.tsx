import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import {
  readPromptImportFiles,
  type PromptCreatePayload,
  type PromptItem,
  type PromptLibraryImportPayload,
  type PromptUpdatePayload,
} from "../lib/promptLibrary";
import { PromptLibraryEditor } from "./PromptLibraryEditor";
import { PromptLibraryRow } from "./PromptLibraryRow";
import { useIsMobile } from "../hooks/useIsMobile";

type PromptLibraryLabels = {
  title?: string;
  add?: string;
  import?: string;
  importFiles?: string;
  search?: string;
  favorites?: string;
  loading?: string;
  empty?: string;
  dropImport?: string;
  close?: string;
  delete?: string;
  edit?: string;
  favorite?: string;
  unfavorite?: string;
  use?: string;
  insert?: string;
  replacePrompt?: string;
  appendPrompt?: string;
  preview?: string;
  target?: string;
  noSelection?: string;
  selectPrompt?: string;
  untitled?: string;
  addTitle?: string;
  editTitle?: string;
  name?: string;
  text?: string;
  tags?: string;
  mode?: string;
  cancel?: string;
  save?: string;
};

export type PromptLibraryPanelProps = {
  open?: boolean;
  prompts: PromptItem[];
  loading?: boolean;
  saving?: boolean;
  error?: string | null;
  labels?: PromptLibraryLabels;
  targetLabel?: string;
  targetAvailable?: boolean;
  lastSavedId?: string | null;
  onClose?: () => void;
  onCreate?: (payload: PromptCreatePayload) => void | Promise<void>;
  onUpdate?: (id: string, payload: PromptUpdatePayload) => void | Promise<void>;
  onDelete?: (id: string, prompt: PromptItem) => void | Promise<void>;
  onToggleFavorite?: (id: string, prompt: PromptItem) => void | Promise<void>;
  onImport?: (payload: PromptLibraryImportPayload) => void | Promise<void>;
  onUse?: (prompt: PromptItem) => void;
  onInsert?: (prompt: PromptItem) => void;
};

function promptPreview(prompt: PromptItem | null, fallback: string) {
  if (!prompt) return fallback;
  return prompt.text.trim() || fallback;
}

export function PromptLibraryPanel({
  open = true,
  prompts,
  loading = false,
  saving = false,
  error = null,
  labels = {},
  targetLabel,
  targetAvailable = true,
  lastSavedId = null,
  onClose,
  onCreate,
  onUpdate,
  onDelete,
  onToggleFavorite,
  onImport,
  onUse,
  onInsert,
}: PromptLibraryPanelProps) {
  const [search, setSearch] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [editing, setEditing] = useState<PromptItem | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return prompts.filter((prompt) => {
      if (favoritesOnly && !prompt.isFavorite) return false;
      if (!term) return true;
      return (
        prompt.name.toLowerCase().includes(term) ||
        prompt.text.toLowerCase().includes(term) ||
        prompt.tags.some((tag) => tag.toLowerCase().includes(term))
      );
    });
  }, [favoritesOnly, prompts, search]);

  const selectedPrompt = useMemo(() => {
    return filtered.find((prompt) => prompt.id === selectedId) ?? filtered[0] ?? null;
  }, [filtered, selectedId]);

  useEffect(() => {
    if (!open) {
      setMobileDetailOpen(false);
      return;
    }
    if (!selectedPrompt) {
      setSelectedId(null);
      return;
    }
    if (selectedPrompt.id !== selectedId) setSelectedId(selectedPrompt.id);
  }, [open, selectedId, selectedPrompt]);

  if (!open) return null;

  const importFiles = async (files: File[]) => {
    if (!onImport || files.length === 0) return;
    await onImport(await readPromptImportFiles(files));
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const files = Array.from(e.dataTransfer.files).filter((file) =>
      /\.(json|txt|md)$/i.test(file.name),
    );
    void importFiles(files);
  };

  const handleFileImport = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    void importFiles(files);
    e.target.value = "";
  };

  const closeEditor = () => {
    setEditorOpen(false);
    setEditing(null);
  };

  const openEditor = (prompt: PromptItem | null) => {
    setEditing(prompt);
    setEditorOpen(true);
    if (isMobile) setMobileDetailOpen(true);
  };

  const selectPrompt = (prompt: PromptItem) => {
    setSelectedId(prompt.id);
    if (isMobile) setMobileDetailOpen(true);
  };

  const title = selectedPrompt?.name || labels.untitled || "Untitled prompt";
  const canApplyPrompt = targetAvailable && !!selectedPrompt;
  const showMobileDetail = isMobile && (mobileDetailOpen || editorOpen);

  return (
    <section
      className="prompt-library-panel"
      onDragEnter={(e) => {
        e.preventDefault();
        setDragActive(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => setDragActive(false)}
      onDrop={handleDrop}
    >
      {onClose && (
        <button
          type="button"
          className="prompt-library-panel__backdrop"
          onClick={onClose}
          aria-label={labels.close || "Close"}
        />
      )}
      <div className="prompt-library-panel__dialog" role="dialog" aria-modal="true">
        <header className="prompt-library-panel__header">
          <div className="prompt-library-panel__heading">
            <h2 className="prompt-library-panel__title">
              {labels.title || "Prompt library"}
            </h2>
            <div className="prompt-library-panel__target">
              <span>{labels.target || "Target"}</span>
              <strong>{targetLabel || "-"}</strong>
            </div>
          </div>
          <div className="prompt-library-panel__actions">
            {onCreate && (
              <button
                type="button"
                className="prompt-library-panel__add"
                onClick={() => openEditor(null)}
              >
                {labels.add || "Add"}
              </button>
            )}
            {onImport && (
              <>
                <div className="prompt-library-panel__import-wrap">
                  <button
                    type="button"
                    className="prompt-library-panel__import"
                    onClick={() => fileInputRef.current?.click()}
                    title={labels.importFiles || "Import files"}
                  >
                    {labels.import || "Import"}
                  </button>
                  <span className="prompt-library-panel__import-hint">
                    {labels.importFiles || "JSON, TXT, or MD files"}
                  </span>
                </div>
                <input
                  ref={fileInputRef}
                  className="prompt-library-panel__file-input"
                  type="file"
                  accept=".json,.txt,.md,application/json,text/plain,text/markdown"
                  multiple
                  onChange={handleFileImport}
                />
              </>
            )}
            {onClose && !isMobile && (
              <button
                type="button"
                className="prompt-library-panel__close"
                onClick={onClose}
                aria-label={labels.close || "Close"}
                title={labels.close || "Close"}
              >
                ×
              </button>
            )}
          </div>
        </header>

        <div className="prompt-library-panel__body">
          {(!isMobile || !showMobileDetail) ? (
          <div className="prompt-library-panel__browser">
            <div className="prompt-library-panel__filters">
              <input
                className="prompt-library-panel__search"
                type="search"
                value={search}
                placeholder={labels.search || "Search prompts"}
                onChange={(e) => setSearch(e.target.value)}
              />
              <label className="prompt-library-panel__favorite-filter">
                <input
                  type="checkbox"
                  checked={favoritesOnly}
                  onChange={(e) => setFavoritesOnly(e.target.checked)}
                />
                <span>{labels.favorites || "Favorites"}</span>
              </label>
            </div>

            {error && <div className="prompt-library-panel__error">{error}</div>}

            <div className="prompt-library-panel__list">
              {loading ? (
                <div className="prompt-library-panel__loading">
                  {labels.loading || "Loading..."}
                </div>
              ) : filtered.length === 0 ? (
                <div className="prompt-library-panel__empty">
                  {labels.empty || "No prompts yet"}
                </div>
              ) : (
                filtered.map((prompt) => (
                  <PromptLibraryRow
                    key={prompt.id}
                    prompt={prompt}
                    selected={selectedPrompt?.id === prompt.id}
                    highlighted={lastSavedId === prompt.id}
                    labels={labels}
                    onSelect={selectPrompt}
                    onToggleFavorite={
                      onToggleFavorite
                        ? (item) => void onToggleFavorite(item.id, item)
                        : undefined
                    }
                  />
                ))
              )}
            </div>
          </div>
          ) : null}

          {(!isMobile || showMobileDetail) ? (
          <aside className="prompt-library-panel__detail">
            {isMobile ? (
              <button
                type="button"
                className="prompt-library-panel__back"
                onClick={() => {
                  closeEditor();
                  setMobileDetailOpen(false);
                }}
              >
                {"<"} {labels.title || "Prompt library"}
              </button>
            ) : null}
            {editorOpen ? (
              <PromptLibraryEditor
                prompt={editing}
                saving={saving}
                labels={labels}
                onCancel={closeEditor}
                onSave={async (payload) => {
                  if (editing) {
                    await onUpdate?.(editing.id, payload);
                    setSelectedId(editing.id);
                  } else {
                    await onCreate?.(payload as PromptCreatePayload);
                  }
                  closeEditor();
                }}
              />
            ) : selectedPrompt ? (
              <>
                <div className="prompt-library-panel__detail-head">
                  <span className="prompt-library-panel__detail-label">
                    {labels.preview || "Preview"}
                  </span>
                  <h3>{title}</h3>
                </div>
                <div className="prompt-library-panel__preview">
                  {promptPreview(selectedPrompt, labels.noSelection || "Select a prompt")}
                </div>
                {selectedPrompt.tags.length > 0 || selectedPrompt.mode ? (
                  <div className="prompt-library-panel__meta">
                    {selectedPrompt.mode ? (
                      <span>{selectedPrompt.mode}</span>
                    ) : null}
                    {selectedPrompt.tags.map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </div>
                ) : null}
                {!targetAvailable ? (
                  <div className="prompt-library-panel__notice">
                    {labels.noSelection || "Select a target first."}
                  </div>
                ) : null}
                <div className="prompt-library-panel__detail-actions">
                  {onInsert && (
                    <button
                      type="button"
                      className="prompt-library-panel__primary"
                      onClick={() => onInsert(selectedPrompt)}
                      disabled={!canApplyPrompt}
                    >
                      {labels.appendPrompt || labels.insert || "Append to prompt"}
                    </button>
                  )}
                  {onUse && (
                    <button
                      type="button"
                      onClick={() => onUse(selectedPrompt)}
                      disabled={!canApplyPrompt}
                    >
                      {labels.replacePrompt || labels.use || "Replace prompt"}
                    </button>
                  )}
                  {onToggleFavorite && (
                    <button
                      type="button"
                      onClick={() => void onToggleFavorite(selectedPrompt.id, selectedPrompt)}
                    >
                      {selectedPrompt.isFavorite
                        ? labels.unfavorite || "Remove favorite"
                        : labels.favorite || "Favorite"}
                    </button>
                  )}
                  {onUpdate && (
                    <button type="button" onClick={() => openEditor(selectedPrompt)}>
                      {labels.edit || "Edit"}
                    </button>
                  )}
                  {onDelete && (
                    <button
                      type="button"
                      className="prompt-library-panel__danger"
                      onClick={() => void onDelete(selectedPrompt.id, selectedPrompt)}
                    >
                      {labels.delete || "Delete"}
                    </button>
                  )}
                </div>
              </>
            ) : (
              <div className="prompt-library-panel__empty">
                {labels.selectPrompt || labels.empty || "Select a prompt"}
              </div>
            )}
          </aside>
          ) : null}
        </div>

        {dragActive && onImport && (
          <div className="prompt-library-panel__drop-overlay">
            <div className="prompt-library-panel__drop-message">
              {labels.dropImport || "Drop prompt files to import"}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
