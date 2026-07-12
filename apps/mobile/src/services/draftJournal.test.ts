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
});
