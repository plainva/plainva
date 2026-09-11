import { describe, expect, it } from "vitest";
import { commitVaultTransfer, planVaultTransfer } from "../src/vault/vaultTransfer.js";
import { assertComparisonUnchanged, separateTaskConflict } from "../src/pim/taskNoteIdentity.js";
import type { IVaultAdapter } from "../src/vault/IVaultAdapter.js";
import type { ISyncTarget } from "../src/sync/ISyncTarget.js";

function disk(initial: Record<string, string>) {
  const files = new Map(Object.entries(initial));
  let writes = 0;
  let interruptAt = 0;
  const adapter = {
    exists: async (p: string) => files.has(p),
    readTextFile: async (p: string) => { if (!files.has(p)) throw new Error("missing"); return files.get(p)!; },
    readBinaryFile: async (p: string) => new TextEncoder().encode(await adapter.readTextFile(p)),
    writeTextFile: async (p: string, value: string) => { if (++writes === interruptAt) throw new Error("interrupted"); files.set(p, value); },
    writeBinaryFile: async (p: string, b: Uint8Array) => adapter.writeTextFile(p, new TextDecoder().decode(b)),
    deleteItem: async (p: string) => { files.delete(p); },
    listDir: async () => [...files.keys()].map(path => ({ path, name: path, isDirectory: false, size: 0, mtime: 0 })),
  } as unknown as IVaultAdapter;
  return { adapter, files, interrupt: (at: number) => { writes = 0; interruptAt = at; } };
}
function cloud(initial: Record<string, string>) {
  const d = disk(initial);
  return { ...d, target: { pull: async () => ({ etagMap: new Map(d.files) }), download: async (p: string) => d.adapter.readBinaryFile(p) } as ISyncTarget };
}

describe("reviewed vault transfer", () => {
  it("shows every collision before writes and preserves source, remote and unsynced destination content", async () => {
    const source = disk({ "Daily.md": "source", "Notes.md": "new" });
    const remote = cloud({ "Daily.md": "remote", "Archive.md": "old" });
    const destination = disk({ "Daily.md": "unsynced target" });
    const plan = await planVaultTransfer(source.adapter, remote.target, destination.adapter);
    expect(plan.collisions).toHaveLength(2);
    expect(destination.files.size).toBe(1);
    await commitVaultTransfer(plan, source.adapter, destination.adapter, remote.target);
    expect([...destination.files.values()]).toEqual(expect.arrayContaining(["source", "remote", "unsynced target", "old", "new"]));
    expect(source.files.get("Daily.md")).toBe("source");
    expect(remote.files.get("Daily.md")).toBe("remote");
  });
  it.each(["source", "remote", "destination"])("refuses a changed %s before applying the preview", async side => {
    const source = disk({ "a.md": "source" }), remote = cloud({ "a.md": "remote" }), destination = disk({ "a.md": "target" });
    const plan = await planVaultTransfer(source.adapter, remote.target, destination.adapter);
    ({ source, remote, destination }[side]!).files.set("a.md", "new edit");
    await expect(commitVaultTransfer(plan, source.adapter, destination.adapter, remote.target)).rejects.toThrow(/changed/);
    expect(destination.files.size).toBe(1);
  });
  it("resumes an interrupted copy without additional copies or losing bytes", async () => {
    const source = disk({ "a.md": "source" }), remote = cloud({ "a.md": "remote" }), destination = disk({ "a.md": "target" });
    const plan = await planVaultTransfer(source.adapter, remote.target, destination.adapter);
    destination.interrupt(2);
    await expect(commitVaultTransfer(plan, source.adapter, destination.adapter, remote.target)).rejects.toThrow("interrupted");
    expect(destination.files.get("a.md")).toBe("target");
    destination.interrupt(0);
    const resumed = await planVaultTransfer(source.adapter, remote.target, destination.adapter);
    await commitVaultTransfer(resumed, source.adapter, destination.adapter, remote.target);
    expect(destination.files.size).toBe(3);
    expect([...destination.files.values()].sort()).toEqual(["remote", "source", "target"]);
  });
  it("rejects incomplete inventories and escaping paths", async () => {
    const source = disk({}), remote = cloud({ "../escape.md": "bad" });
    await expect(planVaultTransfer(source.adapter, remote.target)).rejects.toThrow("invalid_path");
    remote.target.pull = async () => ({ etagMap: new Map(), needsFullListing: true });
    await expect(planVaultTransfer(source.adapter, remote.target)).rejects.toThrow("incomplete_inventory");
  });
  it.each([["note.md", "NOTE.md"], ["C:/outside.md", "note.md"], ["file", "file/child.md"]])("rejects ambiguous portable paths %s and %s", async (a, b) => {
    const source = disk({}), remote = cloud({ [a]: "one", [b]: "two" });
    await expect(planVaultTransfer(source.adapter, remote.target)).rejects.toThrow("invalid_path");
  });
});

describe("comparison snapshot and task repair", () => {
  const task = (id: string) => `---\nFrist: 2026-09-11\nStatus: Offen\nplainva:\n  pim:\n    kind: task\n    provider: google\n    identity: google:subject\n    list: daily\n    uid: ${id}\ncustom: unchanged\n---\n# Daily task\nOwn text\n`;
  it("checks both files, including missing originals and line endings", async () => {
    const d = disk({ "a.md": "a\r\n", "copy.md": "b" });
    await expect(assertComparisonUnchanged(d.adapter, "a.md", "a\n", "copy.md", "b")).rejects.toThrow("comparisonChanged");
    await expect(assertComparisonUnchanged(d.adapter, "missing.md", null, "copy.md", "b")).resolves.toBeUndefined();
    d.files.set("copy.md", "edited");
    await expect(assertComparisonUnchanged(d.adapter, "a.md", "a\r\n", "copy.md", "b")).rejects.toThrow("comparisonChanged");
  });
  it("keeps both task instances and all unknown fields, reusing a copy left by interruption", async () => {
    const a = task("first"), b = task("second"), d = disk({ "Daily.md": a, "Daily.CONFLICT.md": b });
    const realDelete = d.adapter.deleteItem;
    d.adapter.deleteItem = async () => { throw new Error("interrupted"); };
    await expect(separateTaskConflict(d.adapter, "Daily.md", a, "Daily.CONFLICT.md", b)).rejects.toThrow("interrupted");
    expect(d.files.size).toBe(3);
    d.adapter.deleteItem = realDelete;
    const path = await separateTaskConflict(d.adapter, "Daily.md", a, "Daily.CONFLICT.md", b);
    expect(d.files.size).toBe(2);
    expect(d.files.get("Daily.md")).toBe(a);
    expect(d.files.get(path)).toBe(b);
  });
});
