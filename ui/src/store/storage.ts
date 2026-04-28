import type { UIMode } from "../types";

export type PersistedInFlight = {
  id: string;
  prompt: string;
  startedAt: number;
  phase?: string;
  sessionId?: string | null;
  clientNodeId?: string | null;
  kind?: "classic" | "node";
};

export const INFLIGHT_TTL_MS = 180_000;

export function loadRightPanelOpen(): boolean {
  try {
    const raw = localStorage.getItem("ima2.rightPanelOpen");
    if (raw === null) {
      if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
        return !window.matchMedia("(max-width: 800px)").matches;
      }
      return true;
    }
    return JSON.parse(raw) === true;
  } catch {
    return true;
  }
}

export function saveRightPanelOpen(open: boolean): void {
  try {
    localStorage.setItem("ima2.rightPanelOpen", JSON.stringify(open));
  } catch {}
}

export function loadUIMode(): UIMode {
  try {
    const raw = localStorage.getItem("ima2.uiMode");
    if (raw === "node" || raw === "classic") return raw;
  } catch {}
  return "classic";
}

export function saveUIMode(mode: UIMode): void {
  try {
    localStorage.setItem("ima2.uiMode", mode);
  } catch {}
}

export function loadInFlight(): PersistedInFlight[] {
  try {
    const raw = localStorage.getItem("ima2.inFlight");
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    const now = Date.now();
    return arr
      .filter(
        (x) =>
          x &&
          typeof x.id === "string" &&
          typeof x.prompt === "string" &&
          typeof x.startedAt === "number" &&
          now - x.startedAt < INFLIGHT_TTL_MS,
      )
      .map((x) => ({
        id: x.id,
        prompt: x.prompt,
        startedAt: x.startedAt,
        phase: typeof x.phase === "string" ? x.phase : undefined,
        sessionId: typeof x.sessionId === "string" ? x.sessionId : null,
        clientNodeId: typeof x.clientNodeId === "string" ? x.clientNodeId : null,
        kind: x.kind === "classic" || x.kind === "node" ? x.kind : undefined,
      }));
  } catch {
    return [];
  }
}

export function saveInFlight(
  list: PersistedInFlight[],
  onQuotaError?: (err: unknown) => void,
): void {
  try {
    localStorage.setItem("ima2.inFlight", JSON.stringify(list));
  } catch (err) {
    onQuotaError?.(err);
  }
}

export function loadSelectedFilename(): string | null {
  try {
    const raw = localStorage.getItem("ima2.selectedFilename");
    return typeof raw === "string" && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

export function saveSelectedFilename(filename: string | null): void {
  try {
    if (filename) localStorage.setItem("ima2.selectedFilename", filename);
    else localStorage.removeItem("ima2.selectedFilename");
  } catch {}
}
