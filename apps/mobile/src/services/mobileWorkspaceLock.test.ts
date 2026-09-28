import { beforeEach, describe, expect, it, vi } from "vitest";

const workspace = vi.hoisted(() => ({ status: null as { phase: string } | null, runtime: null as object | null, fail: false }));
vi.mock("./mobileWorkspaceSecurity", () => ({
  getMobileWorkspaceStatus: vi.fn(async () => {
    if (workspace.fail) throw new Error("preferences unavailable");
    return workspace.status;
  }),
  loadMobileWorkspaceRuntime: vi.fn(async () => workspace.runtime),
}));

import { isMobileWorkspaceLocked } from "./mobileWorkspaceLock";

/**
 * One answer to "is this workspace sealed right now?" for the widget snapshot
 * and the remark notifier (plan Befunde 24.09., E7).
 */
describe("isMobileWorkspaceLocked", () => {
  beforeEach(() => {
    workspace.status = null;
    workspace.runtime = null;
    workspace.fail = false;
  });

  it("a vault without a workspace is never locked", async () => {
    expect(await isMobileWorkspaceLocked("v")).toBe(false);
  });

  it("an active workspace with its keys in memory is open", async () => {
    workspace.status = { phase: "active" };
    workspace.runtime = {};
    expect(await isMobileWorkspaceLocked("v")).toBe(false);
  });

  it("any other phase, keys not in memory, or no answer at all is locked", async () => {
    for (const phase of ["locked", "pairing", "setup-incomplete", "error"]) {
      workspace.status = { phase };
      workspace.runtime = {};
      expect(await isMobileWorkspaceLocked("v"), phase).toBe(true);
    }
    workspace.status = { phase: "active" };
    workspace.runtime = null;
    expect(await isMobileWorkspaceLocked("v")).toBe(true);
    workspace.fail = true;
    expect(await isMobileWorkspaceLocked("v")).toBe(true);
  });
});
