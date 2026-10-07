// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { DevicePimPort } from "@plainva/core";
import {
  foldMachineText,
  formatTaskSync,
  installCompositionEnterGuard,
  isCompositionEnter,
  isMachinePurpose,
  machineFieldProps,
  timedDevicePimPort,
  type TaskSyncReport,
} from "@plainva/ui";

/**
 * Three small rules from the store feedback of 2026-09/10 (plan Befunde
 * 2026-10-06, T4 and T5): the Enter of an input method is not a submit, an
 * address typed on a Japanese keyboard is still an address, and the way from a
 * task to the provider leaves lines a tester can export.
 */

const key = (init: KeyboardEventInit & { keyCode?: number }) => {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  if (init.keyCode !== undefined) Object.defineProperty(event, "keyCode", { get: () => init.keyCode });
  return event;
};

describe("the Enter that confirms a composition", () => {
  it("is recognised by isComposing, and by key code 229 where WebKit reports it late", () => {
    expect(isCompositionEnter({ key: "Enter", isComposing: true, keyCode: 13 })).toBe(true);
    expect(isCompositionEnter({ key: "Enter", isComposing: false, keyCode: 229 })).toBe(true);
    expect(isCompositionEnter({ key: "Enter", isComposing: false, keyCode: 13 })).toBe(false);
    expect(isCompositionEnter({ key: "a", isComposing: true, keyCode: 229 })).toBe(false);
  });

  it("never reaches a handler, while an ordinary Enter and every other key do", () => {
    const uninstall = installCompositionEnterGuard(window);
    const input = document.createElement("input");
    document.body.append(input);
    const seen: string[] = [];
    input.addEventListener("keydown", (e) => seen.push(`${e.key}:${e.isComposing}`));
    document.addEventListener("keydown", () => seen.push("document"));
    try {
      input.dispatchEvent(key({ key: "Enter", isComposing: true }));
      input.dispatchEvent(key({ key: "Enter", keyCode: 229 }));
      expect(seen).toEqual([]);
      input.dispatchEvent(key({ key: "Enter", keyCode: 13 }));
      expect(seen).toEqual(["Enter:false", "document"]);
      seen.length = 0;
      input.dispatchEvent(key({ key: "k", isComposing: true, keyCode: 229 }));
      expect(seen).toEqual(["k:true", "document"]);
    } finally {
      uninstall();
      input.remove();
    }
  });

  it("does not take the key's own effect away, and leaves the editor to itself", () => {
    const uninstall = installCompositionEnterGuard(window);
    const editor = document.createElement("div");
    editor.className = "cm-content";
    const line = document.createElement("div");
    editor.append(line);
    const input = document.createElement("input");
    document.body.append(editor, input);
    const inEditor = vi.fn();
    editor.addEventListener("keydown", inEditor);
    try {
      const confirm = key({ key: "Enter", isComposing: true });
      input.dispatchEvent(confirm);
      // The input method still gets its Enter: only listeners are skipped.
      expect(confirm.defaultPrevented).toBe(false);
      line.dispatchEvent(key({ key: "Enter", isComposing: true }));
      expect(inEditor).toHaveBeenCalledTimes(1);
    } finally {
      uninstall();
      editor.remove();
      input.remove();
    }
  });

  it("is gone after uninstall", () => {
    const uninstall = installCompositionEnterGuard(window);
    uninstall();
    const input = document.createElement("input");
    document.body.append(input);
    const seen = vi.fn();
    input.addEventListener("keydown", seen);
    input.dispatchEvent(key({ key: "Enter", isComposing: true }));
    expect(seen).toHaveBeenCalledTimes(1);
    input.remove();
  });
});

describe("text a machine reads", () => {
  // Built from code points: the test must not depend on how an editor or a
  // patch tool treats full-width characters.
  const wide = (ascii: string) => [...ascii].map((ch) => (ch === " " ? String.fromCodePoint(0x3000) : String.fromCodePoint(ch.codePointAt(0)! + 0xfee0))).join("");

  it("folds full-width forms to the ASCII they stand for", () => {
    expect(foldMachineText(wide("https://cloud.example.com/dav"))).toBe("https://cloud.example.com/dav");
    expect(foldMachineText(wide(" AKIA1234_key-id "))).toBe("AKIA1234_key-id");
    // The ideographic full stop is what a Japanese keyboard types for ".".
    expect(foldMachineText(`s3${String.fromCodePoint(0x3002)}example${String.fromCodePoint(0x3002)}com`)).toBe("s3.example.com");
  });

  it("keeps everything that is not a full-width form", () => {
    const folder = String.fromCodePoint(0x30ce, 0x30fc, 0x30c8); // "note" in katakana
    expect(foldMachineText(`https://cloud.example.com/${folder}/`)).toBe(`https://cloud.example.com/${folder}/`);
    expect(foldMachineText("  plain.example.org  ")).toBe("plain.example.org");
    expect(foldMachineText("")).toBe("");
  });

  it("tells the keyboard not to capitalise or correct addresses, keys and code - and nothing else", () => {
    for (const purpose of ["address", "secret", "code"] as const) {
      expect(isMachinePurpose(purpose)).toBe(true);
      expect(machineFieldProps(purpose)).toEqual({ autoCapitalize: "none", autoCorrect: "off" });
    }
    for (const purpose of ["prose", "name", "search", "number"] as const) {
      expect(isMachinePurpose(purpose)).toBe(false);
      expect(machineFieldProps(purpose)).toEqual({});
    }
  });
});

const report = (over: Partial<TaskSyncReport> = {}): TaskSyncReport => ({
  createdNotes: [], changedNotes: [], adoptedNotes: [], deferredCreates: 0, pushed: 0, conflicts: 0, deletedRemote: 0, deletedNotes: [], errors: [], ...over,
});

describe("the reconcile line of the diagnostics log", () => {
  it("says nothing when the reconcile had nothing to do", () => {
    expect(formatTaskSync(report(), 12, true)).toBeNull();
  });

  it("counts what it did and never names a note", () => {
    const line = formatTaskSync(report({ pushed: 2, createdNotes: ["Tasks/Call the dentist.md"], changedNotes: ["Tasks/a.md", "Tasks/b.md"] }), 240.4, true)!;
    expect(line).toBe("240 ms, pushed to provider 2, notes created 1, notes changed 2");
    expect(line).not.toContain("dentist");
  });

  it("explains a deferred creation and carries the first error without the path of its address", () => {
    expect(formatTaskSync(report({ deferredCreates: 3 }), 5, false)).toBe("5 ms, creations deferred 3, vault not settled yet");
    expect(formatTaskSync(report({ errors: ["PUT https://caldav.example.com/dav/user@example.com/list/1.ics 412", "second"] }), 80, true))
      .toBe("80 ms, 2 errors: PUT https://caldav.example.com/… 412");
    expect(formatTaskSync(report({ paused: true }), 1, true)).toBe("paused (task notes are being renamed)");
  });
});

describe("the device store with a stopwatch", () => {
  const port = (over: Partial<DevicePimPort> = {}): DevicePimPort => ({
    supportsReminders: true,
    listCollections: async () => [],
    events: async () => [],
    event: async () => null,
    createEvent: async () => ({}) as never,
    updateEvent: async () => ({}) as never,
    deleteEvent: async () => {},
    reminders: async () => [{}, {}] as never,
    reminder: async () => null,
    createReminder: async () => ({ id: "r1" }) as never,
    updateReminder: async () => ({ id: "r1" }) as never,
    deleteReminder: async () => {},
    ...over,
  });
  const clock = () => {
    let t = 0;
    return () => (t += 50);
  };

  it("logs every reminder call with its duration and the store's answer, and passes the value through", async () => {
    const lines: string[] = [];
    const timed = timedDevicePimPort(port(), (line) => lines.push(line), clock());
    expect(await timed.reminders("list")).toHaveLength(2);
    await timed.createReminder("list", { title: "Secret title" } as never);
    await timed.updateReminder("r1", { title: "Secret title" } as never);
    expect(await timed.reminder("gone")).toBeNull();
    await timed.deleteReminder("r1");
    expect(lines).toEqual([
      "reminders read: 50 ms, 2 items",
      "reminder create: 50 ms, ok",
      "reminder update: 50 ms, ok",
      "reminder read: 50 ms, not found",
      "reminder delete: 50 ms, ok",
    ]);
    expect(lines.join("\n")).not.toContain("Secret");
    expect(timed.supportsReminders).toBe(true);
  });

  it("logs a refusal with the store's words and still throws it", async () => {
    const lines: string[] = [];
    const timed = timedDevicePimPort(port({ updateReminder: async () => { throw new Error("reminder not found"); } }), (line) => lines.push(line), clock());
    await expect(timed.updateReminder("r1", {} as never)).rejects.toThrow("reminder not found");
    expect(lines).toEqual(["reminder update: 50 ms, refused: reminder not found"]);
  });

  it("leaves event reads untimed - the cycle line counts those", async () => {
    const lines: string[] = [];
    const timed = timedDevicePimPort(port(), (line) => lines.push(line), clock());
    await timed.events("cal", 0, 1);
    await timed.listCollections();
    expect(lines).toEqual([]);
  });
});
