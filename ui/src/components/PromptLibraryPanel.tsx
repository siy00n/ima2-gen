import {
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
  onClose?: () => void;
  onCreate?: (payload: PromptCreatePayload) => void | Promise<void>;
  onUpdate?: (id: string, payload: PromptUpdatePayload) => void | Promise<void>;
  onDelete?: (id: string, prompt: PromptItem) => void | Promise<void>;
  onToggleFavorite?: (id: string, prompt: PromptItem) => void | Promise<void>;
  onImport?: (payload: PromptLibraryImportPayload) => void | Promise<void>;
  onUse?: (prompt: PromptItem) => void;
  onInsert?: (prompt: PromptItem) => void;
};

export function PromptLibraryPanel({
  open = true,
  prompts,
  loading = false,
  saving = false,
  error = null,
  labels = {},
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
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      <div className="prompt-library-panel__drawer">
        <header className="prompt-library-panel__header">
          <h2 className="prompt-library-panel__title">
            {labels.title || "Prompt library"}
          </h2>
          <div className="prompt-library-panel__actions">
            {onCreate && (
              <button
                type="button"
                className="prompt-library-panel__add"
                onClick={() => {
                  setEditing(null);
                  setEditorOpen(true);
                }}
              >
                {labels.add || "Add"}
              </button>
            )}
            {onImport && (
              <>
                <button
                  type="button"
                  className="prompt-library-panel__import"
                  onClick={() => fileInputRef.current?.click()}
                  title={labels.importFiles || "Import files"}
                >
                  {labels.import || "Import"}
                </button>
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
            {onClose && (
              <button
                type="button"
                className="prompt-library-panel__close"
                onClick={onClose}
                aria-label={labels.close || "Close"}
              >
                ×
              </button>
            )}
          </div>
        </header>

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

        {editorOpen && (
          <PromptLibraryEditor
            prompt={editing}
            saving={saving}
            labels={labels}
            onCancel={closeEditor}
            onSave={async (payload) => {
              if (editing) {
                await onUpdate?.(editing.id, payload);
              } else {
                await onCreate?.(payload as PromptCreatePayload);
              }
              closeEditor();
            }}
          />
        )}

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
                labels={labels}
                onUse={onUse}
                onInsert={onInsert}
                onToggleFavorite={
                  onToggleFavorite
                    ? (item) => void onToggleFavorite(item.id, item)
                    : undefined
                }
                onEdit={
                  onUpdate
                    ? (item) => {
                        setEditing(item);
                        setEditorOpen(true);
                      }
                    : undefined
                }
                onDelete={
                  onDelete ? (item) => void onDelete(item.id, item) : undefined
                }
              />
            ))
          )}
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
