import type { PromptItem } from "../lib/promptLibrary";

type PromptLibraryRowProps = {
  prompt: PromptItem;
  selected?: boolean;
  highlighted?: boolean;
  compact?: boolean;
  labels?: {
    favorite?: string;
    unfavorite?: string;
    edit?: string;
    delete?: string;
    use?: string;
    insert?: string;
    untitled?: string;
  };
  onSelect?: (prompt: PromptItem) => void;
  onUse?: (prompt: PromptItem) => void;
  onInsert?: (prompt: PromptItem) => void;
  onEdit?: (prompt: PromptItem) => void;
  onDelete?: (prompt: PromptItem) => void;
  onToggleFavorite?: (prompt: PromptItem) => void;
};

export function PromptLibraryRow({
  prompt,
  selected = false,
  highlighted = false,
  compact = false,
  labels = {},
  onSelect,
  onUse,
  onInsert,
  onEdit,
  onDelete,
  onToggleFavorite,
}: PromptLibraryRowProps) {
  const title = prompt.name || labels.untitled || "Untitled";
  const preview =
    prompt.text.length > 96 ? `${prompt.text.slice(0, 96)}...` : prompt.text;

  return (
    <article
      className={`prompt-library-row${selected ? " prompt-library-row--selected" : ""}${highlighted ? " prompt-library-row--highlighted" : ""}${compact ? " prompt-library-row--compact" : ""}`}
      onClick={() => onSelect?.(prompt)}
    >
      <div className="prompt-library-row__main">
        <div className="prompt-library-row__title">{title}</div>
        <div className="prompt-library-row__preview">{preview}</div>
        {prompt.tags.length > 0 && (
          <div className="prompt-library-row__tags">
            {prompt.tags.map((tag) => (
              <span key={tag} className="prompt-library-row__tag">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="prompt-library-row__actions">
        {onUse && (
          <button
            type="button"
            className="prompt-library-row__use"
            onClick={(e) => {
              e.stopPropagation();
              onUse(prompt);
            }}
          >
            {labels.use || "Use"}
          </button>
        )}
        {onInsert && (
          <button
            type="button"
            className="prompt-library-row__insert"
            onClick={(e) => {
              e.stopPropagation();
              onInsert(prompt);
            }}
          >
            {labels.insert || "Insert"}
          </button>
        )}
        {onToggleFavorite && (
          <button
            type="button"
            className={`prompt-library-row__favorite${
              prompt.isFavorite ? " prompt-library-row__favorite--on" : ""
            }`}
            aria-pressed={prompt.isFavorite}
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite(prompt);
            }}
            aria-label={
              prompt.isFavorite
                ? labels.unfavorite || "Remove favorite"
                : labels.favorite || "Favorite"
            }
            title={
              prompt.isFavorite
                ? labels.unfavorite || "Remove favorite"
                : labels.favorite || "Favorite"
            }
          >
            {prompt.isFavorite ? "★" : "☆"}
          </button>
        )}
        {onEdit && (
          <button
            type="button"
            className="prompt-library-row__edit"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(prompt);
            }}
          >
            {labels.edit || "Edit"}
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            className="prompt-library-row__delete"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(prompt);
            }}
          >
            {labels.delete || "Delete"}
          </button>
        )}
      </div>
    </article>
  );
}
