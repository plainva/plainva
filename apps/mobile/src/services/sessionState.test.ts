import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialNavState, pushEntry, type NavState } from "../navigation";
import {
  flushNavSave,
  markSessionReady,
  parseNavState,
  readNavState,
  resetSessionState,
  restoreNavState,
  scheduleNavSave,
  serializeNavState,
  sessionKey,
  writeNavState,
} from "./sessionState";

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

/** Build-91 feedback, P6: the navigation the user left comes back. */
describe("sessionState", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    resetSessionState();
    vi.useRealTimers();
  });

  const session = (): NavState => {
    let s = initialNavState("notes");
    s = pushEntry(s, { kind: "folder", path: "Inbox" });
    s = pushEntry(s, { kind: "base", path: "Zettel.base", configOpen: true });
    s = { ...s, activeTab: "today" };
    s = pushEntry(s, { kind: "note", path: "Tagebuch/26.08.31.md" });
    return s;
  };

  it("round-trips the stacks, the tab and the overlay — without the moment's flags", () => {
    const parsed = parseNavState(serializeNavState(session()))!;
    expect(parsed.activeTab).toBe("today");
    expect(parsed.stacks.notes.map((e) => e.path)).toEqual(["Inbox", "Zettel.base"]);
    expect(parsed.stacks.today.map((e) => e.path)).toEqual(["Tagebuch/26.08.31.md"]);
    expect((parsed.stacks.notes[1] as { configOpen?: boolean }).configOpen).toBeUndefined();
  });

  it("drops unfinished input except the note, unknown kinds and garbage", () => {
    const raw = JSON.stringify({
      activeTab: "notes",
      stacks: {
        notes: [
          { kind: "sync", path: "" },
          { kind: "securitywizard", path: "" },
          { kind: "note", path: "a.md" },
          { kind: "teleport", path: "x" },
          { kind: "base" },
          null,
        ],
      },
      overlay: [{ kind: "mailcompose", path: "" }, { kind: "settings", path: "" }],
    });
    const parsed = parseNavState(raw)!;
    expect(parsed.stacks.notes).toEqual([{ kind: "note", path: "a.md" }]);
    expect(parsed.overlay).toEqual([{ kind: "settings", path: "" }]);
    expect(parseNavState("{not json")).toBeNull();
    expect(parseNavState(JSON.stringify({ activeTab: "nowhere", stacks: {} }))).toBeNull();
    expect(parseNavState(null)).toBeNull();
  });

  it("restores only what still exists and keeps the tab inside the bar", async () => {
    const onDisk = new Set(["Inbox", "Tagebuch/26.08.31.md"]);
    const stored = parseNavState(serializeNavState(session()))!;
    const next = (await restoreNavState(stored, { exists: async (p) => onDisk.has(p), visible: ["notes", "calendar"] }))!;
    expect(next.activeTab).toBe("notes"); // "today" is not in the bar
    expect(next.stacks.notes.map((e) => e.path)).toEqual(["Inbox"]); // the base is gone
    expect(next.stacks.today.map((e) => e.path)).toEqual(["Tagebuch/26.08.31.md"]);
  });

  it("the root folder needs no file, a throwing exists counts as gone, nothing left is null", async () => {
    let s = initialNavState("notes");
    s = pushEntry(s, { kind: "folder", path: "" });
    s = pushEntry(s, { kind: "note", path: "gone.md" });
    const next = (await restoreNavState(s, {
      exists: async (p) => {
        if (p === "gone.md") throw new Error("io");
        return true;
      },
      visible: ["notes"],
    }))!;
    expect(next.stacks.notes).toEqual([{ kind: "folder", path: "" }]);
    expect(await restoreNavState(initialNavState("notes"), { exists: async () => true, visible: ["notes"] })).toBeNull();
  });

  it("writes debounced, never before the stored session was read, and flushes on demand", () => {
    const storage = fakeStorage();
    scheduleNavSave("local", session(), storage);
    vi.advanceTimersByTime(1000);
    expect(storage.map.has(sessionKey("local"))).toBe(false); // not ready: the boot state must not clobber
    markSessionReady("local");
    scheduleNavSave("local", session(), storage);
    expect(storage.map.has(sessionKey("local"))).toBe(false);
    vi.advanceTimersByTime(300);
    expect(readNavState("local", storage)?.activeTab).toBe("today");
    scheduleNavSave("local", initialNavState("notes"), storage);
    flushNavSave(storage);
    expect(readNavState("local", storage)?.activeTab).toBe("notes");
  });

  it("read/write are symmetric and tolerate a missing storage", () => {
    const storage = fakeStorage();
    writeNavState("v", session(), storage);
    expect(readNavState("v", storage)?.stacks.notes).toHaveLength(2);
    expect(readNavState("v", null)).toBeNull();
    writeNavState("v", session(), null); // no throw
  });
});
