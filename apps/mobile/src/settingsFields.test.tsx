// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import ts from "typescript";
import { FIELD_DRAFT_DELAY_MS } from "@plainva/ui";

/**
 * Settings fields keep the caret and every key (TestFlight 2026-09-22, Build
 * 115, E23).
 *
 * Typing in "Date format" moved the caret to the end after every key, and two
 * quick keys lost the first. The field was bound to the stored value, and the
 * store only changes after an asynchronous save: between a key and its
 * acknowledgement React put the OLD text back. This drives the real screen
 * with a save that takes its time — the way the phone's store does.
 */

const store = vi.hoisted(() => {
  const defaults = {
    dailyFolder: "Daily", inboxFolder: "Inbox", attachmentFolder: "", templateFolder: "Templates",
    dailyTemplate: "", taskDatabase: "", dayEndsAt: 0, dailyFormat: "YYYY-MM-DD", dailyNoteType: "",
    journalMoodProperty: "", journalHeading: "", defaultNoteType: "", verifierName: "",
    folderTemplates: [], typeTemplates: [], commentNotify: false, commentNotifyLevel: "mentions",
    commentNotifyPrivate: true, contentFontSize: 16,
  };
  return {
    defaults,
    live: { ...defaults } as Record<string, unknown>,
    writes: [] as Array<Record<string, unknown>>,
    pendingAcks: [] as Array<() => void>,
    failNext: false,
  };
});

vi.mock("./services/mobileSettings", () => ({
  getMobileSettings: () => ({ ...store.live }),
  // Like the real store: the cache changes only once the write is acknowledged.
  updateMobileSettings: (patch: Record<string, unknown>) =>
    new Promise<void>((resolve, reject) => {
      store.writes.push(patch);
      const fail = store.failNext;
      store.failNext = false;
      store.pendingAcks.push(() => {
        if (fail) { reject(new Error("store refused")); return; }
        Object.assign(store.live, patch);
        window.dispatchEvent(new CustomEvent("m-settings-changed"));
        resolve();
      });
    }),
}));
vi.mock("./services/vaultService", () => ({ getMobileVault: vi.fn() }));
vi.mock("./services/syncService", () => ({ deletionLogChecker: vi.fn() }));
vi.mock("react-i18next", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "en" } }),
}));

import { ContentAreaScreen } from "./screens/SettingsAreaScreens";
import { useSettingsState } from "./hooks/useSettingsState";
import type { MobileVault } from "./services/vaultService";

const VAULT = { vaultId: "v", adapter: {}, files: {}, queryService: null } as unknown as MobileVault;
const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;

/** A key the way the WebView delivers it: the DOM text changes, then `input`. */
function edit(el: HTMLInputElement, next: string, caret: number) {
  inputSetter.call(el, next);
  el.setSelectionRange(caret, caret);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}
function typeAt(el: HTMLInputElement, text: string) {
  const at = el.selectionStart ?? el.value.length;
  edit(el, el.value.slice(0, at) + text + el.value.slice(at), at + text.length);
}
async function ackAll() {
  while (store.pendingAcks.length) await act(async () => { store.pendingAcks.shift()!(); });
}

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(async () => {
  vi.useFakeTimers();
  store.live = { ...store.defaults };
  store.writes = [];
  store.pendingAcks = [];
  store.failNext = false;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root.render(<ContentAreaScreen vault={VAULT} onBack={() => {}} />); });
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
  vi.useRealTimers();
});

const field = () => host.querySelector<HTMLInputElement>('[data-testid="daily-format"]')!;

describe("a settings field while its save is in flight (E23)", () => {
  it("keeps the caret where a letter was deleted in the middle", async () => {
    const el = field();
    el.focus();
    el.setSelectionRange(4, 4);
    // Backspace after "YYYY": the caret belongs at 3, not at the end.
    await act(async () => { edit(el, "YYY-MM-DD", 3); });
    expect(el.value).toBe("YYY-MM-DD");
    expect(el.selectionStart).toBe(3);
  });

  it("keeps two quick keys", async () => {
    const el = field();
    el.focus();
    el.setSelectionRange(10, 10);
    await act(async () => { typeAt(el, " "); });
    await act(async () => { typeAt(el, "d"); });
    expect(el.value).toBe("YYYY-MM-DD d");
    await act(async () => { vi.advanceTimersByTime(FIELD_DRAFT_DELAY_MS); });
    await ackAll();
    expect(store.live.dailyFormat).toBe("YYYY-MM-DD d");
    expect(el.value).toBe("YYYY-MM-DD d");
  });

  it("normalizes when saving, never under the caret", async () => {
    const el = field();
    el.focus();
    el.setSelectionRange(10, 10);
    await act(async () => { typeAt(el, "/"); });
    // What was typed stays while typing; the file-name sanitizer applies on save.
    expect(el.value).toBe("YYYY-MM-DD/");
    await act(async () => { el.blur(); });
    await ackAll();
    expect(store.live.dailyFormat).toBe("YYYY-MM-DD-");
    expect(el.value).toBe("YYYY-MM-DD-");
  });

  it("saves once after a pause, not once per key", async () => {
    const el = field();
    el.focus();
    el.setSelectionRange(10, 10);
    for (const ch of "abc") await act(async () => { typeAt(el, ch); });
    expect(store.writes).toHaveLength(0);
    await act(async () => { vi.advanceTimersByTime(FIELD_DRAFT_DELAY_MS); });
    expect(store.writes).toEqual([{ dailyFormat: "YYYY-MM-DDabc" }]);
    await ackAll();
  });

  it("takes over a change from elsewhere while the field is not in use", async () => {
    await act(async () => {
      store.live.dailyFormat = "DD.MM.YYYY";
      window.dispatchEvent(new CustomEvent("m-settings-changed"));
    });
    expect(field().value).toBe("DD.MM.YYYY");
  });

  it("clears a folder without refilling it under the thumb", async () => {
    const folder = [...host.querySelectorAll("label.pv-rowfield")]
      .find((row) => row.textContent?.includes("mobile.settingDailyFolder"))!
      .querySelector<HTMLInputElement>("input")!;
    expect(folder.value).toBe("Daily");
    folder.focus();
    await act(async () => { edit(folder, "", 0); });
    expect(folder.value).toBe("");
    await act(async () => { typeAt(folder, "Jo"); });
    expect(folder.value).toBe("Jo");
    await act(async () => { folder.blur(); });
    await ackAll();
    expect(store.live.dailyFolder).toBe("Jo");
  });
});

describe("the settings state is optimistic (E23)", () => {
  function Probe() {
    const { settings, update } = useSettingsState();
    return (
      <>
        <output>{String(settings.contentFontSize)}</output>
        {[17, 18, 20].map((n) => <button data-size={n} key={n} onClick={() => void update({ contentFontSize: n })} type="button" />)}
      </>
    );
  }
  const size = () => host.querySelector("output")!.textContent;
  const press = (n: number) => host.querySelector<HTMLButtonElement>(`[data-size="${n}"]`)!.click();

  beforeEach(async () => {
    await act(async () => { root.render(<Probe />); });
  });

  it("shows a change at once and does not step back through older acknowledgements", async () => {
    await act(async () => { press(17); });
    expect(size()).toBe("17");
    await act(async () => { press(18); });
    // The first write lands while the second is still in flight: the slider
    // must not jump back to 17 under the thumb.
    await act(async () => { store.pendingAcks.shift()!(); });
    expect(size()).toBe("18");
    await ackAll();
    expect(size()).toBe("18");
  });

  it("falls back to the stored value when the save fails", async () => {
    store.failNext = true;
    await act(async () => { press(20); });
    expect(size()).toBe("20");
    await ackAll();
    expect(size()).toBe("16");
  });
});

/** Every non-test source file of the shell, relative to src/. */
function sources(): Array<readonly [string, string]> {
  const SRC = join(process.cwd(), "src");
  const out: Array<readonly [string, string]> = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push([p.slice(SRC.length + 1).replace(/\\/g, "/"), readFileSync(p, "utf8")] as const);
    }
  };
  walk(SRC);
  return out;
}

describe("no settings field is bound to the stored value (E23)", () => {
  it("a text field that shows a stored setting types into its own draft", () => {
    // A `value={settings.x}` on a text control is exactly the binding that lost
    // the caret: the store answers asynchronously. Use CommittedTextInput or
    // FolderField, which own a draft and save after a pause, on blur and on
    // Enter. Sliders and switches may show the setting — the optimistic hook
    // puts their value in place at once.
    const TEXT = new Set(["TextInput", "input", "textarea", "TextArea"]);
    const offenders: string[] = [];
    for (const [file, src] of sources()) {
      if (!src.includes("settings.")) continue;
      const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const visit = (node: ts.Node) => {
        if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
          const tag = node.tagName.getText(sf);
          const attrs = new Map<string, string>();
          for (const a of node.attributes.properties) {
            if (ts.isJsxAttribute(a)) attrs.set(a.name.getText(sf), a.initializer?.getText(sf) ?? "");
          }
          const type = attrs.get("type")?.replace(/["{}]/g, "");
          const value = attrs.get("value") ?? "";
          if (TEXT.has(tag) && !["range", "checkbox", "radio"].includes(type ?? "") && /^\{\s*settings\./.test(value)) {
            offenders.push(`${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    expect(offenders).toEqual([]);
  });

  it("the settings state is kept in ONE optimistic hook", () => {
    // Three screens had their own copy that set the state only after the save —
    // the slider snapped back while the write was in flight.
    const copies = sources()
      .filter(([file, src]) => file !== "hooks/useSettingsState.ts" && /updateMobileSettings\([^)]*\)\s*\.then\(\s*\(\)\s*=>\s*setSettings\(/.test(src))
      .map(([file]) => file);
    expect(copies).toEqual([]);
    const bound = sources()
      .filter(([, src]) => /value=\{settings\.\w+\}/.test(src) && /useState\(\s*(\(\)\s*=>\s*)?getMobileSettings\(\)\s*\)/.test(src))
      .map(([file]) => file);
    expect(bound, "use useSettingsState()").toEqual([]);
  });
});
