// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// In-memory doubles for the tauri fs/path/ipc surface the journal touches.
const files = new Map<string, string>();
const invokeMock = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
  if (cmd === "register_write_root") return "root-1";
  if (cmd === "checked_read_text_file") return files.get(`APPDATA/drafts/${args?.relPath as string}`) ?? null;
  if (cmd === "write_file_atomic") {
    files.set(`APPDATA/drafts/${args?.relPath as string}`, args?.contents as string);
    return undefined;
  }
  throw new Error(`unexpected invoke ${cmd}`);
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invokeMock(...(a as [string, Record<string, unknown>])) }));
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: async () => "APPDATA",
  join: async (...parts: string[]) => parts.join("/"),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: async (p: string) => files.has(p) || p === "APPDATA/drafts" || [...files.keys()].some((k) => k.startsWith(`${p}/`)),
  mkdir: async () => {},
  readTextFile: async (p: string) => {
    const c = files.get(p);
    if (c === undefined) throw new Error(`missing ${p}`);
    return c;
  },
  remove: vi.fn(async (p: string) => { files.delete(p); }),
  readDir: async (dir: string) =>
    [...files.keys()].filter((k) => k.startsWith(`${dir}/`) && !k.slice(dir.length + 1).includes("/"))
      .map((k) => ({ name: k.slice(dir.length + 1), isDirectory: false })),
  stat: async () => ({ mtime: new Date() }),
}));

import i18n from "@plainva/ui/i18n";
import { toast, toastStore, waitWithDeadline } from "@plainva/ui";
import { flushDrafts, forgetDraftMemory, offerDraft, writeDraft } from "./draftJournal";

/**
 * Text 4 on the desktop: a close that gives up waiting for a save goes on,
 * says that the note's text lies in the draft, and that text is offered at
 * the next open. The journal is written before the wait (`flushDrafts`,
 * bounded, at the head of the teardown's drain), so a save that never
 * answers cannot take the text with it.
 */

const VAULT = "C:/vaults/main";
afterEach(() => {
  toast.clearAll();
  vi.useRealTimers();
});

describe("a close that gives up on a save, on the desktop", () => {
  beforeEach(async () => {
    files.clear();
    await i18n.changeLanguage("en");
  });

  it("goes on after the deadline, says the text is in the draft, and the text is offered at the next open", async () => {
    writeDraft(VAULT, "Inbox/Plan.md", "typed and not saved", 3, "run-1");
    const hangingSave = new Promise<void>(() => undefined);

    await flushDrafts(VAULT);
    vi.useFakeTimers();
    const waited = waitWithDeadline(hangingSave, () => ({ kind: "saving", names: ["Plan"] }));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(toastStore.get().map((t) => t.message), "the notice names what it waits for").toContain(i18n.t("closing.savingWait", { name: "Plan" }));
    await vi.advanceTimersByTimeAsync(25_000);
    expect(await waited).toBe("gave-up");
    expect(toastStore.get().map((t) => t.message)).toContain(i18n.t("closing.savingGaveUp", { name: "Plan" }));
    vi.useRealTimers();

    // The vault goes (`teardownVault`); the next open, another run, reads the journal from disk.
    forgetDraftMemory(VAULT);
    const offer = await offerDraft(VAULT, "Inbox/Plan.md", "the file as it was", "run-2");
    expect(offer?.text).toBe("typed and not saved");
  });
});
