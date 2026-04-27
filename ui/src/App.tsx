import { useEffect } from "react";
import { Sidebar } from "./components/Sidebar";
import { Canvas } from "./components/Canvas";
import { NodeCanvas } from "./components/NodeCanvas";
import { RightPanel } from "./components/RightPanel";
import { Toast } from "./components/Toast";
import { GalleryModal } from "./components/GalleryModal";
import { MobileToolbar } from "./components/MobileToolbar";
import { PromptLibraryPanel } from "./components/PromptLibraryPanel";
import { useI18n } from "./i18n";
import { useAppStore, flushGraphSaveBeacon } from "./store/useAppStore";

export default function App() {
  const hydrateHistory = useAppStore((s) => s.hydrateHistory);
  const loadSessions = useAppStore((s) => s.loadSessions);
  const startInFlightPolling = useAppStore((s) => s.startInFlightPolling);
  const reconcileInflight = useAppStore((s) => s.reconcileInflight);
  const syncFromStorage = useAppStore((s) => s.syncFromStorage);
  const uiMode = useAppStore((s) => s.uiMode);
  const { t } = useI18n();
  const promptLibraryOpen = useAppStore((s) => s.promptLibraryOpen);
  const promptLibraryItems = useAppStore((s) => s.promptLibraryItems);
  const promptLibraryLoading = useAppStore((s) => s.promptLibraryLoading);
  const promptLibrarySaving = useAppStore((s) => s.promptLibrarySaving);
  const promptLibraryError = useAppStore((s) => s.promptLibraryError);
  const closePromptLibrary = useAppStore((s) => s.closePromptLibrary);
  const createPromptLibraryItem = useAppStore((s) => s.createPromptLibraryItem);
  const updatePromptLibraryItem = useAppStore((s) => s.updatePromptLibraryItem);
  const deletePromptLibraryItem = useAppStore((s) => s.deletePromptLibraryItem);
  const togglePromptLibraryFavorite = useAppStore((s) => s.togglePromptLibraryFavorite);
  const importPromptLibraryItems = useAppStore((s) => s.importPromptLibraryItems);
  const usePromptLibraryItem = useAppStore((s) => s.usePromptLibraryItem);
  const insertPromptLibraryItem = useAppStore((s) => s.insertPromptLibraryItem);

  useEffect(() => {
    hydrateHistory();
    loadSessions();
    reconcileInflight();
    startInFlightPolling();
  }, [hydrateHistory, loadSessions, reconcileInflight, startInFlightPolling]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (!e.key) return;
      if (e.key === "ima2.inFlight" || e.key === "ima2.selectedFilename") {
        syncFromStorage();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [syncFromStorage]);

  useEffect(() => {
    const onHide = () => {
      flushGraphSaveBeacon(useAppStore.getState);
    };
    window.addEventListener("beforeunload", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("beforeunload", onHide);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, []);

  return (
    <>
      <MobileToolbar />
      <div className="app">
        <Sidebar />
        {uiMode === "classic" ? <Canvas /> : <NodeCanvas />}
        <RightPanel />
      </div>
      <Toast />
      <GalleryModal />
      <PromptLibraryPanel
        open={promptLibraryOpen}
        prompts={promptLibraryItems}
        loading={promptLibraryLoading}
        saving={promptLibrarySaving}
        error={promptLibraryError}
        labels={{
          title: t("promptLibrary.title"),
          add: t("promptLibrary.add"),
          import: t("promptLibrary.import"),
          importFiles: t("promptLibrary.importFiles"),
          search: t("promptLibrary.search"),
          favorites: t("promptLibrary.favorites"),
          loading: t("promptLibrary.loading"),
          empty: t("promptLibrary.empty"),
          dropImport: t("promptLibrary.dropImport"),
          close: t("common.close"),
          delete: t("common.delete"),
          edit: t("promptLibrary.edit"),
          favorite: t("gallery.favoriteTitle"),
          unfavorite: t("gallery.unfavoriteTitle"),
          use: t("promptLibrary.use"),
          insert: t("promptLibrary.insert"),
          untitled: t("promptLibrary.untitled"),
          addTitle: t("promptLibrary.addTitle"),
          editTitle: t("promptLibrary.editTitle"),
          name: t("promptLibrary.name"),
          text: t("promptLibrary.text"),
          tags: t("promptLibrary.tags"),
          mode: t("promptLibrary.mode"),
          cancel: t("common.cancel"),
          save: t("promptLibrary.save"),
        }}
        onClose={closePromptLibrary}
        onCreate={createPromptLibraryItem}
        onUpdate={updatePromptLibraryItem}
        onDelete={(id) => deletePromptLibraryItem(id)}
        onToggleFavorite={(id) => togglePromptLibraryFavorite(id)}
        onImport={importPromptLibraryItems}
        onUse={usePromptLibraryItem}
        onInsert={insertPromptLibraryItem}
      />
    </>
  );
}
