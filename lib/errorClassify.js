const INVALID_REQUEST_CODES = new Set([
  "bad_request",
  "invalid_request",
  "invalid_request_error",
  "invalid_value",
  "invalid_size",
  "invalid_type",
  "invalid_parameter",
  "missing_required_parameter",
  "unsupported_parameter",
  "unsupported_value",
]);

export function classifyUpstreamErrorCode(code) {
  const s = String(code || "").toLowerCase();
  if (!s) return "UNKNOWN";
  if (INVALID_REQUEST_CODES.has(s)) return "INVALID_REQUEST";
  if (s.includes("moderation_blocked") || s.includes("moderation refused")) return "MODERATION_REFUSED";
  return "UNKNOWN";
}

export function classifyUpstreamError(msg) {
  const s = String(msg || "").toLowerCase();
  if (!s) return "UNKNOWN";
  if (s.includes("moderation_blocked") || s.includes("moderation refused")) return "MODERATION_REFUSED";
  if (
    s.includes("token is expired") ||
    s.includes("sign in again") ||
    (s.includes("access token") && s.includes("expired")) ||
    (s.includes("token") && s.includes("expired") && !s.includes("api key"))
  ) {
    return "AUTH_CHATGPT_EXPIRED";
  }
  if (
    s.includes("incorrect api key") ||
    s.includes("invalid authentication") ||
    s.includes("exceeded your current quota") ||
    s.includes("incorrect organization")
  ) {
    return "AUTH_API_KEY_INVALID";
  }
  if (
    s.includes("failed to fetch") ||
    s.includes("econnrefused") ||
    s.includes("econnreset") ||
    s.includes("enotfound") ||
    s.includes("etimedout") ||
    s.includes("network error")
  ) {
    return "NETWORK_FAILED";
  }
  if (s.includes("oauth") && (s.includes("not running") || s.includes("unavailable") || s.includes("not ready"))) {
    return "OAUTH_UNAVAILABLE";
  }
  if (
    s.includes("invalid_request_error") ||
    s.includes("invalid_value") ||
    s.includes("invalid size") ||
    s.includes("invalid request") ||
    s.includes("requested resolution") ||
    s.includes("minimum pixel budget") ||
    s.includes("unsupported value")
  ) {
    return "INVALID_REQUEST";
  }
  if (s.includes("an error occurred while processing") || /\b5\d\d\b/.test(s)) return "UPSTREAM_5XX";
  return "UNKNOWN";
}
