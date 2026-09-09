// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommentStoreLockedError, MigratingWorkspaceCommentStore, commentsDevicePath, type PersonalWorkspaceRuntime } from "@plainva/core";
import { commentShellWorkspace } from "../../../../packages/core/test/helpers/commentShellWorkspace";
import { mobileCommentStore, mobileCommentSelfId, ensureMobileCommentAuthorName, noteWorkspaceCapabilities } from "./mobileComments";
import { clearMobileCommentWorker, setMobileCommentWorker, mobileCommentWorker, type MobileCommentWorker } from "./commentWorker";
import type { MobileVault } from "./vaultService";
import { mPrompt } from "./mobileDialogs";
vi.mock("./mobileDialogs", () => ({ mPrompt: vi.fn() }));
vi.mock("./mobileSettings", () => ({ getMobileSettings: () => ({ verifierName: "" }), updateMobileSettings: vi.fn() }));
vi.mock("./mobileSettingsSync", () => ({ mobileSyncDeviceId: async () => "device", mobileCommentsMode: async () => ({ kind: "plain" }) }));

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { clearMobileCommentWorker(); await Promise.all(cleanups.splice(0).map(clean => clean())); vi.restoreAllMocks(); });
async function setup() {
  const w = await commentShellWorkspace(); cleanups.push(w.cleanup);
  const vault = { vaultId: "mobile-vault", adapter: w.raw, workspaceRuntime: w.runtime, workspaceState: w.state } as unknown as MobileVault;
  return { ...w, vault };
}
describe("the actual mobile workspace comment connection", () => {
  it("ignores late incoming events from a replaced or stopped worker", async () => {
    const w = await setup(), listener = vi.fn();
    const first: MobileCommentWorker = { triggerImmediate() {} }, next: MobileCommentWorker = { triggerImmediate() {} };
    window.addEventListener("plainva-workspace-comments-changed", listener);
    try {
      setMobileCommentWorker(w.vault, first);
      const late = first.onCommentsChanged!;
      setMobileCommentWorker({ ...w.vault } as MobileVault, next);
      late(["old.md"]); expect(listener).not.toHaveBeenCalled();
      next.onCommentsChanged!(["current.md"]); expect(listener).toHaveBeenCalledTimes(1);
      clearMobileCommentWorker(); next.onCommentsChanged!(["stopped.md"]);
      expect(listener).toHaveBeenCalledTimes(1);
    } finally { window.removeEventListener("plainva-workspace-comments-changed", listener); }
  });
  it("posts through the running signed worker and sends its incoming event to this vault", async () => {
    const w = await setup(), events: string[] = [];
    const listener = (event: Event) => { const data = (event as CustomEvent).detail; if (data.vaultId === w.vault.vaultId) events.push(data.path); };
    window.addEventListener("plainva-workspace-comments-changed", listener);
    try {
      setMobileCommentWorker(w.vault, w.worker); w.worker.start();
      const store = mobileCommentStore(w.vault);
      expect(store).toBeInstanceOf(MigratingWorkspaceCommentStore);
      expect(await mobileCommentSelfId(w.vault)).toBe(w.runtime.memberId);
      await ensureMobileCommentAuthorName(w.vault); expect(mPrompt).not.toHaveBeenCalled();
      await store.post({ path: "note.md", body: "From the actual mobile store" });
      await vi.waitFor(async () => { expect(await w.state.listRawComments()).toHaveLength(1); });
      await vi.waitFor(() => expect(events).toContain("note.md"));
      expect((await w.state.listRawComments())[0].operationHash).toMatch(/^[a-f0-9]{64}$/);
      expect(await w.raw.exists(commentsDevicePath("device", false))).toBe(false);
      expect(await w.raw.readTextFile("note.md")).toBe("Original note.");
    } finally { window.removeEventListener("plainva-workspace-comments-changed", listener); }
  });

  it("queues while offline, reopens on the same SQLite state and never falls back while locked", async () => {
    const w = await setup();
    await mobileCommentStore(w.vault).post({ path: "note.md", body: "Offline" });
    const reopened = { ...w.vault } as MobileVault;
    expect((await mobileCommentStore(reopened).list("note.md"))[0].pending).toBeDefined();
    reopened.workspaceRuntime = null;
    expect(await mobileCommentStore(reopened).state()).toMatchObject({ mode: "locked", hasOutbox: true });
    expect(await noteWorkspaceCapabilities(reopened, "note.md")).toEqual([]);
    await expect(mobileCommentStore(reopened).post({ path: "note.md", body: "Locked" })).rejects.toBeInstanceOf(CommentStoreLockedError);
    expect(await w.raw.exists(commentsDevicePath("device", false))).toBe(false);
  });

  it("replaces the plain store on upgrade and rejects workers or runtimes from another vault", async () => {
    const w = await setup();
    const plain = { ...w.vault, workspaceRuntime: null, workspaceState: null } as MobileVault;
    const before = mobileCommentStore(plain); await before.post({ path: "note.md", body: "Before upgrade" });
    plain.workspaceState = w.state; plain.workspaceRuntime = w.runtime;
    const upgraded = mobileCommentStore(plain);
    expect(upgraded).not.toBe(before); expect((await upgraded.list("note.md"))[0].legacyOrigin?.record.body).toBe("Before upgrade");
    const other = { ...w.vault, vaultId: "another-vault" } as MobileVault, foreign = { triggerImmediate: vi.fn(), publishQueuedComments: vi.fn(async () => {}) };
    setMobileCommentWorker(other, foreign);
    expect(mobileCommentWorker(plain)).toBeNull();
    await upgraded.post({ path: "note.md", body: "Still queued here" }); expect(foreign.publishQueuedComments).not.toHaveBeenCalled();
    plain.workspaceRuntime = { ...w.runtime, workspaceId: "ff".repeat(16) } as PersonalWorkspaceRuntime;
    await expect(upgraded.post({ path: "note.md", body: "Wrong workspace" })).rejects.toThrow("runtime-changed");
  });
});
