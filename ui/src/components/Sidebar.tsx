import { useEffect, useState } from "react";
import { UIModeSwitch } from "./UIModeSwitch";
import { PromptComposer } from "./PromptComposer";
import { GenerateButton } from "./GenerateButton";
import { InFlightList } from "./InFlightList";
import { SidebarPromptLibrary, type SidebarWorkspaceTab } from "./SidebarPromptLibrary";
import { HistoryStrip } from "./HistoryStrip";
import { SessionPicker } from "./SessionPicker";
import { LanguageToggle } from "./LanguageToggle";
import { useAppStore } from "../store/useAppStore";
import { useI18n } from "../i18n";
import { useIsMobile } from "../hooks/useIsMobile";

export function Sidebar() {
  const { t } = useI18n();
  const uiMode = useAppStore((s) => s.uiMode);
  const setUIMode = useAppStore((s) => s.setUIMode);
  const currentImage = useAppStore((s) => s.currentImage);
  const prompt = useAppStore((s) => s.prompt);
  const inFlight = useAppStore((s) => s.inFlight);
  const openGallery = useAppStore((s) => s.openGallery);
  const openPromptLibrary = useAppStore((s) => s.openPromptLibrary);
  const classicSidebarCollapsed = useAppStore((s) => s.classicSidebarCollapsed);
  const setClassicSidebarCollapsed = useAppStore((s) => s.setClassicSidebarCollapsed);
  const isMobile = useIsMobile();
  const [composerOpen, setComposerOpen] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState<SidebarWorkspaceTab>("library");
  const hasMobileResult = isMobile && uiMode === "classic" && !!currentImage;
  const collapsed = hasMobileResult && !composerOpen;
  const isClassicDesktop = uiMode === "classic" && !isMobile;

  useEffect(() => {
    if (hasMobileResult) setComposerOpen(false);
  }, [hasMobileResult, currentImage?.filename, currentImage?.image]);

  const promptPreview =
    prompt.trim() || currentImage?.prompt || t("prompt.openComposer");

  if (isClassicDesktop && classicSidebarCollapsed) {
    return (
      <aside className="sidebar sidebar--classic-rail" aria-label={t("sidebar.classicWorkspace")}>
        <button
          type="button"
          className="classic-rail__brand"
          onClick={() => setClassicSidebarCollapsed(false)}
          title={t("sidebar.expandClassic")}
          aria-label={t("sidebar.expandClassic")}
        >
          <span className="logo-mark" aria-hidden="true" />
        </button>
        <nav className="classic-rail__nav" aria-label={t("uiMode.ariaLabel")}>
          <button
            type="button"
            className="classic-rail__button active"
            title={t("uiMode.classic")}
            aria-label={t("uiMode.classic")}
          >
            C
          </button>
          <button
            type="button"
            className="classic-rail__button"
            onClick={() => setUIMode("node")}
            title={t("uiMode.node")}
            aria-label={t("uiMode.node")}
          >
            N
          </button>
        </nav>
        <nav className="classic-rail__nav classic-rail__nav--main" aria-label={t("sidebar.classicWorkspace")}>
          <button
            type="button"
            className="classic-rail__button"
            onClick={() => {
              setWorkspaceTab("library");
              setClassicSidebarCollapsed(false);
            }}
            title={t("sidebar.railLibrary")}
            aria-label={t("sidebar.railLibrary")}
          >
            Lib
          </button>
          <button
            type="button"
            className="classic-rail__button"
            onClick={() => {
              setWorkspaceTab("activity");
              setClassicSidebarCollapsed(false);
            }}
            title={t("sidebar.railActivity")}
            aria-label={t("sidebar.railActivity")}
          >
            Act
            {inFlight.length > 0 ? <span className="classic-rail__badge">{inFlight.length}</span> : null}
          </button>
          <button
            type="button"
            className="classic-rail__button"
            onClick={openGallery}
            title={t("history.openGalleryTitle")}
            aria-label={t("history.openGalleryAria")}
          >
            Gal
          </button>
          <button
            type="button"
            className="classic-rail__button"
            onClick={() => void openPromptLibrary()}
            title={t("promptLibrary.open")}
            aria-label={t("promptLibrary.open")}
          >
            +
          </button>
        </nav>
        <button
          type="button"
          className="classic-rail__button classic-rail__expand"
          onClick={() => setClassicSidebarCollapsed(false)}
          title={t("sidebar.expandClassic")}
          aria-label={t("sidebar.expandClassic")}
        >
          ›
        </button>
      </aside>
    );
  }

  return (
    <aside
      className={`sidebar${isClassicDesktop ? " sidebar--classic-expanded" : ""}${isMobile && uiMode === "classic" ? " sidebar--mobile-composer" : ""}${collapsed ? " sidebar--prompt-collapsed" : ""}`}
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
            {!isMobile ? (
              <>
                <button
                  type="button"
                  className="classic-sidebar-collapse"
                  onClick={() => setClassicSidebarCollapsed(true)}
                >
                  {t("sidebar.collapseClassic")}
                </button>
                <SidebarPromptLibrary tab={workspaceTab} onTabChange={setWorkspaceTab} />
              </>
            ) : (
              <>
                <PromptComposer />
                <GenerateButton />
                <InFlightList />
              </>
            )}
          </>
        ) : (
          <>
            <SessionPicker />
            <div className="sidebar__node-hint">
              {t("sidebar.nodeModeHint")}
            </div>
            {isMobile ? <InFlightList /> : <SidebarPromptLibrary />}
          </>
        )}
      </div>
      <HistoryStrip />
    </aside>
  );
}
