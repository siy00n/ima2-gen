import { useAppStore, type ImageNodeData } from "../store/useAppStore";
import { useI18n } from "../i18n";
import { copyImageToClipboard, copyTextToClipboard } from "../lib/clipboard";

function isBusy(data: ImageNodeData): boolean {
  return data.status === "pending" || data.status === "reconciling";
}

export function NodeInspector() {
  const { t } = useI18n();
  const nodes = useAppStore((s) => s.graphNodes);
  const selectedNodeId = useAppStore((s) => s.selectedNodeId);
  const selectNode = useAppStore((s) => s.selectNode);
  const addRootNode = useAppStore((s) => s.addRootNode);
  const addChildNode = useAppStore((s) => s.addChildNode);
  const duplicateBranchRoot = useAppStore((s) => s.duplicateBranchRoot);
  const updateNodePrompt = useAppStore((s) => s.updateNodePrompt);
  const generateNode = useAppStore((s) => s.generateNode);
  const deleteNode = useAppStore((s) => s.deleteNode);
  const importCurrentImageAsNode = useAppStore((s) => s.importCurrentImageAsNode);
  const currentImage = useAppStore((s) => s.currentImage);
  const showToast = useAppStore((s) => s.showToast);

  const selected = selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) : null;
  const data = selected?.data;

  const importCurrent = () => {
    void importCurrentImageAsNode();
  };

  if (!selected || !data) {
    return (
      <div className="node-inspector node-inspector--empty">
        <div className="section-title">{t("nodeInspector.title")}</div>
        <p className="node-inspector__empty">{t("nodeInspector.noSelection")}</p>
        <button
          type="button"
          className="node-inspector__primary"
          onClick={() => selectNode(addRootNode())}
        >
          {t("nodeCanvas.addFirst")}
        </button>
        <button
          type="button"
          className="node-inspector__button"
          onClick={importCurrent}
          disabled={!currentImage?.filename}
        >
          {t("nodeInspector.importCurrent")}
        </button>
      </div>
    );
  }

  const busy = isBusy(data);
  const canBranch = data.status === "ready" && !!data.serverNodeId;
  const canGenerate = !busy && data.prompt.trim().length > 0;
  const imageSrc = data.imageUrl ?? null;

  const download = () => {
    if (!imageSrc) return;
    const a = document.createElement("a");
    a.href = imageSrc;
    a.download = data.filename || `${data.serverNodeId ?? selected.id}.png`;
    a.click();
  };

  const copyImage = async () => {
    if (!imageSrc) return;
    try {
      await copyImageToClipboard(imageSrc);
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
    if (!data.prompt) return;
    try {
      await copyTextToClipboard(data.prompt);
      showToast(t("toast.promptCopied"));
    } catch {
      showToast(t("toast.copyFailed"), true);
    }
  };

  const generateLabel =
    data.status === "ready"
      ? t("nodeInspector.createVariation")
      : data.status === "error" || data.status === "stale" || data.status === "asset-missing"
        ? t("node.retry")
        : t("node.generate");

  const meta = [
    data.status ? t("nodeInspector.statusValue", { value: data.status }) : null,
    data.elapsed != null ? `${data.elapsed}s` : null,
    data.quality ?? null,
    data.size ?? null,
    data.provider ?? null,
  ].filter((v): v is string => Boolean(v));

  return (
    <div className="node-inspector">
      <div className="section-title">{t("nodeInspector.title")}</div>
      <div className="node-inspector__preview">
        {imageSrc ? (
          <img src={imageSrc} alt={t("node.nodeImageAlt")} />
        ) : (
          <div className="node-inspector__placeholder">{t("node.noImage")}</div>
        )}
      </div>
      <textarea
        className="node-inspector__prompt"
        value={data.prompt}
        disabled={busy}
        onChange={(e) => updateNodePrompt(selected.id, e.target.value)}
        placeholder={data.parentServerNodeId ? t("node.editPromptPlaceholder") : t("node.promptPlaceholder")}
        rows={5}
      />
      {data.error ? <div className="node-inspector__error">{data.error}</div> : null}
      <div className="node-inspector__meta">{meta.join(" · ")}</div>
      <div className="node-inspector__actions">
        <button
          type="button"
          className="node-inspector__primary"
          onClick={() => void generateNode(selected.id)}
          disabled={!canGenerate}
        >
          {generateLabel}
        </button>
        <button type="button" className="node-inspector__button" onClick={() => addChildNode(selected.id)} disabled={!canBranch}>
          {t("node.addChild")}
        </button>
        <button type="button" className="node-inspector__button" onClick={() => duplicateBranchRoot(selected.id)}>
          {t("node.duplicateBranch")}
        </button>
        <button type="button" className="node-inspector__button" onClick={download} disabled={!imageSrc}>
          {t("result.download")}
        </button>
        <button type="button" className="node-inspector__button" onClick={() => void copyImage()} disabled={!imageSrc}>
          {t("result.copyImage")}
        </button>
        <button type="button" className="node-inspector__button" onClick={() => void copyPrompt()} disabled={!data.prompt}>
          {t("result.copyPrompt")}
        </button>
        <button
          type="button"
          className="node-inspector__danger"
          onClick={() => {
            deleteNode(selected.id);
            selectNode(null);
          }}
        >
          {t("common.delete")}
        </button>
      </div>
    </div>
  );
}
