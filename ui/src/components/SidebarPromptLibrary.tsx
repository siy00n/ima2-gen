import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { useI18n } from "../i18n";
import { InFlightList } from "./InFlightList";

export type SidebarWorkspaceTab = "library" | "activity";

type SidebarPromptLibraryProps = {
  tab?: SidebarWorkspaceTab;
  defaultTab?: SidebarWorkspaceTab;
  onTabChange?: (tab: SidebarWorkspaceTab) => void;
};

function compactPrompt(text: string, max = 74) {
  const oneLine = text.trim().replace(/\s+/g, " ");
  return oneLine.length > max ? `${oneLine.slice(0, max)}...` : oneLine;
}

export function SidebarPromptLibrary({
  tab: controlledTab,
  defaultTab = "library",
  onTabChange,
}: SidebarPromptLibraryProps = {}) {
  const { t } = useI18n();
  const [internalTab, setInternalTab] = useState<SidebarWorkspaceTab>(defaultTab);
  const tab = controlledTab ?? internalTab;
  const setTab = (next: SidebarWorkspaceTab) => {
    if (controlledTab === undefined) setInternalTab(next);
    onTabChange?.(next);
  };
  const uiMode = useAppStore((s) => s.uiMode);
  const selectedNodeId = useAppStore((s) => s.selectedNodeId);
  const promptLibraryItems = useAppStore((s) => s.promptLibraryItems);
  const promptLibraryLoading = useAppStore((s) => s.promptLibraryLoading);
  const promptLibraryError = useAppStore((s) => s.promptLibraryError);
  const promptLibraryLastSavedId = useAppStore((s) => s.promptLibraryLastSavedId);
  const refreshPromptLibrary = useAppStore((s) => s.refreshPromptLibrary);
  const openPromptLibrary = useAppStore((s) => s.openPromptLibrary);
  const insertPromptLibraryItem = useAppStore((s) => s.insertPromptLibraryItem);
  const inFlight = useAppStore((s) => s.inFlight);
  const requestedInitialLoad = useRef(false);

  useEffect(() => {
    if (!requestedInitialLoad.current && promptLibraryItems.length === 0 && !promptLibraryLoading) {
      requestedInitialLoad.current = true;
      void refreshPromptLibrary();
    }
  }, [promptLibraryItems.length, promptLibraryLoading, refreshPromptLibrary]);

  const quickItems = useMemo(() => {
    return [...promptLibraryItems]
      .sort((a, b) => {
        if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
        return b.updatedAt - a.updatedAt;
      })
      .slice(0, 5);
  }, [promptLibraryItems]);

  const needsNode = uiMode === "node" && !selectedNodeId;

  return (
    <section className="sidebar-workspace" aria-label={t("promptLibrary.workspace")}>
      <div className="sidebar-workspace__tabs" role="tablist">
        <button
          type="button"
          className={tab === "library" ? "is-active" : ""}
          onClick={() => setTab("library")}
        >
          {t("promptLibrary.short")}
        </button>
        <button
          type="button"
          className={tab === "activity" ? "is-active" : ""}
          onClick={() => setTab("activity")}
        >
          <span>{t("promptLibrary.activity")}</span>
          {inFlight.length > 0 ? (
            <span className="sidebar-workspace__badge">{inFlight.length}</span>
          ) : null}
        </button>
      </div>

      {tab === "activity" ? (
        <div className="sidebar-workspace__activity">
          {inFlight.length > 0 ? (
            <InFlightList />
          ) : (
            <div className="sidebar-workspace__empty">{t("promptLibrary.noActivity")}</div>
          )}
        </div>
      ) : (
        <div className="mini-library">
          <div className="mini-library__header">
            <span>{t("promptLibrary.quickTitle")}</span>
            <button type="button" onClick={() => void openPromptLibrary()}>
              {t("promptLibrary.openFull")}
            </button>
          </div>
          {needsNode ? (
            <div className="mini-library__notice">{t("promptLibrary.selectNodeFirst")}</div>
          ) : null}
          {promptLibraryError ? (
            <div className="mini-library__notice mini-library__notice--error">
              {promptLibraryError}
            </div>
          ) : null}
          {promptLibraryLoading && quickItems.length === 0 ? (
            <div className="mini-library__empty">{t("promptLibrary.loading")}</div>
          ) : quickItems.length === 0 ? (
            <div className="mini-library__empty">{t("promptLibrary.empty")}</div>
          ) : (
            <div className="mini-library__list">
              {quickItems.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={`mini-library__item${item.id === promptLibraryLastSavedId ? " mini-library__item--saved" : ""}`}
                  onClick={() => insertPromptLibraryItem(item)}
                  disabled={needsNode}
                  title={item.text}
                >
                  <span className="mini-library__item-title">
                    {item.isFavorite ? "★ " : ""}
                    {item.name || t("promptLibrary.untitled")}
                  </span>
                  <span className="mini-library__item-preview">
                    {compactPrompt(item.text)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
