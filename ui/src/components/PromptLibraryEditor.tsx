import { useEffect, useState, type FormEvent } from "react";
import type {
  PromptCreatePayload,
  PromptItem,
  PromptMode,
  PromptUpdatePayload,
} from "../lib/promptLibrary";

type PromptLibraryEditorProps = {
  prompt?: PromptItem | null;
  saving?: boolean;
  labels?: {
    addTitle?: string;
    editTitle?: string;
    name?: string;
    text?: string;
    tags?: string;
    mode?: string;
    cancel?: string;
    save?: string;
  };
  onCancel: () => void;
  onSave: (payload: PromptCreatePayload | PromptUpdatePayload) => void | Promise<void>;
};

export function PromptLibraryEditor({
  prompt,
  saving = false,
  labels = {},
  onCancel,
  onSave,
}: PromptLibraryEditorProps) {
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [tags, setTags] = useState("");
  const [mode, setMode] = useState<PromptMode | "">("");

  useEffect(() => {
    setName(prompt?.name ?? "");
    setText(prompt?.text ?? "");
    setTags(prompt?.tags.join(", ") ?? "");
    setMode(prompt?.mode ?? "");
  }, [prompt]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const cleanText = text.trim();
    if (!cleanText) return;
    void onSave({
      name: name.trim() || cleanText.slice(0, 40),
      text: cleanText,
      tags: tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      mode: mode || null,
    });
  };

  return (
    <form className="prompt-library-editor" onSubmit={submit}>
      <div className="prompt-library-editor__header">
        <h3 className="prompt-library-editor__title">
          {prompt ? labels.editTitle || "Edit prompt" : labels.addTitle || "Add prompt"}
        </h3>
      </div>
      <label className="prompt-library-editor__field">
        <span className="prompt-library-editor__label">{labels.name || "Name"}</span>
        <input
          className="prompt-library-editor__input"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="prompt-library-editor__field">
        <span className="prompt-library-editor__label">{labels.text || "Prompt"}</span>
        <textarea
          className="prompt-library-editor__textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          autoFocus
          required
        />
      </label>
      <label className="prompt-library-editor__field">
        <span className="prompt-library-editor__label">{labels.tags || "Tags"}</span>
        <input
          className="prompt-library-editor__input"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="product, portrait"
        />
      </label>
      <details className="prompt-library-editor__advanced">
        <summary>{labels.mode || "Mode"}</summary>
        <label className="prompt-library-editor__field">
          <span className="prompt-library-editor__label">{labels.mode || "Mode"}</span>
          <select
            className="prompt-library-editor__select"
            value={mode}
            onChange={(e) => setMode(e.target.value as PromptMode | "")}
          >
            <option value="">Default</option>
            <option value="auto">Auto</option>
            <option value="direct">Direct</option>
          </select>
        </label>
      </details>
      <div className="prompt-library-editor__actions">
        <button
          type="button"
          className="prompt-library-editor__cancel"
          onClick={onCancel}
        >
          {labels.cancel || "Cancel"}
        </button>
        <button
          type="submit"
          className="prompt-library-editor__save"
          disabled={saving || !text.trim()}
        >
          {labels.save || "Save"}
        </button>
      </div>
    </form>
  );
}
