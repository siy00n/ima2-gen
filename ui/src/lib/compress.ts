export type CompressOptions = {
  maxB64Bytes?: number;
  maxEdge?: number;
  qualityLadder?: number[];
  preserveTransparency?: boolean;
};

const DEFAULTS = {
  maxB64Bytes: 6_000_000,
  maxEdge: 4096,
  qualityLadder: [0.85, 0.7, 0.55],
  preserveTransparency: false,
};
const MAX_CANVAS_PX = 16_777_216;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("FileReader returned non-string"));
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

function dataUrlB64Length(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  return comma === -1 ? dataUrl.length : dataUrl.length - comma - 1;
}

function clampDimensions(width: number, height: number, maxEdge: number) {
  let w = Math.max(1, width);
  let h = Math.max(1, height);
  const longest = Math.max(w, h);
  if (longest > maxEdge) {
    const scale = maxEdge / longest;
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }
  if (w * h > MAX_CANVAS_PX) {
    const scale = Math.sqrt(MAX_CANVAS_PX / (w * h));
    w = Math.max(1, Math.floor(w * scale));
    h = Math.max(1, Math.floor(h * scale));
  }
  return { w, h };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("canvas.toBlob failed"))), type, quality);
  });
}

export async function compressToBase64(file: File, options: CompressOptions = {}): Promise<string> {
  const cfg = { ...DEFAULTS, ...options };
  const raw = await blobToDataUrl(file);
  if (dataUrlB64Length(raw) <= cfg.maxB64Bytes) return raw;

  const bitmap = await createImageBitmap(file);
  try {
    const { w, h } = clampDimensions(bitmap.width, bitmap.height, cfg.maxEdge);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d context unavailable");
    ctx.drawImage(bitmap, 0, 0, w, h);

    if (cfg.preserveTransparency) {
      const dataUrl = await blobToDataUrl(await canvasToBlob(canvas, "image/png"));
      if (dataUrlB64Length(dataUrl) <= cfg.maxB64Bytes) return dataUrl;
    }

    for (const quality of cfg.qualityLadder) {
      const dataUrl = await blobToDataUrl(await canvasToBlob(canvas, "image/jpeg", quality));
      if (dataUrlB64Length(dataUrl) <= cfg.maxB64Bytes) return dataUrl;
    }
    throw new Error("Reference image is too large after compression.");
  } finally {
    bitmap.close?.();
  }
}

export function isHeic(file: File): boolean {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  return type.includes("heic") || type.includes("heif") || name.endsWith(".heic") || name.endsWith(".heif");
}

export function hasAlphaChannel(file: File): boolean {
  return file.type.toLowerCase() === "image/png";
}
