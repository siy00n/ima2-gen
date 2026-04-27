import test from "node:test";
import assert from "node:assert/strict";
import {
  errorCodeFrom,
  isNonRetryableGenerationError,
  normalizeGenerationFailure,
  statusForErrorCode,
} from "../lib/generationErrors.js";

test("upstream 4xx validation errors normalize to INVALID_REQUEST", () => {
  const err = new Error("Invalid size. Requested resolution is below the current minimum pixel budget.");
  err.status = 400;
  err.code = "OAUTH_UPSTREAM_ERROR";
  err.upstreamCode = "invalid_value";
  err.upstreamType = "invalid_request_error";
  err.upstreamParam = "tools[0].size";

  const normalized = normalizeGenerationFailure(err);

  assert.equal(errorCodeFrom(err), "INVALID_REQUEST");
  assert.equal(isNonRetryableGenerationError(err), true);
  assert.equal(normalized.code, "INVALID_REQUEST");
  assert.equal(normalized.status, 400);
  assert.equal(normalized.message, err.message);
  assert.equal(normalized.upstreamCode, "invalid_value");
});

test("safety refusals stay distinct from validation errors", () => {
  const err = new Error("moderation refused");
  err.status = 422;
  err.code = "MODERATION_REFUSED";

  const normalized = normalizeGenerationFailure(err);

  assert.equal(isNonRetryableGenerationError(err), false);
  assert.equal(normalized.code, "SAFETY_REFUSAL");
  assert.equal(normalized.status, 422);
});

test("empty responses keep diagnostics for 4k and reference mismatch cases", () => {
  const err = new Error("No image data received");
  err.eventCount = 3;
  err.size = "3840x2160";
  err.quality = "medium";
  err.model = "gpt-5.4-mini";
  err.referenceMismatchCount = 1;
  err.referencesDroppedOnRetry = true;

  const normalized = normalizeGenerationFailure(err);

  assert.equal(normalized.code, "EMPTY_RESPONSE");
  assert.equal(normalized.status, 422);
  assert.equal(normalized.diagnosticReason, "reference_mime_mismatch_candidate");
  assert.equal(normalized.referencesDroppedOnRetry, true);
  assert.match(normalized.message, /3840x2160/);
});

test("statusForErrorCode returns stable HTTP statuses", () => {
  assert.equal(statusForErrorCode("NETWORK_FAILED"), 503);
  assert.equal(statusForErrorCode("AUTH_API_KEY_INVALID"), 401);
  assert.equal(statusForErrorCode("UPSTREAM_5XX"), 502);
  assert.equal(statusForErrorCode("INVALID_REQUEST"), 400);
  assert.equal(statusForErrorCode("SAFETY_REFUSAL"), 422);
  assert.equal(statusForErrorCode("UNKNOWN", 418), 418);
});
