import { describe, expect, it } from "vitest";
import { workspaceClosedHere } from "./workspaceClosed";

/** Wave 2, § 3.2, round 10: closed for an app means not open on this device — locked, or no key here. */
describe("workspaceClosedHere", () => {
  it("is locked where the workspace is locked, and no-key where this device holds no key for it", () => {
    expect(workspaceClosedHere({ phase: "locked", lastError: null })).toBe("locked");
    expect(workspaceClosedHere({ phase: "error", lastError: "workspace-key-bundle-missing" })).toBe("no-key");
  });

  it("closes nothing for a workspace that is open here: a sync error, one being prepared or converted, none at all", () => {
    expect(workspaceClosedHere({ phase: "error", lastError: "WebDAV answered 503" })).toBeNull();
    expect(workspaceClosedHere({ phase: "active", lastError: null })).toBeNull();
    expect(workspaceClosedHere({ phase: "preparing", lastError: null })).toBeNull();
    expect(workspaceClosedHere({ phase: "migrating", lastError: null })).toBeNull();
    expect(workspaceClosedHere(null)).toBeNull();
  });
});
