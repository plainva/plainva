import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The device switch reaches the web view's own checker (B11, Linux): WebKitGTK
 * checks only while src-tauri has its checker on, and drops the red lines it
 * drew only when it is switched off again. So the desktop reports the shared
 * rule's state to `set_webview_spellcheck` at start and on every change.
 */

const store = new Map<string, unknown>();
let storeFails = false;
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./settingsStore", () => ({
  getSettingsStore: async () => {
    if (storeFails) throw new Error("store unreadable");
    return {
      get: async (key: string) => store.get(key),
      set: async (key: string, value: unknown) => void store.set(key, value),
      save: async () => {},
    };
  },
}));
vi.mock("./appearanceSync", () => ({ notifyAppearanceChanged: vi.fn() }));

async function load() {
  vi.resetModules();
  const { invoke } = await import("@tauri-apps/api/core");
  vi.mocked(invoke).mockClear();
  vi.mocked(invoke).mockResolvedValue(undefined);
  const ui = await import("@plainva/ui");
  ui.setSpellcheckOn(false);
  const service = await import("./spellcheck");
  return { invoke: vi.mocked(invoke), ui, service };
}

const reported = (invoke: ReturnType<typeof vi.fn>) =>
  invoke.mock.calls.filter(([cmd]) => cmd === "set_webview_spellcheck").map(([, args]) => (args as { on: boolean }).on);

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the spell-checking switch and the web view's checker", () => {
  beforeEach(() => {
    store.clear();
    storeFails = false;
  });

  it("reports nothing before the store is read, then off when nothing is stored", async () => {
    const { invoke, service } = await load();
    service.initSpellcheck();
    expect(reported(invoke)).toEqual([]);
    await settle();
    expect(reported(invoke)).toEqual([false]);
  });

  it("reports exactly on when the stored switch is on - a new window never switches the others off first", async () => {
    store.set("spellcheck", true);
    const { invoke, service } = await load();
    service.initSpellcheck();
    await settle();
    expect(reported(invoke)).toEqual([true]);
  });

  it("reports nothing when the store cannot be read", async () => {
    storeFails = true;
    const { invoke, service, ui } = await load();
    service.initSpellcheck();
    await settle();
    expect(reported(invoke)).toEqual([]);
    expect(ui.isSpellcheckOn()).toBe(false);
  });

  it("follows the switch both ways, so switching off clears WebKit's markers", async () => {
    const { invoke, service } = await load();
    service.initSpellcheck();
    await settle();
    await service.setStoredSpellcheck(true);
    await service.setStoredSpellcheck(false);
    expect(reported(invoke)).toEqual([false, true, false]);
    expect(store.get("spellcheck")).toBe(false);
  });

  it("subscribes once per window, however often the switch is read again", async () => {
    store.set("spellcheck", true);
    const { invoke, service, ui } = await load();
    service.initSpellcheck();
    // A second window's change makes this one read the store again.
    service.initSpellcheck();
    await settle();
    ui.setSpellcheckOn(false);
    expect(reported(invoke)).toEqual([true, false]);
  });

  it("keeps the page's rule when the host refuses the command", async () => {
    const { invoke, service, ui } = await load();
    invoke.mockRejectedValue(new Error("command set_webview_spellcheck not found"));
    service.initSpellcheck();
    await settle();
    await service.setStoredSpellcheck(true);
    expect(invoke).toHaveBeenCalledWith("set_webview_spellcheck", { on: true });
    expect(ui.isSpellcheckOn()).toBe(true);
    expect(store.get("spellcheck")).toBe(true);
    await settle();
    expect(service.getWebviewSpellStatus()).toBeNull();
  });

  it("keeps what the checker loaded while on, and forgets it when off", async () => {
    const { invoke, service } = await load();
    invoke.mockImplementation(async (_cmd: string, args?: unknown) =>
      (args as { on: boolean }).on ? { languages: [], appImage: false } : null,
    );
    service.initSpellcheck();
    await settle();
    await service.setStoredSpellcheck(true);
    await settle();
    expect(service.getWebviewSpellStatus()).toEqual({ languages: [], appImage: false });
    await service.setStoredSpellcheck(false);
    await settle();
    expect(service.getWebviewSpellStatus()).toBeNull();
  });
});

describe("the line under the switch", () => {
  it("appears only while on and with no dictionary loaded", async () => {
    const { service } = await load();
    const none = { languages: [], appImage: false };
    expect(service.spellcheckHint(true, none)).toBe("noDictionary");
    expect(service.spellcheckHint(false, none)).toBeNull();
    expect(service.spellcheckHint(true, { languages: ["de_DE"], appImage: false })).toBeNull();
    // Windows, macOS, the phone, an older binary: the host says nothing.
    expect(service.spellcheckHint(true, null)).toBeNull();
  });

  it("names the AppImage's limit instead of the dictionary", async () => {
    const { service } = await load();
    expect(service.spellcheckHint(true, { languages: [], appImage: true })).toBe("appImage");
    expect(service.spellcheckHint(true, { languages: ["en_US"], appImage: true })).toBeNull();
  });
});
