// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A window that goes takes no typing with it (A7).
 *
 * An editor saves a second after the last keystroke; until then what was typed
 * lives in the editor and in the draft journal's buffer, which writes at most
 * every 400 ms. A window that is destroyed in between lost that buffer: the
 * owner destroyed an auxiliary window as soon as its close was asked for, and
 * the only flush was the page's `pagehide`, which nothing waited for. Pinned
 * here, with the owner's real request handlers (`installOwnerAppBus`), the
 * other window as a second bus on the same wire and the OS window as a fake:
 *
 *  - the window's buffered snapshot reaches the journal BEFORE the window is
 *    destroyed;
 *  - a window that never buffered a draft is not asked and waits for nothing;
 *  - a window that does not answer is still closed, after a moment;
 *  - the way out of the app (`flushAllDraftsBeforeLeaving`) asks every window
 *    that buffered a draft, and only those.
 */

type CloseEvent = { prevented: boolean; preventDefault(): void };
type CloseHandler = (event: CloseEvent) => void | Promise<void>;

const os = vi.hoisted(() => ({ handlers: new Map<string, CloseHandler>() }));
const journal = vi.hoisted(() => ({ recorded: [] as string[], ownFlushes: 0 }));

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
    async unminimize() {}
    async show() {}
    async setFocus() {}
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
vi.mock("./draftJournal", () => ({
  recordDraft: async (_vault: string, path: string, text: string) => {
    journal.recorded.push(`${path}:${text}`);
  },
  clearDraft: async () => {},
  relocateDrafts: async () => {},
  flushDrafts: async () => {
    journal.ownFlushes += 1;
  },
}));
vi.mock("./saveFlush", () => ({ requestSaveFlush: async () => {} }));

import { createWindowBus, OWNER_LABEL, setWindowBusForTest, type BusTransport, type WindowBus } from "./windowBus";
import { installOwnerAppBus } from "./ownerBus";
import { listAuxWindows, openAuxWindow, resetWindowRegistryForTest } from "./windowManager";
import { WINDOW_FLUSH_WAIT_MS, resetWindowDraftFlushForTest } from "./windowDraftFlush";
import { flushAllDraftsBeforeLeaving } from "./leaveFlush";

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
let wire: ReturnType<typeof createWire>;
let owner: WindowBus;
let disposeOwner: () => void;
const others: WindowBus[] = [];

/**
 * The other window, as its draft journal behaves: the first snapshot of the
 * typing went to the owner at once, the newest one is still in its buffer.
 * Asked to flush, it sends that one and then answers — or stays silent.
 */
async function typingWindow(label: string, options: { typed: boolean; buffered?: string; silent?: boolean }) {
  const bus = createWindowBus(wire(label));
  others.push(bus);
  const state = { asked: 0 };
  await bus.onBroadcast("drafts-flush", ({ id, labels }) => {
    if (labels !== null && !labels.includes(label)) return;
    state.asked += 1;
    if (options.silent) return;
    void (async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      if (options.buffered !== undefined) {
        await bus.request("draft-record", { vaultPath: VAULT, notePath: `${label}.md`, text: options.buffered, revision: 2, sessionId: "e" });
      }
      await bus.request("drafts-flushed", { id });
    })();
  });
  if (options.typed) await bus.request("draft-record", { vaultPath: VAULT, notePath: `${label}.md`, text: "Hel", revision: 1, sessionId: "e" });
  return state;
}

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
  journal.recorded.length = 0;
  journal.ownFlushes = 0;
  window.localStorage.clear();
  resetWindowRegistryForTest();
  resetWindowDraftFlushForTest();
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

describe("closing a window right after typing", () => {
  it("writes what the window still buffers before the window is destroyed", async () => {
    const { label } = await openAuxWindow({ role: "aux", vaultPath: VAULT, content: "N.md" });
    await typingWindow(label, { typed: true, buffered: "Hello" });

    const event = await requestClose(label);

    expect(event.prevented).toBe(false);
    expect(isOpen(label)).toBe(false);
    // Before: only the first snapshot of the typing was in the journal, the
    // newest went with the window.
    expect(journal.recorded).toEqual([`${label}.md:Hel`, `${label}.md:Hello`]);
  });

  it("does not ask, nor wait for, a window that never buffered a draft", async () => {
    const { label } = await openAuxWindow({ role: "aux", vaultPath: VAULT, content: "N.md" });
    const state = await typingWindow(label, { typed: false, buffered: "never" });
    vi.useFakeTimers();

    // No timer has to run out for it: the close goes through at once.
    let closed = false;
    void requestClose(label).then(() => {
      closed = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(closed).toBe(true);

    expect(state.asked).toBe(0);
    expect(isOpen(label)).toBe(false);
  });

  it("still closes a window that does not answer, after a moment", async () => {
    const { label } = await openAuxWindow({ role: "aux", vaultPath: VAULT, content: "N.md" });
    const state = await typingWindow(label, { typed: true, silent: true });
    vi.useFakeTimers();

    let closed = false;
    const closing = requestClose(label).then(() => {
      closed = true;
    });
    await vi.advanceTimersByTimeAsync(WINDOW_FLUSH_WAIT_MS - 100);
    expect(closed, "it waits for the window's answer").toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    await closing;

    expect(state.asked).toBe(1);
    expect(isOpen(label)).toBe(false);
  });

  it("asks a window that was closed once no more on the way out", async () => {
    const { label } = await openAuxWindow({ role: "aux", vaultPath: VAULT, content: "N.md" });
    const state = await typingWindow(label, { typed: true, buffered: "Hello" });
    await requestClose(label);
    vi.useFakeTimers();

    let done = false;
    void flushAllDraftsBeforeLeaving().then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(done, "nobody left to wait for").toBe(true);

    expect(state.asked).toBe(1);
  });
});

describe("the way out of the app", () => {
  it("writes the central window's buffer and that of every window that typed", async () => {
    const a = await openAuxWindow({ role: "aux", vaultPath: VAULT, content: "A.md" });
    const b = await openAuxWindow({ role: "aux", vaultPath: VAULT, content: "B.md" });
    const c = await openAuxWindow({ role: "aux", vaultPath: VAULT, content: "C.md" });
    await typingWindow(a.label, { typed: true, buffered: "Hello A" });
    await typingWindow(b.label, { typed: true, buffered: "Hello B" });
    const quiet = await typingWindow(c.label, { typed: false });

    await flushAllDraftsBeforeLeaving();

    expect(journal.ownFlushes).toBe(1);
    expect(journal.recorded).toEqual(expect.arrayContaining([`${a.label}.md:Hello A`, `${b.label}.md:Hello B`]));
    expect(quiet.asked).toBe(0);
  });
});
