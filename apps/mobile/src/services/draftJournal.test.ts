import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
vi.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA" },
  Encoding: { UTF8: "utf8" },
  Filesystem: {
    writeFile: vi.fn(async ({ path, data }: { path: string; data: string }) => {
      store.set(path, data);
    }),
    readFile: vi.fn(async ({ path }: { path: string }) => {
      if (!store.has(path)) throw new Error("not found");
      return { data: store.get(path)! };
    }),
    deleteFile: vi.fn(async ({ path }: { path: string }) => {
      store.delete(path);
    }),
    readdir: vi.fn(async () => ({ files: [] })),
  },
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false },
  registerPlugin: () => ({}),
}));

import { clearDraft, readDraft, writeDraft } from "./draftJournal";

const vault = { vaultId: "local" } as any;

describe("draftJournal (M3E package G)", () => {
  beforeEach(() => {
    store.clear();
  });

  it("journals a scheduled text and reads it back", async () => {
    writeDraft(vault, "Inbox/Note.md", "hello draft");
    await new Promise((r) => setTimeout(r, 10)); // first write is immediate
    const d = await readDraft(vault, "Inbox/Note.md");
    expect(d?.text).toBe("hello draft");
    expect(typeof d?.ts).toBe("number");
  });

  it("throttles bursts but persists the LATEST text", async () => {
    writeDraft(vault, "a.md", "v1");
    writeDraft(vault, "a.md", "v2");
    writeDraft(vault, "a.md", "v3");
    await new Promise((r) => setTimeout(r, 500)); // past the 400ms throttle
    const d = await readDraft(vault, "a.md");
    expect(d?.text).toBe("v3");
  });

  it("clearDraft drops the journal entry (confirmed write)", async () => {
    writeDraft(vault, "b.md", "text");
    await new Promise((r) => setTimeout(r, 10));
    clearDraft(vault, "b.md");
    await new Promise((r) => setTimeout(r, 10));
    expect(await readDraft(vault, "b.md")).toBeNull();
  });

  it("keeps a draft that is newer than the write being confirmed (finding 2026-08-19)", async () => {
    writeDraft(vault, "c.md", "saved text", 1);
    await new Promise((r) => setTimeout(r, 10));
    // The user types on while the save is in flight...
    writeDraft(vault, "c.md", "typed while saving", 2);
    await new Promise((r) => setTimeout(r, 500));

    // ...and the older write comes back confirmed. Dropping the draft here
    // would throw away exactly the keystrokes the journal exists for.
    clearDraft(vault, "c.md", 1);
    await new Promise((r) => setTimeout(r, 10));
    expect((await readDraft(vault, "c.md"))?.text).toBe("typed while saving");

    // The confirmation for the newer text does clear it.
    clearDraft(vault, "c.md", 2);
    await new Promise((r) => setTimeout(r, 10));
    expect(await readDraft(vault, "c.md")).toBeNull();
  });

  it("discarding by hand forces the drop regardless of revision", async () => {
    writeDraft(vault, "d.md", "text", 7);
    await new Promise((r) => setTimeout(r, 10));
    clearDraft(vault, "d.md");
    await new Promise((r) => setTimeout(r, 10));
    expect(await readDraft(vault, "d.md")).toBeNull();
  });

  it("never writes the journal through a plain file write (finding 2026-08-19)", async () => {
    // A source guard, not a behaviour probe: on the web dev server the atomic
    // helper falls back to Filesystem.writeFile itself (IndexedDB commits
    // transactionally there), so no runtime assertion can tell the two apart.
    // What must hold is the CALL SITE — on a device the plain write is the one
    // a crash can tear in half.
    const src = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("./draftJournal.ts", import.meta.url), "utf8"),
    );
    expect(src).toContain("atomicWriteText(");
    expect(src).not.toContain("Filesystem.writeFile");
  });
});
