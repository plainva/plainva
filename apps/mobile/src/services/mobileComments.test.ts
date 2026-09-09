// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BackupVaultAdapter, commentsDevicePath, parseCommentsBundle, type CommentBundleFault, type CommentStore } from "@plainva/core";
import { LocalVaultAdapter } from "../../../../packages/core/src/vault/LocalVaultAdapter";
import { mobileCommentStore } from "./mobileComments";
import type { MobileVault } from "./vaultService";
vi.mock("./mobileDialogs", () => ({ mPrompt: vi.fn() }));
vi.mock("./mobileSettings", () => ({ getMobileSettings: () => ({ verifierName: "Reviewer" }), updateMobileSettings: vi.fn() }));
vi.mock("./mobileSettingsSync", () => ({ mobileSyncDeviceId: async () => "device", mobileCommentsMode: async () => ({ kind: "plain" }) }));


describe("mobile comment store coordination", () => {
  let root: string;
  let raw: LocalVaultAdapter;
  let received: Array<{ faults: CommentBundleFault[]; vaultPath?: string; vaultId?: string }>;
  const onFaults = (event: Event) => received.push((event as CustomEvent).detail);
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "plainva-shell-comments-"));
    raw = new LocalVaultAdapter(root);
    await raw.initialize();
    received = [];
    window.addEventListener("plainva-comment-faults", onFaults);
  });
  afterEach(async () => {
    window.removeEventListener("plainva-comment-faults", onFaults);
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });
  function makeStore(): CommentStore {
    return mobileCommentStore({ vaultId: root, adapter: new BackupVaultAdapter(raw) } as unknown as MobileVault);
  }
  it("shares one writer across rebuilt vault/store instances", async () => {
    const a = makeStore(), b = makeStore();
    await a.post({ path: "Note.md", body: "seed" });
    await Promise.all(Array.from({ length: 12 }, (_, n) => (n % 2 ? a : b).post({ path: "Note.md", body: "remark " + n })));
    const saved = parseCommentsBundle(await raw.readTextFile(commentsDevicePath("device", false)))!;
    expect(new Set(Object.values(saved.comments).map((r) => r.body)).size).toBe(13);
    expect(saved.authors.device.name).toBe("Reviewer");
  });
  it("reports a failed recovery with the right vault identity and retains the original", async () => {
    const path = commentsDevicePath("device", false);
    await raw.writeTextFile(path, "{ damaged");
    const write = raw.writeTextFile.bind(raw);
    vi.spyOn(raw, "writeTextFile").mockImplementation(async (file, text) => {
      if (file.includes(".broken-")) throw new Error("backup access denied");
      return write(file, text);
    });
    await expect(makeStore().post({ path: "Note.md", body: "unsaved" })).rejects.toThrow("backup access denied");
    expect(await raw.readTextFile(path)).toBe("{ damaged");
    expect(received).toEqual([{
      vaultId: root,
      faults: [{ path, reason: "bundle-backup", message: "backup access denied" }],
    }]);
  });
});
