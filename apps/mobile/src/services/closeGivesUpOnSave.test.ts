// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    stat: vi.fn(async ({ path }: { path: string }) => {
      if (!store.has(path)) throw new Error("not found");
      return { type: "file", size: store.get(path)!.length, mtime: Date.now() };
    }),
    readdir: vi.fn(async ({ path }: { path: string }) => ({
      files: [...store.keys()]
        .filter((k) => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes("/"))
        .map((k) => ({ name: k.slice(path.length + 1), type: "file", mtime: Date.now() })),
    })),
  },
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false, getPlatform: () => "web" },
  registerPlugin: () => ({}),
}));


import i18n from "@plainva/ui/i18n";
import { toast, toastStore, waitWithDeadline } from "@plainva/ui";
import { flushDraftsBeforeClosing, forgetDraftMemory, offerDraft, writeDraft } from "./draftJournal";

/**
 * Text 4 on the phone: a close, switch or reload that gives up waiting for a
 * save goes on, says that the note's text lies in the draft, and that text is
 * offered at the next open. The journal is written before the wait
 * (`flushDraftsBeforeClosing`, bounded), so a save that never answers
 * cannot take the text with it.
 */

const vault = { vaultId: "local" } as never;
afterEach(() => {
  toast.clearAll();
  vi.useRealTimers();
});

describe("a close that gives up on a save, on the phone", () => {
  beforeEach(async () => {
    store.clear();
    await i18n.changeLanguage("en");
  });

  it("goes on after the deadline, says the text is in the draft, and the text is offered at the next open", async () => {
    // The person typed; the save of it never answers (a folder provider that hangs).
    writeDraft(vault, "Inbox/Plan.md", "typed and not saved", 3);
    const hangingSave = new Promise<void>(() => undefined);

    await flushDraftsBeforeClosing(vault);
    vi.useFakeTimers();
    const waited = waitWithDeadline(hangingSave, () => ({ kind: "saving", names: ["Plan"] }));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(toastStore.get().map((t) => t.message), "the notice names what it waits for").toContain(i18n.t("closing.savingWait", { name: "Plan" }));
    await vi.advanceTimersByTimeAsync(25_000);
    expect(await waited).toBe("gave-up");
    expect(toastStore.get().map((t) => t.message)).toContain(i18n.t("closing.savingGaveUp", { name: "Plan" }));
    vi.useRealTimers();

    // The vault goes; the next open reads the journal from disk.
    forgetDraftMemory("local");
    const offer = await offerDraft(vault, "Inbox/Plan.md", "the file as it was");
    expect(offer?.text).toBe("typed and not saved");
  });
});
