export async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the selection-based copy path for non-secure mobile contexts.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "-9999px";
  textarea.style.fontSize = "16px";

  const selection = document.getSelection();
  const previousRange =
    selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  document.body.appendChild(textarea);
  textarea.focus({ preventScroll: true });
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);

  if (selection && previousRange) {
    selection.removeAllRanges();
    selection.addRange(previousRange);
  }

  if (!copied) throw new Error("copy command failed");
}

export async function copyImageToClipboard(source: string): Promise<void> {
  const imageUrl = new URL(source, window.location.href).href;

  if (!window.isSecureContext) {
    throw new Error("image-copy-requires-https");
  }
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new Error("image-copy-unsupported");
  }

  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`image fetch failed: ${res.status}`);
  const blob = await res.blob();
  const type = blob.type || "image/png";
  if (!type.startsWith("image/")) throw new Error(`not an image: ${type}`);
  await navigator.clipboard.write([new ClipboardItem({ [type]: blob })]);
}
