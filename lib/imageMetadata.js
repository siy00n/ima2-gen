export const IMA2_METADATA_SCHEMA = "ima2.generation.v1";
export const IMA2_XMP_NAMESPACE = "https://github.com/lidge-jun/ima2-gen/ns/1.0/";
export const IMA2_XMP_PROPERTY = "GenerationMetadata";
export const MAX_EMBEDDED_METADATA_CHARS = 64 * 1024;

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function stringOrNull(value, max = 4000) {
  return typeof value === "string" ? value.slice(0, max) : null;
}

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function xmlUnescape(value) {
  return String(value)
    .replace(/&quot;/g, "\"")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function buildIma2MetadataPayload(meta = {}, context = {}) {
  const payload = {
    schema: IMA2_METADATA_SCHEMA,
    app: "ima2-gen",
    version: stringOrNull(context.version, 80) || stringOrNull(meta.version, 80),
    createdAt: numberOrNull(meta.createdAt) || Date.now(),
    kind: stringOrNull(meta.kind, 80),
    prompt: stringOrNull(meta.prompt),
    userPrompt: stringOrNull(meta.userPrompt) || stringOrNull(meta.displayPrompt) || stringOrNull(meta.prompt),
    revisedPrompt: stringOrNull(meta.revisedPrompt),
    promptMode: meta.promptMode === "direct" ? "direct" : "auto",
    quality: stringOrNull(meta.quality, 40) || stringOrNull(meta.options?.quality, 40),
    size: stringOrNull(meta.size, 40) || stringOrNull(meta.options?.size, 40),
    format: stringOrNull(meta.format, 20) || stringOrNull(meta.options?.format, 20),
    moderation: stringOrNull(meta.moderation, 40) || stringOrNull(meta.options?.moderation, 40),
    model: stringOrNull(meta.model, 80) || stringOrNull(meta.options?.model, 80),
    provider: stringOrNull(meta.provider, 40),
    sessionId: stringOrNull(meta.sessionId, 120),
    nodeId: stringOrNull(meta.nodeId, 120),
    parentNodeId: stringOrNull(meta.parentNodeId, 120),
    clientNodeId: stringOrNull(meta.clientNodeId, 120),
    requestId: stringOrNull(meta.requestId, 160),
    refsCount: Number.isFinite(meta.refsCount) ? meta.refsCount : 0,
    webSearchCalls: Number.isFinite(meta.webSearchCalls) ? meta.webSearchCalls : 0,
    styleSheetApplied: Boolean(meta.styleSheetApplied),
  };
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
}

export function normalizeEmbeddedMetadata(value) {
  if (!isPlainObject(value)) return null;
  if (value.schema !== IMA2_METADATA_SCHEMA || value.app !== "ima2-gen") return null;
  return buildIma2MetadataPayload(value, { version: value.version });
}

export function normalizeSidecarMetadata(value, context = {}) {
  if (!isPlainObject(value)) return null;
  return buildIma2MetadataPayload(value, context);
}

export function buildIma2Xmp(metadataPayload) {
  const normalized = normalizeEmbeddedMetadata(metadataPayload);
  if (!normalized) {
    const err = new Error("Invalid ima2 metadata payload");
    err.code = "IMAGE_METADATA_INVALID";
    throw err;
  }
  const json = JSON.stringify(normalized);
  if (json.length > MAX_EMBEDDED_METADATA_CHARS) {
    const err = new Error("ima2 metadata payload is too large");
    err.code = "IMAGE_METADATA_TOO_LARGE";
    throw err;
  }
  return [
    "<?xpacket begin=\"\uFEFF\" id=\"W5M0MpCehiHzreSzNTczkc9d\"?>",
    "<x:xmpmeta xmlns:x=\"adobe:ns:meta/\">",
    "<rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\">",
    `<rdf:Description xmlns:ima2="${IMA2_XMP_NAMESPACE}" ima2:${IMA2_XMP_PROPERTY}="${xmlEscape(json)}"/>`,
    "</rdf:RDF>",
    "</x:xmpmeta>",
    "<?xpacket end=\"w\"?>",
  ].join("");
}

export function parseIma2Xmp(xmpString) {
  if (typeof xmpString !== "string" || xmpString.length === 0) return null;
  const match = new RegExp(`ima2:${IMA2_XMP_PROPERTY}="([^"]*)"`).exec(xmpString);
  if (!match?.[1]) return null;
  try {
    return normalizeEmbeddedMetadata(JSON.parse(xmlUnescape(match[1])));
  } catch {
    return null;
  }
}
