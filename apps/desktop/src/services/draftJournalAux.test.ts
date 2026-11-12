import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The draft journal of an auxiliary window (multi-window P1, stability plan
 * R6): it owns no disk. Its snapshots are buffered and throttled like the
 * owner's, and each one goes to the owner over the window bus; a clear goes
 * the same way, with "force" carried as null.
 */

const requests: Array<[string, Record<string, unknown>]> = [];
vi.mock("./windowContext", () => ({ isOwnerWindow: () => false }));
vi.mock("./windowBus", () => ({
  getWindowBus: async () => ({
    request: async (command: string, args: Record<string, unknown>) => { requests.push([command, args]); },
  }),
}));
// An auxiliary window never writes the journal itself: any write command here is a failure.
vi.mock("@tauri-apps/api/core", () => ({ invoke: async (cmd: string) => { throw new Error(`no ${cmd} in an auxiliary window`); } }));
vi.mock("@tauri-apps/api/path", () => ({ appDataDir: async () => "APPDATA", join: async (...parts: string[]) => parts.join("/") }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: async () => false, mkdir: async () => {}, readTextFile: async () => "", remove: async () => {}, readDir: async () => [], stat: async () => ({ mtime: new Date() }),
}));

import { clearDraft, dropDraft, recordDraft, writeDraft } from "./draftJournal";

const V = "C:/vaults/main";

// Each test names its own note: the writer is the module's, and remembers when it last wrote a note.
beforeEach(() => { requests.length = 0; vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }); });
afterEach(() => { vi.useRealTimers(); });

describe("the draft journal of an auxiliary window", () => {
  it("hands its throttled snapshots to the owner, the newest text of each interval", async () => {
    let text = "a";
    writeDraft(V, "N.md", () => text, 1, "aux-editor");
    await vi.advanceTimersByTimeAsync(0);
    text = "ab";
    writeDraft(V, "N.md", () => text, 2, "aux-editor");
    text = "abc";
    writeDraft(V, "N.md", () => text, 3, "aux-editor");
    await vi.advanceTimersByTimeAsync(450);
    expect(requests.filter(([command]) => command === "draft-record").map(([, args]) => [args.text, args.revision])).toEqual([["a", 1], ["abc", 3]]);
  });

  it("drops a buffered snapshot whose editor let go of the note, and sends nothing for it", async () => {
    writeDraft(V, "N2.md", () => "first", 1, "aux-editor");
    await vi.advanceTimersByTimeAsync(0);
    writeDraft(V, "N2.md", () => null, 2, "aux-editor");
    await vi.advanceTimersByTimeAsync(450);
    expect(requests.map(([command, args]) => `${command}:${String(args.text)}`)).toEqual(["draft-record:first"]);
  });

  it("clears through the owner, with force carried as null, and takes back what it buffered", async () => {
    writeDraft(V, "N3.md", () => "first", 1, "aux-editor");
    await vi.advanceTimersByTimeAsync(0);
    writeDraft(V, "N3.md", () => "second", 2, "aux-editor");
    await clearDraft(V, "N3.md", Infinity, "aux-editor");
    await vi.advanceTimersByTimeAsync(450);
    expect(requests.map(([command]) => command)).toEqual(["draft-record", "draft-clear"]);
    expect(requests[1][1]).toMatchObject({ upToRevision: null, sessionId: "aux-editor" });
  });

  it("an immediate snapshot and a dropped buffer: the owner hears of the one, never of the other", async () => {
    await recordDraft(V, "N.md", "closing text", 4, "aux-editor");
    writeDraft(V, "M.md", () => "buffered", 1, "aux-editor");
    dropDraft(V, "M.md", "aux-editor");
    await vi.advanceTimersByTimeAsync(450);
    expect(requests.map(([command, args]) => `${command}:${String(args.notePath)}:${String(args.text)}`)).toEqual(["draft-record:N.md:closing text"]);
  });
});
