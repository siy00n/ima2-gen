import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import {
  _resetForTests,
  cancelJob,
  finishJob,
  isJobCanceled,
  listJobs,
  startJob,
} from "../lib/inflight.js";

describe("Inflight registry", () => {
  beforeEach(() => {
    _resetForTests();
  });

  it("aborts and hides canceled jobs until they finish", () => {
    const controller = new AbortController();
    startJob({
      requestId: "node-cancel-test",
      kind: "node",
      prompt: "cancel me",
      controller,
    });

    assert.strictEqual(listJobs({ kind: "node" }).length, 1);
    assert.strictEqual(cancelJob("node-cancel-test"), true);
    assert.strictEqual(controller.signal.aborted, true);
    assert.strictEqual(isJobCanceled("node-cancel-test"), true);
    assert.strictEqual(listJobs({ kind: "node" }).length, 0);

    finishJob("node-cancel-test");
    assert.strictEqual(isJobCanceled("node-cancel-test"), false);
  });
});
