import { describe, expect, it } from "vitest";
import { queuesLocalChanges } from "./filesSwitch";

/**
 * Review of plan "Verbinden", finding 4: files switched off (or paused, or
 * signed out) stop the worker, not the record of what changed. A file edited
 * outside Plainva meanwhile went unnoticed once files were on again - the
 * index had taken it in, and the queue never heard of it.
 */
describe("whether the vault queues its local changes", () => {
  it("does while its provider stands still - files off, paused, or signed out here", () => {
    expect(queuesLocalChanges({ provider: "webdav", blocked: null })).toBe(true);
    expect(queuesLocalChanges({ provider: null, blocked: "webdav" })).toBe(true);
  });

  it("does not for a vault without a provider", () => {
    expect(queuesLocalChanges({ provider: null, blocked: null })).toBe(false);
  });
});
