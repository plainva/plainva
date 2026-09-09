// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommentStoreLockedError, commentsDevicePath } from "@plainva/core";
import { commentShellWorkspace } from "../../../../packages/core/test/helpers/commentShellWorkspace";
import { createDesktopCommentStore } from "./workspaceCommentStore";
vi.mock("./settingsProfile", () => ({ getDeviceId: async () => "device", commentsCryptoFor: vi.fn() }));
vi.mock("./settingsStore", () => ({ getSettingsStore: async () => ({}) }));
vi.mock("./encryptionSession", () => ({ loadCachedMasterKey: async () => null, hasLocalKeyfile: async () => false }));

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map(clean => clean())); vi.restoreAllMocks(); });
async function setup() {
  const w = await commentShellWorkspace(); cleanups.push(w.cleanup);
  const deps = { vaultPath: w.root, raw: w.raw, authorName: async () => "Old writer",
    plane: () => ({ runtime: w.runtime, workspaceState: w.state }), worker: () => w.worker, changed: vi.fn() };
  return { ...w, deps };
}
describe("the actual desktop workspace store choice", () => {
  it("imports the plain store's history and publishes new comments through the signed worker", async () => {
    const w = await setup();
    await createDesktopCommentStore(w.deps).post({ path: "note.md", body: "Before upgrade" });
    const oldFile = await w.raw.readTextFile(commentsDevicePath("device", false));
    const store = createDesktopCommentStore({ ...w.deps, workspaceId: w.runtime.workspaceId });
    expect((await store.list("note.md"))[0].legacyOrigin?.authorName).toBe("Old writer");
    w.worker.start();
    await store.post({ path: "note.md", body: "New desktop comment" });
    await vi.waitFor(async () => expect(await w.state.listRawComments()).toHaveLength(2));
    expect((await w.state.listRawComments()).find(c => c.body === "New desktop comment")?.operationHash).toMatch(/^[a-f0-9]{64}$/);
    expect(await w.raw.readTextFile(commentsDevicePath("device", false))).toBe(oldFile);
    expect(await w.raw.readTextFile("note.md")).toBe("Original note.");
  });

  it("queues without a network worker and keeps a locked workspace out of the plain writer", async () => {
    const w = await setup(); let locked = false;
    const deps = { ...w.deps, workspaceId: w.runtime.workspaceId, worker: () => null,
      plane: () => { if (locked) throw new CommentStoreLockedError(); return w.deps.plane(); } };
    await createDesktopCommentStore(deps).post({ path: "note.md", body: "Offline" });
    expect((await createDesktopCommentStore(deps).list("note.md"))[0].pending).toBeDefined();
    locked = true;
    const store = createDesktopCommentStore(deps);
    expect(await store.state()).toMatchObject({ mode: "locked", hasOutbox: true });
    expect(await store.listAll()).toEqual(new Map());
    await expect(store.post({ path: "note.md", body: "Locked" })).rejects.toBeInstanceOf(CommentStoreLockedError);
    expect(await w.raw.exists(commentsDevicePath("device", false))).toBe(false);
  });

  it("rejects a replacement workspace and current read-only rights before persisting anything", async () => {
    const w = await setup(), store = createDesktopCommentStore({ ...w.deps, workspaceId: w.runtime.workspaceId });
    w.runtime.policy.payload.assignments = w.runtime.policy.payload.assignments.map(a => ({ ...a, role: "Commenter", capabilities: ["comment.read", "content.read"] }));
    await expect(store.post({ path: "note.md", body: "Not permitted" })).rejects.toThrow("not-permitted");
    const wrong = createDesktopCommentStore({ ...w.deps, workspaceId: "ff".repeat(16) });
    await expect(wrong.post({ path: "note.md", body: "Wrong workspace" })).rejects.toThrow("runtime-changed");
    expect(await w.state.listCommentOutbox()).toEqual([]);
  });
});
