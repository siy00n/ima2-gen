import { useAppStore } from "../store/useAppStore";
import { useI18n } from "../i18n";
import { copyImageToClipboard, copyTextToClipboard } from "../lib/clipboard";

export function ResultActions() {
  const { t } = useI18n();
  const currentImage = useAppStore((s) => s.currentImage);
  const showToast = useAppStore((s) => s.showToast);
  const setPrompt = useAppStore((s) => s.setPrompt);

  if (!currentImage) return null;

  const download = () => {
    const a = document.createElement("a");
    a.href = currentImage.image;
    a.download = currentImage.filename || "generated.png";
    a.click();
  };

  const copyImage = async () => {
    try {
      const copied = await copyImageToClipboard(currentImage.url ?? currentImage.image);
      showToast(copied === "image" ? t("toast.imageCopied") : t("toast.imageLinkCopied"));
    } catch {
      showToast(t("toast.copyFailed"), true);
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
    </div>
  );
}
