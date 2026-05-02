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

type RailIconType = "brand" | "classic" | "node" | "library" | "activity" | "gallery" | "settings" | "close";

function RailIcon({ type }: { type: RailIconType }) {
  if (type === "brand") return <span className="logo-mark" aria-hidden="true" />;
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (type === "classic") {
    return <svg {...common}><rect x="4" y="5" width="16" height="14" rx="3" /><path d="M8 9h8M8 13h5" /></svg>;
  }
  if (type === "node") {
    return <svg {...common}><circle cx="6" cy="12" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="18" cy="18" r="2" /><path d="M8 12h4M12 12l4-6M12 12l4 6" /></svg>;
  }
  if (type === "library") {
    return <svg {...common}><path d="M5 5h10a4 4 0 0 1 4 4v10H9a4 4 0 0 0-4 4V5Z" /><path d="M9 9h6M9 13h5" /></svg>;
  }
  if (type === "activity") {
    return <svg {...common}><path d="M4 13h4l2-7 4 12 2-5h4" /></svg>;
  }
  if (type === "gallery") {
    return <svg {...common}><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></svg>;
  }
  if (type === "settings") {
    return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M2 12h3M19 12h3M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12" /></svg>;
  }
  return <svg {...common}><path d="M18 6 6 18M6 6l12 12" /></svg>;
}

export function Sidebar() {
  const { t } = useI18n();
  const uiMode = useAppStore((s) => s.uiMode);
  const setUIMode = useAppStore((s) => s.setUIMode);
  const currentImage = useAppStore((s) => s.currentImage);
  const prompt = useAppStore((s) => s.prompt);
  const inFlight = useAppStore((s) => s.inFlight);
  const openGallery = useAppStore((s) => s.openGallery);
  const setRightPanelOpen = useAppStore((s) => s.setRightPanelOpen);
  const classicRailDrawer = useAppStore((s) => s.classicRailDrawer);
  const setClassicRailDrawer = useAppStore((s) => s.setClassicRailDrawer);
  const isMobile = useIsMobile();
  const [composerOpen, setComposerOpen] = useState(false);
  const hasMobileResult = isMobile && uiMode === "classic" && !!currentImage;
  const collapsed = hasMobileResult && !composerOpen;
  const isClassicDesktop = uiMode === "classic" && !isMobile;
  const showModeSwitch = !(isMobile && uiMode === "classic");

  useEffect(() => {
    if (hasMobileResult) setComposerOpen(false);
  }, [hasMobileResult, currentImage?.filename, currentImage?.image]);

  const promptPreview =
    prompt.trim() || currentImage?.prompt || t("prompt.openComposer");

  useEffect(() => {
    if (!isClassicDesktop && classicRailDrawer) setClassicRailDrawer(null);
  }, [classicRailDrawer, isClassicDesktop, setClassicRailDrawer]);

  useEffect(() => {
    if (!isClassicDesktop || !classicRailDrawer) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setClassicRailDrawer(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [classicRailDrawer, isClassicDesktop, setClassicRailDrawer]);

  if (isClassicDesktop) {
    const toggleDrawer = (drawer: SidebarWorkspaceTab) => {
      setClassicRailDrawer(classicRailDrawer === drawer ? null : drawer);
    };
    return (
      <aside className="sidebar sidebar--classic-rail" aria-label={t("sidebar.classicWorkspace")}>
        <div className="classic-rail__brand" title="ima2-gen" aria-label="ima2-gen">
          <RailIcon type="brand" />
        </div>
        <nav className="classic-rail__nav" aria-label={t("uiMode.ariaLabel")}>
          <button
            type="button"
            className="classic-rail__button active"
            title={t("uiMode.classic")}
            aria-label={t("uiMode.classic")}
          >
            <RailIcon type="classic" />
          </button>
          <button
            type="button"
            className="classic-rail__button"
            onClick={() => setUIMode("node")}
            title={t("uiMode.node")}
            aria-label={t("uiMode.node")}
          >
            <RailIcon type="node" />
          </button>
        </nav>
        <nav className="classic-rail__nav classic-rail__nav--main" aria-label={t("sidebar.classicWorkspace")}>
          <button
            type="button"
            className={`classic-rail__button${classicRailDrawer === "library" ? " active" : ""}`}
            onClick={() => toggleDrawer("library")}
            title={t("sidebar.railLibrary")}
            aria-label={t("sidebar.railLibrary")}
          >
            <RailIcon type="library" />
          </button>
          <button
            type="button"
            className={`classic-rail__button${classicRailDrawer === "activity" ? " active" : ""}`}
            onClick={() => toggleDrawer("activity")}
            title={t("sidebar.railActivity")}
            aria-label={t("sidebar.railActivity")}
          >
            <RailIcon type="activity" />
            {inFlight.length > 0 ? <span className="classic-rail__badge">{inFlight.length}</span> : null}
          </button>
          <button
            type="button"
            className="classic-rail__button"
            onClick={openGallery}
            title={t("history.openGalleryTitle")}
            aria-label={t("history.openGalleryAria")}
          >
            <RailIcon type="gallery" />
          </button>
        </nav>
        <button
          type="button"
          className="classic-rail__button classic-rail__expand"
          onClick={() => setRightPanelOpen(true)}
          title={t("panel.detailSettings")}
          aria-label={t("panel.detailSettings")}
        >
          <RailIcon type="settings" />
        </button>
        {classicRailDrawer ? (
          <>
            <button
              type="button"
              className="classic-rail-drawer__scrim"
              onClick={() => setClassicRailDrawer(null)}
              aria-label={t("sidebar.closeDrawer")}
            />
            <div className="classic-rail-drawer">
              <div className="classic-rail-drawer__header">
                <div>
                  <div className="classic-rail-drawer__eyebrow">ima2-gen</div>
                  <h2>{classicRailDrawer === "library" ? t("promptLibrary.short") : t("promptLibrary.activity")}</h2>
                </div>
                <button
                  type="button"
                  className="classic-rail-drawer__close"
                  onClick={() => setClassicRailDrawer(null)}
                  title={t("sidebar.closeDrawer")}
                  aria-label={t("sidebar.closeDrawer")}
                >
                  <RailIcon type="close" />
                </button>
              </div>
              <SidebarPromptLibrary
                tab={classicRailDrawer}
                onTabChange={setClassicRailDrawer}
                compactTabs
              />
            </div>
          </>
        ) : null}
      </aside>
    );
  }

  return (
    <aside
      className={`sidebar${isClassicDesktop ? " sidebar--classic-expanded" : ""}${isMobile && uiMode === "classic" ? " sidebar--mobile-composer" : ""}${isMobile && uiMode === "node" ? " sidebar--mobile-node" : ""}${hasMobileResult ? " sidebar--mobile-result" : ""}${collapsed ? " sidebar--prompt-collapsed" : ""}`}
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
            aria-label={t("prompt.collapseComposer")}
            title={t("prompt.collapseComposer")}
          >
            <span aria-hidden="true">⌄</span>
          </button>
        ) : null}
        {showModeSwitch ? <UIModeSwitch /> : null}
        {uiMode === "classic" ? (
          <>
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
            {isMobile ? <InFlightList /> : <SidebarPromptLibrary />}
          </>
        )}
      </div>
      <HistoryStrip />
    </aside>
  );
}
