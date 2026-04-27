import type { GenerateItem } from "../types";

export function getGalleryItemKey(item: Pick<GenerateItem, "filename" | "url" | "image">): string {
  return item.filename || item.url || item.image;
}

export function getGalleryItemReactKey(
  item: Pick<GenerateItem, "filename" | "url" | "image">,
  keyPrefix: string,
): string {
  return `${keyPrefix}-${getGalleryItemKey(item)}`;
}
