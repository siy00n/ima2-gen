import { useAppStore } from "../store/useAppStore";
import { BillingBar } from "./BillingBar";
import { OptionGroup } from "./OptionGroup";
import { SizePicker } from "./SizePicker";
import { CostEstimate } from "./CostEstimate";
import { ProviderSelect } from "./ProviderSelect";
import { NodeInspector } from "./NodeInspector";
import type { Count, Format, ImageModel, Moderation, Quality } from "../types";
import { useI18n } from "../i18n";
import { useIsMobile } from "../hooks/useIsMobile";

const FORMAT_ITEMS = [
  { value: "png" as const, label: "PNG" },
  { value: "jpeg" as const, label: "JPEG" },
  { value: "webp" as const, label: "WebP" },
];

const COUNT_ITEMS: { value: string; label: string }[] = [
  { value: "1", label: "1" },
  { value: "2", label: "2" },
  { value: "4", label: "4" },
];

export function RightPanel() {
  const open = useAppStore((s) => s.rightPanelOpen);
  const setOpen = useAppStore((s) => s.setRightPanelOpen);
  const toggle = useAppStore((s) => s.toggleRightPanel);
  const uiMode = useAppStore((s) => s.uiMode);
  const { t } = useI18n();
  const isMobile = useIsMobile();

  const drawerOpen = isMobile ? open : true;

  const model = useAppStore((s) => s.model);
  const setModel = useAppStore((s) => s.setModel);
  const quality = useAppStore((s) => s.quality);
  const setQuality = useAppStore((s) => s.setQuality);
  const format = useAppStore((s) => s.format);
  const setFormat = useAppStore((s) => s.setFormat);
  const moderation = useAppStore((s) => s.moderation);
  const setModeration = useAppStore((s) => s.setModeration);
  const count = useAppStore((s) => s.count);
  const setCount = useAppStore((s) => s.setCount);

  const QUALITY_ITEMS = [
    { value: "low" as const, label: t("quality.lowLabel"), sub: t("quality.lowSub") },
    { value: "medium" as const, label: t("quality.mediumLabel"), sub: t("quality.mediumSub") },
    { value: "high" as const, label: t("quality.highLabel"), sub: t("quality.highSub") },
  ];

  const MODEL_ITEMS = [
    { value: "gpt-5.4-mini" as const, label: "5.4 Mini", sub: t("model.fast") },
    { value: "gpt-5.4" as const, label: "5.4", sub: t("model.balanced") },
    { value: "gpt-5.5" as const, label: "5.5", sub: t("model.best") },
  ];

  const MOD_ITEMS = [
    { value: "auto" as const, label: t("moderation.autoLabel"), sub: t("moderation.autoSub") },
    {
      value: "low" as const,
      label: t("moderation.lowLabel"),
      sub: t("moderation.lowSub"),
      color: "var(--amber)",
    },
  ];

  return (
    <>
      {isMobile && open ? (
        <div
          className="right-panel-backdrop"
          role="button"
          aria-label={t("panel.closeSettings")}
          onClick={() => setOpen(false)}
        />
      ) : null}
      <aside
        className={`right-panel${uiMode === "node" ? " right-panel--node" : ""}${open ? "" : " collapsed"}${isMobile && drawerOpen ? " drawer-open" : ""}`}
        aria-label={t("panel.detailSettings")}
      >
        <button
          type="button"
          className="right-panel-toggle"
          aria-expanded={open}
          aria-controls="right-panel-body"
          onClick={() => (isMobile ? setOpen(false) : toggle())}
          title={open ? t("panel.toggleHide") : t("panel.toggleShow")}
        >
          {isMobile ? (open ? t("panel.close") : t("panel.open")) : open ? ">" : "<"}
        </button>
        <div
          id="right-panel-body"
          className="right-panel-body"
          hidden={!open}
        >
          <BillingBar />
          {uiMode === "node" ? (
            <NodeInspector />
          ) : (
            <>
              {isMobile ? <ProviderSelect /> : null}
              <div className="section-title">{t("panel.detailSettings")}</div>
              <OptionGroup<ImageModel>
                title={t("model.title")}
                items={MODEL_ITEMS}
                value={model}
                onChange={setModel}
              />
              <OptionGroup<Quality>
                title={t("quality.title")}
                items={QUALITY_ITEMS}
                value={quality}
                onChange={setQuality}
              />
              <SizePicker />
              <OptionGroup<Format>
                title={t("format.title")}
                items={FORMAT_ITEMS}
                value={format}
                onChange={setFormat}
              />
              <OptionGroup<Moderation>
                title={t("moderation.title")}
                items={MOD_ITEMS}
                value={moderation}
                onChange={setModeration}
              />
              <p className="option-help">
                {t("moderation.explain")}
              </p>
              {uiMode === "classic" ? (
                <OptionGroup<string>
                  title={t("count.title")}
                  items={COUNT_ITEMS}
                  value={String(count)}
                  onChange={(v) => setCount(Number(v) as Count)}
                />
              ) : null}
              <CostEstimate />
            </>
          )}
        </div>
      </aside>
    </>
  );
}
