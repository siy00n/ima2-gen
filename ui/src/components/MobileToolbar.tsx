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

export function MobileToolbar() {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const openGallery = useAppStore((s) => s.openGallery);
  const provider = useAppStore((s) => s.provider);
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
          <div className="mobile-toolbar__title">ima2-gen</div>
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
        <LanguageToggle />
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
      </div>
    </header>
  );
}
