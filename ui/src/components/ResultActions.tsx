import { useAppStore } from "../store/useAppStore";
import { useI18n } from "../i18n";
import { copyImageToClipboard, copyTextToClipboard } from "../lib/clipboard";
import { useIsMobile } from "../hooks/useIsMobile";

function ResultActionIcon({ type }: { type: "continue" | "copyImage" | "download" | "copyPrompt" }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (type === "continue") {
    return (
      <svg {...common}>
        <path d="M5 12h11" />
        <path d="m12 6 6 6-6 6" />
      </svg>
    );
  }
  if (type === "copyImage") {
    return (
      <svg {...common}>
        <rect x="8" y="8" width="11" height="11" rx="2" />
        <path d="M5 15V7a2 2 0 0 1 2-2h8" />
        <path d="m10.5 16 2.2-2.4 1.7 1.7 2.1-2.8 2 3.5" />
      </svg>
    );
  }
  if (type === "download") {
    return (
      <svg {...common}>
        <path d="M12 4v10" />
        <path d="m8 10 4 4 4-4" />
        <path d="M5 20h14" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="8" y="8" width="11" height="11" rx="2" />
      <path d="M5 15V7a2 2 0 0 1 2-2h8" />
      <path d="M11 12h5M11 15h4" />
    </svg>
  );
}

export function ResultActions() {
  const { t } = useI18n();
  const currentImage = useAppStore((s) => s.currentImage);
  const showToast = useAppStore((s) => s.showToast);
  const setPrompt = useAppStore((s) => s.setPrompt);
  const importCurrentImageAsNode = useAppStore((s) => s.importCurrentImageAsNode);
  const isMobile = useIsMobile();

  if (!currentImage) return null;

  const download = () => {
    const a = document.createElement("a");
    a.href = currentImage.image;
    a.download = currentImage.filename || "generated.png";
    a.click();
  };

  const copyImage = async () => {
    try {
      await copyImageToClipboard(currentImage.url ?? currentImage.image);
      showToast(t("toast.imageCopied"));
    } catch (err) {
      const key =
        err instanceof Error && err.message === "image-copy-requires-https"
          ? "toast.imageCopyNeedsHttps"
          : "toast.copyFailed";
      showToast(t(key), true);
    }
  };

  const copyPrompt = async () => {
    if (!currentImage.prompt) return;
    try {
      await copyTextToClipboard(currentImage.prompt);
      showToast(t("toast.promptCopied"));
    } catch {
      showToast(t("toast.copyFailed"), true);
    }
  };

  const newFromHere = () => {
    if (!currentImage.prompt) {
      showToast(t("toast.noPromptToFork"), true);
      return;
    }
    setPrompt(currentImage.prompt);
    const promptEl = document.querySelector<HTMLTextAreaElement>(
      'textarea[name="prompt"], textarea#prompt, .sidebar textarea',
    );
    if (promptEl) {
      promptEl.focus();
      promptEl.setSelectionRange(promptEl.value.length, promptEl.value.length);
    }
    showToast(t("toast.forkStarted"));
  };

  if (isMobile) {
    return (
      <div className="result-actions result-actions--mobile">
        <button
          type="button"
          className="action-btn action-btn--primary result-actions__primary"
          onClick={newFromHere}
          title={t("result.continueHereTitle")}
          aria-label={t("result.continueHere")}
        >
          <ResultActionIcon type="continue" />
          <span>{t("result.continueHere")}</span>
        </button>
        <div
          className="result-actions__secondary"
          aria-label={`${t("result.copyImage")} / ${t("result.download")} / ${t("result.copyPrompt")}`}
        >
          <button
            type="button"
            className="action-btn result-actions__secondary-btn"
            onClick={copyImage}
            aria-label={t("result.copyImage")}
            title={t("result.copyImage")}
          >
            <ResultActionIcon type="copyImage" />
            <span>{t("result.copyImage")}</span>
          </button>
          <button
            type="button"
            className="action-btn result-actions__secondary-btn"
            onClick={download}
            aria-label={t("result.download")}
            title={t("result.download")}
          >
            <ResultActionIcon type="download" />
            <span>{t("result.download")}</span>
          </button>
          <button
            type="button"
            className="action-btn result-actions__secondary-btn"
            onClick={() => void copyPrompt()}
            aria-label={t("result.copyPrompt")}
            title={t("result.copyPrompt")}
          >
            <ResultActionIcon type="copyPrompt" />
            <span>{t("result.copyPrompt")}</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="result-actions">
      <button type="button" className="action-btn" onClick={download}>
        {t("result.download")}
      </button>
      <button type="button" className="action-btn" onClick={copyImage}>
        {t("result.copyImage")}
      </button>
      <button type="button" className="action-btn" onClick={() => void copyPrompt()}>
        {t("result.copyPrompt")}
      </button>
      <button
        type="button"
        className="action-btn action-btn--primary"
        onClick={newFromHere}
        title={t("result.continueHereTitle")}
      >
        {t("result.continueHere")}
      </button>
      {!isMobile ? (
        <button
          type="button"
          className="action-btn"
          onClick={() => void importCurrentImageAsNode()}
          disabled={!currentImage.filename}
          title={t("result.openInNodeTitle")}
        >
          {t("result.openInNode")}
        </button>
      ) : null}
    </div>
  );
}
