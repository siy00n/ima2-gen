import { useEffect, useState } from "react";
import { ProviderSelect } from "./ProviderSelect";
import { UIModeSwitch } from "./UIModeSwitch";
import { PromptComposer } from "./PromptComposer";
import { GenerateButton } from "./GenerateButton";
import { InFlightList } from "./InFlightList";
import { HistoryStrip } from "./HistoryStrip";
import { SessionPicker } from "./SessionPicker";
import { LanguageToggle } from "./LanguageToggle";
import { useAppStore } from "../store/useAppStore";
import { IS_DEV_UI } from "../lib/devMode";
import { useI18n } from "../i18n";
import { useIsMobile } from "../hooks/useIsMobile";

export function Sidebar() {
  const { t } = useI18n();
  const uiModeRaw = useAppStore((s) => s.uiMode);
  const currentImage = useAppStore((s) => s.currentImage);
  const prompt = useAppStore((s) => s.prompt);
  const uiMode = IS_DEV_UI ? uiModeRaw : "classic";
  const isMobile = useIsMobile();
  const [composerOpen, setComposerOpen] = useState(false);
  const hasMobileResult = isMobile && uiMode === "classic" && !!currentImage;
  const collapsed = hasMobileResult && !composerOpen;

  useEffect(() => {
    if (hasMobileResult) setComposerOpen(false);
  }, [hasMobileResult, currentImage?.filename, currentImage?.image]);

  const promptPreview =
    prompt.trim() || currentImage?.prompt || t("prompt.openComposer");

  return (
    <aside
      className={`sidebar${isMobile && uiMode === "classic" ? " sidebar--mobile-composer" : ""}${collapsed ? " sidebar--prompt-collapsed" : ""}`}
    >
      {collapsed ? (
        <button
          type="button"
          className="mobile-prompt-peek"
          onClick={() => setComposerOpen(true)}
          aria-expanded={false}
        >
          <span className="mobile-prompt-peek__label">{t("prompt.label")}</span>
          <span className="mobile-prompt-peek__text">{promptPreview}</span>
          <span className="mobile-prompt-peek__chevron" aria-hidden="true">⌃</span>
        </button>
      ) : null}
      <div className="sidebar__scroll">
        <div className="logo">
          <div className="logo-mark" aria-hidden="true" />
          <div className="logo-copy">
            <div className="logo-title">ima2-gen</div>
            <div className="logo-subtitle">gpt-image-2 studio</div>
          </div>
          <LanguageToggle />
        </div>
        {hasMobileResult ? (
          <button
            type="button"
            className="mobile-dock-dismiss"
            onClick={() => setComposerOpen(false)}
            aria-expanded={true}
          >
            {t("prompt.collapseComposer")}
          </button>
        ) : null}
        <UIModeSwitch />
        {uiMode === "classic" ? (
          <>
            {!isMobile ? <ProviderSelect /> : null}
            <PromptComposer />
            <GenerateButton />
            <InFlightList />
          </>
        ) : (
          <>
            <SessionPicker />
            <div className="sidebar__node-hint">
              {t("sidebar.nodeModeHint")}
            </div>
            <InFlightList />
          </>
        )}
      </div>
      <HistoryStrip />
    </aside>
  );
}
