import { classifyUpstreamError, classifyUpstreamErrorCode } from "./errorClassify.js";

const PASSTHROUGH_CODES = new Set([
  "OAUTH_UNAVAILABLE",
  "NETWORK_FAILED",
  "AUTH_CHATGPT_EXPIRED",
  "AUTH_API_KEY_INVALID",
  "UPSTREAM_5XX",
  "INVALID_REQUEST",
  "OAUTH_UPSTREAM_ERROR",
  "REF_TOO_LARGE",
  "REF_NOT_BASE64",
  "REF_EMPTY",
  "REF_TOO_MANY",
]);
const SAFETY_CODES = new Set(["SAFETY_REFUSAL", "MODERATION_REFUSED", "moderation_blocked"]);

function has4kSize(size) {
  if (typeof size !== "string") return false;
  const [w, h] = size.split("x").map((part) => Number(part));
  return Number.isFinite(w) && Number.isFinite(h) && Math.max(w, h) >= 3840;
}

function diagnosticReasonFrom(err) {
  if (typeof err?.diagnosticReason === "string" && err.diagnosticReason) return err.diagnosticReason;
  if (Number(err?.referenceMismatchCount) > 0) return "reference_mime_mismatch_candidate";
  if (has4kSize(err?.size)) return "experimental_4k_empty_response";
  return null;
}

function copyDiagnostics(target, source) {
  for (const key of [
    "upstreamCode",
    "upstreamType",
    "upstreamParam",
    "eventType",
    "eventCount",
    "eventTypes",
    "size",
    "quality",
    "model",
    "refsCount",
    "inputImageCount",
    "referenceDiagnostics",
    "referenceMismatchCount",
    "retryKind",
    "referencesDroppedOnRetry",
    "developerPromptDroppedOnRetry",
  ]) {
    if (source?.[key] !== undefined) target[key] = source[key];
  }
  const reason = diagnosticReasonFrom(source);
  if (reason) target.diagnosticReason = reason;
}

export function errorCodeFrom(err) {
  if (!err) return "UNKNOWN";
  const upstreamCode = classifyUpstreamErrorCode(err.upstreamCode);
  if (upstreamCode !== "UNKNOWN") return upstreamCode;
  const upstreamType = classifyUpstreamErrorCode(err.upstreamType);
  if (upstreamType !== "UNKNOWN") return upstreamType;
  if (PASSTHROUGH_CODES.has(err.code) || SAFETY_CODES.has(err.code)) return err.code;
  const rawCode = classifyUpstreamErrorCode(err.code);
  if (rawCode !== "UNKNOWN") return rawCode;
  const direct = classifyUpstreamError(err.message);
  if (direct !== "UNKNOWN") return direct;
  const status = Number(err.status);
  if (Number.isFinite(status) && status >= 400 && status < 500 && !SAFETY_CODES.has(err.code)) {
    return "INVALID_REQUEST";
  }
  if (typeof err.code === "string" && err.code) return err.code;
  if (err.cause) return errorCodeFrom(err.cause);
  return "UNKNOWN";
}

export function isNonRetryableGenerationError(err) {
  const code = errorCodeFrom(err);
  if (SAFETY_CODES.has(code)) return false;
  const status = Number(err?.status);
  return code === "INVALID_REQUEST" || code === "REF_TOO_LARGE" || (Number.isFinite(status) && status >= 400 && status < 500);
}

export function statusForErrorCode(code, fallback = 500) {
  if (code === "OAUTH_UNAVAILABLE" || code === "NETWORK_FAILED") return 503;
  if (code === "AUTH_CHATGPT_EXPIRED" || code === "AUTH_API_KEY_INVALID") return 401;
  if (code === "UPSTREAM_5XX" || code === "OAUTH_UPSTREAM_ERROR") return 502;
  if (code === "INVALID_REQUEST" || code?.startsWith?.("REF_")) return 400;
  if (code === "SAFETY_REFUSAL" || code === "MODERATION_REFUSED" || code === "moderation_blocked") return 422;
  return fallback;
}

export function normalizeGenerationFailure(lastErr, options = {}) {
  const code = errorCodeFrom(lastErr);
  if (PASSTHROUGH_CODES.has(code)) {
    const err = new Error(lastErr?.message || options.proxyMessage || "Image backend failure");
    err.code = code;
    err.status = lastErr?.status || statusForErrorCode(code);
    err.cause = lastErr;
    copyDiagnostics(err, lastErr);
    return err;
  }
  if (SAFETY_CODES.has(code)) {
    const err = new Error(options.safetyMessage || lastErr?.message || "Content generation refused after retries");
    err.code = "SAFETY_REFUSAL";
    err.status = 422;
    err.cause = lastErr;
    copyDiagnostics(err, lastErr);
    return err;
  }
  if (typeof lastErr?.eventCount === "number" || has4kSize(lastErr?.size)) {
    const meta = [];
    if (lastErr?.size) meta.push(`size=${lastErr.size}`);
    if (lastErr?.quality) meta.push(`quality=${lastErr.quality}`);
    if (lastErr?.model) meta.push(`model=${lastErr.model}`);
    const err = new Error(
      meta.length
        ? `No image data returned. This may be an unsupported ${meta.join(", ")} combination. Try a different size or model.`
        : "No image data returned from the image backend. Try a different size, quality, or prompt.",
    );
    err.code = "EMPTY_RESPONSE";
    err.status = 422;
    err.cause = lastErr;
    copyDiagnostics(err, lastErr);
    return err;
  }
  const err = new Error(lastErr?.message || options.proxyMessage || "Image generation failed");
  err.code = code === "UNKNOWN" ? "UNKNOWN" : code;
  err.status = lastErr?.status || statusForErrorCode(err.code, 500);
  err.cause = lastErr;
  copyDiagnostics(err, lastErr);
  return err;
}
