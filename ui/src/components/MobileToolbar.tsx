import { LanguageToggle } from "./LanguageToggle";
import { useAppStore } from "../store/useAppStore";
import { useIsMobile } from "../hooks/useIsMobile";
import { useProviderAvailability } from "../hooks/useProviderAvailability";
import { useI18n } from "../i18n";

function SettingsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 7h16M7 7v10M4 17h16M17 7v10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function GalleryIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function NodeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="6" cy="12" r="2.2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="18" cy="6" r="2.2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="18" cy="18" r="2.2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8.2 12h3.5M12 11.8 16 7M12 12.2 16 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function LibraryIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 5h10a4 4 0 0 1 4 4v10H9a4 4 0 0 0-4 4V5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M9 9h6M9 13h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function MobileToolbar() {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const openGallery = useAppStore((s) => s.openGallery);
  const openPromptLibrary = useAppStore((s) => s.openPromptLibrary);
  const provider = useAppStore((s) => s.provider);
  const setUIMode = useAppStore((s) => s.setUIMode);
  const setRightPanelOpen = useAppStore((s) => s.setRightPanelOpen);
  const availability = useProviderAvailability();
  const providerLabel = provider === "oauth" ? "OAuth" : t("provider.apiLabel");
  const providerOk = availability[provider].ok;

  if (!isMobile) return null;

  return (
    <header className="mobile-toolbar" aria-label={t("sidebar.appName")}>
      <div className="mobile-toolbar__brand">
        <div className="logo-mark" aria-hidden="true" />
        <div className="mobile-toolbar__copy">
          <div className="mobile-toolbar__title">{t("uiMode.classic")}</div>
          <div className="mobile-toolbar__subtitle">
            <span
              className={`status-dot ${providerOk ? "status-dot--ok" : "status-dot--bad"}`}
              title={providerOk ? t("provider.availableTitle", { name: providerLabel }) : availability[provider].reason}
              aria-hidden="true"
            />
            <span>{providerLabel}</span>
          </div>
        </div>
      </div>
      <div className="mobile-toolbar__actions">
        <button
          type="button"
          className="mobile-toolbar__icon-btn"
          onClick={() => setUIMode("node")}
          aria-label={t("uiMode.node")}
          title={t("uiMode.node")}
        >
          <NodeIcon />
        </button>
        <button
          type="button"
          className="mobile-toolbar__icon-btn"
          onClick={() => void openPromptLibrary()}
          aria-label={t("promptLibrary.open")}
          title={t("promptLibrary.open")}
        >
          <LibraryIcon />
        </button>
        <button
          type="button"
          className="mobile-toolbar__icon-btn"
          onClick={openGallery}
          aria-label={t("history.openGalleryAria")}
          title={t("history.openGalleryTitle")}
        >
          <GalleryIcon />
        </button>
        <button
          type="button"
          className="mobile-toolbar__icon-btn"
          onClick={() => setRightPanelOpen(true)}
          aria-label={t("panel.toggleShow")}
          title={t("panel.toggleShow")}
        >
          <SettingsIcon />
        </button>
        <LanguageToggle />
      </div>
    </header>
  );
}
