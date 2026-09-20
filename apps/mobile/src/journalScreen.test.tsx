// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toast, type JournalFiles } from "@plainva/ui";
import en from "../../../packages/ui/src/locales/en.json";
import { JournalScreen } from "./screens/JournalScreen";

/**
 * The journal screen of the phone (plan Journal, J5). The stream, the rows and
 * what an action does are shared and pinned in the desktop package
 * (`journalSurfaces.test.tsx`); this pins the phone's own wiring around them:
 * the sheet that lists the row's actions, the pen, the button that saves an
 * edit, and the re-read after an own write. The run against the production
 * bundle is `e2e-prod/journal.spec.ts`.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("react-i18next", async () => {
  const data = (await import("../../../packages/ui/src/locales/en.json")).default;
  const lookup = (key: string): unknown => key.split(".").reduce<unknown>((obj, k) => (obj as Record<string, unknown>)?.[k], data);
  return { initReactI18next: { type: "3rdParty", init() {} }, useTranslation: () => ({ i18n: { language: "en" },
    t: (key: string, vars?: Record<string, unknown>) => {
      const plural = typeof vars?.count === "number" ? lookup(`${key}_${vars.count === 1 ? "one" : "other"}`) : undefined;
      const value = plural ?? lookup(key);
      return Object.entries(vars ?? {}).reduce((text, [k, v]) => text.split(`{{${k}}}`).join(String(v)), typeof value === "string" ? value : key);
    },
  }) };
});

const NOTE = "# Saturday\n\n## Journal\n\n- 09:12 Called the workshop #client\n- [ ] 10:30 Order the spare part\n";
const store = new Map<string, string>();
const reads: string[] = [];
const writeListeners = new Set<(path: string) => void>();

const files: JournalFiles = {
  ensureDailyNote: async () => null,
  readTextFile: async (path) => {
    reads.push(path);
    const hit = store.get(path);
    if (hit === undefined) throw new Error(`ENOENT ${path}`);
    return hit;
  },
  writeTextFile: async (path, content) => { store.set(path, content); },
};

vi.mock("./services/journalService", () => ({
  journalFiles: () => files,
  journalHeading: () => "Journal",
  journalFailureText: (reason: string) => `refused:${reason}`,
  onJournalWrite: (listener: (path: string) => void) => { writeListeners.add(listener); return () => { writeListeners.delete(listener); }; },
}));
vi.mock("./services/mobileSettings", () => ({ getMobileSettings: () => ({ dailyFolder: "", dailyFormat: "YYYY-MM-DD", weekStart: "monday" }) }));
vi.mock("./services/vaultService", () => ({
  vaultOps: { read: (_vault: unknown, path: string) => files.readTextFile(path), resolveWikiTarget: async () => null },
}));
vi.mock("@capacitor/browser", () => ({ Browser: { open: vi.fn(async () => undefined) } }));

const vault = { vaultId: "v1", adapter: {}, queryService: { listNotes: async () => [...store.keys()].map((path) => ({ path })) } } as never;

let host: HTMLDivElement;
let root: Root;
const all = (testId: string) => [...host.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`)];
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

async function mount(props: Partial<React.ComponentProps<typeof JournalScreen>> = {}) {
  const onNewEntry = vi.fn();
  const onOpenNote = vi.fn();
  await act(async () => { root.render(<JournalScreen vault={vault} bump={0} onBack={vi.fn()} onOpenNote={onOpenNote} onNewEntry={onNewEntry} {...props} />); });
  await settle();
  return { onNewEntry, onOpenNote };
}

beforeEach(() => {
  store.clear();
  reads.length = 0;
  writeListeners.clear();
  store.set("2026-09-19.md", NOTE);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  toast.clearAll();
});

describe("JournalScreen", () => {
  it("shows the stream with a one-line day heading, and its pen asks the app for the capture sheet", async () => {
    const { onNewEntry } = await mount();
    expect(all("journal-day")).toHaveLength(1);
    expect(all("journal-entry")).toHaveLength(2);
    // Compact: a short date and no count, so the heading stays one line beside "open note".
    expect(all("journal-day")[0].textContent).not.toContain("entries");
    await act(async () => { all("journal-new-entry")[0].click(); });
    expect(onNewEntry).toHaveBeenCalledOnce();
  });

  it("lists in its sheet what the desktop's menu lists, the destructive one last, and runs it through the shared write path", async () => {
    await mount();
    const plain = all("journal-entry").find((row) => row.textContent?.includes("Called the workshop"))!;
    await act(async () => { plain.querySelector<HTMLElement>('[data-testid="journal-entry-menu"]')!.click(); });
    const sheet = host.querySelector(".m-sheet")!;
    expect([...sheet.querySelectorAll("button.m-row")].map((button) => button.textContent)).toEqual([
      en.journal.edit, en.common.copy, en.journal.toTask, en.journal.showInNote, en.common.delete,
    ]);
    await act(async () => { all("journal-ctx-toTask")[0].click(); });
    await settle();
    expect(host.querySelector(".m-sheet")).toBeNull();
    expect(store.get("2026-09-19.md")).toContain("- [ ] 09:12 Called the workshop #client");
    expect(all("journal-entry-toggle")).toHaveLength(2);
  });

  it("offers a task entry its box and the way back instead", async () => {
    await mount();
    const task = all("journal-entry").find((row) => row.textContent?.includes("Order the spare part"))!;
    await act(async () => { task.querySelector<HTMLElement>('[data-testid="journal-entry-menu"]')!.click(); });
    expect(all("journal-ctx-toggle")).toHaveLength(1);
    expect(all("journal-ctx-toEntry")).toHaveLength(1);
    expect(all("journal-ctx-toTask")).toHaveLength(0);
  });

  it("saves an edit with a button — Enter stays a line break on a soft keyboard", async () => {
    await mount();
    const plain = all("journal-entry").find((row) => row.textContent?.includes("Called the workshop"))!;
    await act(async () => { plain.querySelector<HTMLElement>('[data-testid="journal-entry-menu"]')!.click(); });
    await act(async () => { all("journal-ctx-edit")[0].click(); });
    const field = all("journal-edit-input")[0] as HTMLTextAreaElement;
    expect(field.value).toBe("Called the workshop #client");
    // The entry keeps its time: the editor shows it, not "now".
    expect(all("journal-edit-time")[0].getAttribute("datetime")).toBe("09:12");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, "Called the workshop twice");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
    await settle();
    expect(store.get("2026-09-19.md")).toBe(NOTE);
    await act(async () => { all("journal-edit-save")[0].click(); });
    await settle();
    expect(store.get("2026-09-19.md")).toContain("- 09:12 Called the workshop twice");
    expect(all("journal-entry-editing")).toHaveLength(0);
  });

  it("reads only the written day again when the capture sheet — hosted by the app — wrote into it", async () => {
    store.set("2026-09-18.md", "## Journal\n\n- 08:00 the day before\n");
    await mount();
    expect(all("journal-day")).toHaveLength(2);
    reads.length = 0;
    store.set("2026-09-19.md", `${NOTE}- 11:00 written elsewhere\n`);
    await act(async () => { writeListeners.forEach((listener) => listener("2026-09-19.md")); });
    await settle();
    expect(reads).toEqual(["2026-09-19.md"]);
    expect(all("journal-entry")).toHaveLength(4);
  });

  it("says so when there is nothing yet, and the empty state leads to the first entry", async () => {
    store.clear();
    const { onNewEntry } = await mount();
    expect(host.textContent).toContain(en.journal.emptyTitle);
    const start = [...host.querySelectorAll("button")].find((button) => button.textContent === en.journal.newEntry)!;
    await act(async () => { start.click(); });
    expect(onNewEntry).toHaveBeenCalledOnce();
  });
});
