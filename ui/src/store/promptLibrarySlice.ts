import {
  createPrompt,
  deletePrompt,
  getPromptLibrary,
  importPromptLibrary,
  togglePromptFavorite,
  updatePrompt,
  type PromptCreatePayload,
  type PromptItem,
  type PromptLibraryImportPayload,
  type PromptUpdatePayload,
} from "../lib/promptLibrary";
import { t } from "../i18n";
import type { AppState } from "./useAppStore";

type PromptLibrarySlice = Pick<
  AppState,
  | "promptLibraryOpen"
  | "promptLibraryItems"
  | "promptLibraryLoading"
  | "promptLibrarySaving"
  | "promptLibraryError"
  | "promptLibraryLastSavedId"
  | "openPromptLibrary"
  | "closePromptLibrary"
  | "refreshPromptLibrary"
  | "createPromptLibraryItem"
  | "updatePromptLibraryItem"
  | "deletePromptLibraryItem"
  | "togglePromptLibraryFavorite"
  | "importPromptLibraryItems"
  | "usePromptLibraryItem"
  | "insertPromptLibraryItem"
>;

type SetState = (patch: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void;
type GetState = () => AppState;

export type {
  PromptCreatePayload,
  PromptItem,
  PromptLibraryImportPayload,
  PromptUpdatePayload,
};

export function createPromptLibrarySlice(
  set: SetState,
  get: GetState,
): PromptLibrarySlice {
  return {
    promptLibraryOpen: false,
    promptLibraryItems: [],
    promptLibraryLoading: false,
    promptLibrarySaving: false,
    promptLibraryError: null,
    promptLibraryLastSavedId: null,
    openPromptLibrary: async () => {
      set({ promptLibraryOpen: true });
      await get().refreshPromptLibrary();
    },
    closePromptLibrary: () => set({ promptLibraryOpen: false }),
    refreshPromptLibrary: async () => {
      set({ promptLibraryLoading: true, promptLibraryError: null });
      try {
        const { prompts } = await getPromptLibrary();
        set({ promptLibraryItems: prompts, promptLibraryLoading: false });
      } catch (err) {
        set({
          promptLibraryLoading: false,
          promptLibraryError: err instanceof Error ? err.message : "Prompt library failed",
        });
      }
    },
    createPromptLibraryItem: async (payload) => {
      set({ promptLibrarySaving: true, promptLibraryError: null });
      try {
        const { prompt } = await createPrompt(payload);
        set((s) => ({
          promptLibraryItems: [prompt, ...s.promptLibraryItems],
          promptLibrarySaving: false,
          promptLibraryLastSavedId: prompt.id,
        }));
        get().showToast(t("toast.promptSaved"));
        window.setTimeout(() => {
          if (get().promptLibraryLastSavedId === prompt.id) {
            set({ promptLibraryLastSavedId: null });
          }
        }, 2600);
      } catch (err) {
        set({
          promptLibrarySaving: false,
          promptLibraryError: err instanceof Error ? err.message : "Prompt save failed",
        });
        get().showToast(t("toast.promptSaveFailed"), true);
      }
    },
    updatePromptLibraryItem: async (id, payload) => {
      set({ promptLibrarySaving: true, promptLibraryError: null });
      try {
        const { prompt } = await updatePrompt(id, payload);
        set((s) => ({
          promptLibraryItems: s.promptLibraryItems.map((item) =>
            item.id === id ? prompt : item,
          ),
          promptLibrarySaving: false,
        }));
      } catch (err) {
        set({
          promptLibrarySaving: false,
          promptLibraryError: err instanceof Error ? err.message : "Prompt update failed",
        });
      }
    },
    deletePromptLibraryItem: async (id) => {
      set({ promptLibrarySaving: true, promptLibraryError: null });
      try {
        await deletePrompt(id);
        set((s) => ({
          promptLibraryItems: s.promptLibraryItems.filter((item) => item.id !== id),
          promptLibrarySaving: false,
        }));
      } catch (err) {
        set({
          promptLibrarySaving: false,
          promptLibraryError: err instanceof Error ? err.message : "Prompt delete failed",
        });
      }
    },
    togglePromptLibraryFavorite: async (id) => {
      const current = get().promptLibraryItems.find((item) => item.id === id);
      if (!current) return;
      const optimistic = { ...current, isFavorite: !current.isFavorite };
      set((s) => ({
        promptLibraryItems: s.promptLibraryItems.map((item) =>
          item.id === id ? optimistic : item,
        ),
      }));
      try {
        const result = await togglePromptFavorite(id);
        set((s) => ({
          promptLibraryItems: s.promptLibraryItems.map((item) =>
            item.id === id
              ? { ...item, isFavorite: result.isFavorite, favoritedAt: result.favoritedAt }
              : item,
          ),
        }));
      } catch {
        set((s) => ({
          promptLibraryItems: s.promptLibraryItems.map((item) =>
            item.id === id ? current : item,
          ),
        }));
      }
    },
    importPromptLibraryItems: async (payload) => {
      set({ promptLibrarySaving: true, promptLibraryError: null });
      try {
        await importPromptLibrary(payload);
        set({ promptLibrarySaving: false });
        await get().refreshPromptLibrary();
      } catch (err) {
        set({
          promptLibrarySaving: false,
          promptLibraryError: err instanceof Error ? err.message : "Prompt import failed",
        });
      }
    },
    usePromptLibraryItem: (item) => {
      const s = get();
      if (s.uiMode === "node" && s.selectedNodeId) {
        get().updateNodePrompt(s.selectedNodeId, item.text);
      } else if (s.uiMode === "node") {
        get().showToast(t("toast.selectNodeFirst"), true);
        return;
      } else {
        set({ prompt: item.text });
      }
      get().closePromptLibrary();
    },
    insertPromptLibraryItem: (item) => {
      const s = get();
      if (s.uiMode === "node" && s.selectedNodeId) {
        const node = s.graphNodes.find((n) => n.id === s.selectedNodeId);
        const next = [node?.data.prompt, item.text].filter(Boolean).join("\n\n");
        get().updateNodePrompt(s.selectedNodeId, next);
      } else if (s.uiMode === "node") {
        get().showToast(t("toast.selectNodeFirst"), true);
        return;
      } else {
        set({ prompt: [s.prompt, item.text].filter(Boolean).join("\n\n") });
      }
      get().closePromptLibrary();
    },
  };
}
