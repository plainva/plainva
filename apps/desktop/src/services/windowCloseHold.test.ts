// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The central window's half of "a window does not close over a changed draft
 * without asking" (finding 2026-10-09).
 *
 * The central window creates every other window and is the one that destroys
 * it: Tauri hands it the close request, and unless the handler refuses, the
 * window is gone. Until now it never refused — the frame's close button,
 * Alt+F4 and Cmd/Ctrl+W took a compose window with a whole written message
 * without a word. What is pinned here:
 *
 *  - a window that never said it holds anything closes exactly as before, and
 *    is not even asked;
 *  - a window that holds a changed draft is asked, kept, and brought back to
 *    the front (a registered tray icon has hidden it by then);
 *  - the answer that counts is the one given at the close, not an earlier one;
 *  - a window that does not answer can still be closed.
 *
 * The owner's real request handlers are installed (`installOwnerAppBus`), the
 * other window is a second bus on the same wire, and only the OS window is a
 * fake — one that hands the close handler back, which is all Tauri does.
 */

type CloseEvent = { prevented: boolean; preventDefault(): void };
type CloseHandler = (event: CloseEvent) => void | Promise<void>;

const os = vi.hoisted(() => ({
  handlers: new Map<string, (event: { prevented: boolean; preventDefault(): void }) => void | Promise<void>>(),
  /** What the owner asked the OS to do with a window, in order. */
  calls: [] as string[],
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: class {
    label: string;
    constructor(label: string) {
      this.label = label;
    }
    async onCloseRequested(handler: CloseHandler) {
      os.handlers.set(this.label, handler);
      return () => {};
    }
    async unminimize() {
      os.calls.push(`unminimize ${this.label}`);
    }
    async show() {
      os.calls.push(`show ${this.label}`);
    }
    async setFocus() {
      os.calls.push(`focus ${this.label}`);
    }
    static async getByLabel() {
      return null;
    }
  },
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ async unminimize() {}, async setFocus() {} }),
  availableMonitors: async () => [],
}));
vi.mock("./settingsStore", () => ({
  getSettingsStore: async () => ({ get: async () => undefined, set: async () => {}, save: async () => {} }),
}));
vi.mock("./draftJournal", () => ({ recordDraft: async () => {}, clearDraft: async () => {}, relocateDrafts: async () => {} }));
vi.mock("./saveFlush", () => ({ requestSaveFlush: async () => {} }));

import { createWindowBus, OWNER_LABEL, setWindowBusForTest, type BusTransport, type WindowBus } from "./windowBus";
import { installOwnerAppBus } from "./ownerBus";
import { CLOSE_ANSWER_TIMEOUT_MS, listAuxWindows, openAuxWindow, openComposeWindow, resetWindowRegistryForTest } from "./windowManager";
import { readComposeDraft, type ComposeSnapshot } from "./mail/composeHandoff";

function createWire() {
  const listeners = new Map<string, Set<{ label: string; fn: (p: unknown) => void }>>();
  return (label: string): BusTransport => ({
    label,
    async emit(event, payload) {
      for (const e of listeners.get(event) ?? []) e.fn(payload);
    },
    async emitTo(target, event, payload) {
      for (const e of listeners.get(event) ?? []) if (e.label === target) e.fn(payload);
    },
    async listen(event, handler) {
      const entry = { label, fn: handler };
      const set = listeners.get(event) ?? new Set();
      set.add(entry);
      listeners.set(event, set);
      return () => set.delete(entry);
    },
  });
}

const VAULT = "/vault";
const DRAFT: ComposeSnapshot = {
  accountId: "a1",
  fromAddress: "me@example.org",
  to: "anna@example.org",
  cc: "",
  bcc: "",
  showCc: false,
  subject: "Angebot",
  body: "Hallo Anna,",
  attachments: [],
  mailbox: "Drafts",
};

let wire: ReturnType<typeof createWire>;
let owner: WindowBus;
let disposeOwner: () => void;
const others: WindowBus[] = [];

/** The other window: it answers a close request with `holds()`, and counts how often it was asked. */
async function otherWindow(label: string, holds: () => boolean | "silent") {
  const bus = createWindowBus(wire(label));
  others.push(bus);
  const state = { asked: 0 };
  await bus.onBroadcast("close-requested", (payload) => {
    if (payload.label !== label) return;
    state.asked += 1;
    const answer = holds();
    if (answer !== "silent") void bus.request("window-close-hold", { held: answer });
  });
  return { bus, state, say: (held: boolean) => bus.request("window-close-hold", { held }) };
}

/** What Tauri does when a window's close is asked for: it calls the owner's handler. */
async function requestClose(label: string): Promise<CloseEvent> {
  const event: CloseEvent = {
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
  };
  await os.handlers.get(label)!(event);
  return event;
}

const isOpen = (label: string) => listAuxWindows().some((w) => w.label === label);

beforeEach(async () => {
  os.handlers.clear();
  os.calls.length = 0;
  window.localStorage.clear();
  resetWindowRegistryForTest();
  wire = createWire();
  owner = createWindowBus(wire(OWNER_LABEL));
  setWindowBusForTest(owner);
  disposeOwner = await installOwnerAppBus();
});

afterEach(async () => {
  vi.useRealTimers();
  disposeOwner();
  setWindowBusForTest(null);
  resetWindowRegistryForTest();
  await owner.dispose();
  for (const bus of others.splice(0)) await bus.dispose();
});

describe("a window that never said it holds anything", () => {
  it("closes as it always has, and is not asked", async () => {
    const { label } = await openComposeWindow({ vaultPath: VAULT, snapshot: DRAFT });
    const other = await otherWindow(label, () => true);

    const event = await requestClose(label);

    expect(event.prevented).toBe(false);
    expect(other.state.asked, "no round trip for a window with nothing to lose").toBe(0);
    expect(isOpen(label)).toBe(false);
    expect(readComposeDraft(label)).toBeNull();
    expect(os.calls).toEqual([]);
  });
});

describe("a window that holds a changed draft", () => {
  it("is asked, stays open, and comes back to the front", async () => {
    const { label } = await openComposeWindow({ vaultPath: VAULT, snapshot: DRAFT });
    const other = await otherWindow(label, () => true);
    await other.say(true);

    const event = await requestClose(label);

    expect(other.state.asked).toBe(1);
    expect(event.prevented, "the window is not destroyed over a changed draft").toBe(true);
    expect(isOpen(label)).toBe(true);
    // The draft it was opened with stays with it: the window is still there.
    expect(readComposeDraft(label)).toEqual(DRAFT);
    // The question must not be asked where nobody sees it: the close may have
    // come from the taskbar of a minimised window, and a registered tray icon
    // hides EVERY window on its close request.
    expect(os.calls).toEqual([`unminimize ${label}`, `show ${label}`, `focus ${label}`]);
  });

  it("closes once it let go — the writer said Discard", async () => {
    const { label } = await openComposeWindow({ vaultPath: VAULT, snapshot: DRAFT });
    const other = await otherWindow(label, () => true);
    await other.say(true);
    expect((await requestClose(label)).prevented).toBe(true);

    await other.say(false);
    const event = await requestClose(label);

    expect(event.prevented).toBe(false);
    expect(other.state.asked, "not asked again after it let go").toBe(1);
    expect(isOpen(label)).toBe(false);
    expect(readComposeDraft(label)).toBeNull();
  });

  it("closes when its answer AT THE CLOSE is that nothing is held any more", async () => {
    // A message that was just sent: the window closes itself in the same
    // breath, and "I let go" may still be on its way when the close arrives.
    const { label } = await openComposeWindow({ vaultPath: VAULT, snapshot: DRAFT });
    let holds = true;
    const other = await otherWindow(label, () => holds);
    await other.say(true);
    holds = false;

    const event = await requestClose(label);

    expect(other.state.asked).toBe(1);
    expect(event.prevented).toBe(false);
    expect(isOpen(label)).toBe(false);
  });

  it("covers every client window, not only the composer's own", async () => {
    // A floating composer inside a mail window: closing that window takes the
    // draft with it just the same.
    const { label } = await openAuxWindow({ role: "aux", vaultPath: VAULT, content: "plainva://mail" });
    const other = await otherWindow(label, () => true);
    await other.say(true);

    expect((await requestClose(label)).prevented).toBe(true);
    expect(isOpen(label)).toBe(true);
  });

  it("is kept by every close that arrives while the answer is awaited", async () => {
    // Two clicks on the close button before the window answered: the second
    // must not run out its own wait and destroy the window behind the first.
    const { label } = await openComposeWindow({ vaultPath: VAULT, snapshot: DRAFT });
    const other = await otherWindow(label, () => "silent");
    await other.say(true);

    const first = requestClose(label);
    const second = requestClose(label);
    await new Promise((r) => setTimeout(r, 0));
    await other.say(true);

    expect((await first).prevented).toBe(true);
    expect((await second).prevented).toBe(true);
    expect(isOpen(label)).toBe(true);
  });
});

describe("a window that does not answer", () => {
  it("is closed after the wait — nothing here can leave a window that cannot be closed", async () => {
    const { label } = await openComposeWindow({ vaultPath: VAULT, snapshot: DRAFT });
    const other = await otherWindow(label, () => "silent");
    await other.say(true);

    vi.useFakeTimers();
    const pending = requestClose(label);
    await vi.advanceTimersByTimeAsync(CLOSE_ANSWER_TIMEOUT_MS - 1);
    let done = false;
    void pending.then(() => (done = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(done, "the close waits for the answer first").toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const event = await pending;
    expect(event.prevented).toBe(false);
    expect(isOpen(label)).toBe(false);
  });
});
