export type PromptMode = "auto" | "direct";

export type PromptFolder = {
  id: string;
  parentId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
};

export type PromptItem = {
  id: string;
  folderId: string;
  name: string;
  text: string;
  tags: string[];
  mode: PromptMode | null;
  isFavorite: boolean;
  favoritedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type PromptLibraryPage = {
  prompts: PromptItem[];
  folders: PromptFolder[];
};

export type PromptLibraryQuery = {
  search?: string;
  folderId?: string;
  favoritesOnly?: boolean;
};

export type PromptCreatePayload = {
  name?: string;
  text: string;
  tags?: string[];
  folderId?: string;
  mode?: PromptMode;
};

export type PromptUpdatePayload = Partial<{
  name: string;
  text: string;
  tags: string[];
  folderId: string;
  mode: PromptMode | null;
}>;

export type PromptLibraryImportPayload = {
  version?: number;
  folders?: Array<{ id?: string; name: string; parentId?: string }>;
  prompts?: Array<{
    id?: string;
    name?: string;
    text: string;
    tags?: string[];
    folderId?: string;
    mode?: PromptMode | null;
    isFavorite?: boolean;
  }>;
};

export type PromptLibraryImportResult = {
  foldersCreated: number;
  promptsImported: number;
  duplicatesSkipped: number;
};

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => ({}))) as T & {
    error?: string | { message?: string };
  };
  if (!res.ok) {
    const raw = data.error;
    const message =
      typeof raw === "string"
        ? raw
        : raw?.message ?? `Request failed: ${res.status}`;
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return data;
}

function jsonInit(method: string, payload: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

export function getPromptLibrary(
  params: PromptLibraryQuery = {},
): Promise<PromptLibraryPage> {
  const qs = new URLSearchParams();
  if (params.search) qs.set("search", params.search);
  if (params.folderId) qs.set("folderId", params.folderId);
  if (params.favoritesOnly) qs.set("favoritesOnly", "1");
  const suffix = qs.size > 0 ? `?${qs.toString()}` : "";
  return jsonFetch(`/api/prompts${suffix}`);
}

export function createPrompt(
  payload: PromptCreatePayload,
): Promise<{ prompt: PromptItem }> {
  return jsonFetch("/api/prompts", jsonInit("POST", payload));
}

export function updatePrompt(
  id: string,
  payload: PromptUpdatePayload,
): Promise<{ prompt: PromptItem }> {
  return jsonFetch(
    `/api/prompts/${encodeURIComponent(id)}`,
    jsonInit("PATCH", payload),
  );
}

export function deletePrompt(id: string): Promise<{ ok: boolean }> {
  return jsonFetch(`/api/prompts/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function togglePromptFavorite(
  id: string,
): Promise<{ isFavorite: boolean; favoritedAt: number | null }> {
  return jsonFetch(`/api/prompts/${encodeURIComponent(id)}/favorite`, {
    method: "POST",
  });
}

export function importPromptLibrary(
  payload: PromptLibraryImportPayload,
): Promise<PromptLibraryImportResult> {
  return jsonFetch("/api/prompts/import", jsonInit("POST", payload));
}

export function parsePromptImportText(
  source: string,
  fallbackName = "Imported prompt",
): PromptLibraryImportPayload {
  const trimmed = source.trim();
  if (!trimmed) return { version: 1, prompts: [] };

  try {
    const parsed = JSON.parse(trimmed) as PromptLibraryImportPayload;
    if (Array.isArray(parsed.prompts)) return parsed;
  } catch {
    // Plain text and markdown files are accepted below.
  }

  return {
    version: 1,
    prompts: [{ name: fallbackName, text: trimmed }],
  };
}

export async function readPromptImportFiles(
  files: File[],
): Promise<PromptLibraryImportPayload> {
  const prompts: NonNullable<PromptLibraryImportPayload["prompts"]> = [];
  const folders: NonNullable<PromptLibraryImportPayload["folders"]> = [];

  for (const file of files) {
    const parsed = parsePromptImportText(await file.text(), file.name);
    if (parsed.folders) folders.push(...parsed.folders);
    if (parsed.prompts) prompts.push(...parsed.prompts);
  }

  return { version: 1, folders, prompts };
}
