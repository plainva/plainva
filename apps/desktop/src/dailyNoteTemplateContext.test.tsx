// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { setPlatformServices, type JournalFiles, type TemplateRequest } from "@plainva/ui";

const storeValues: Record<string, unknown> = {};
vi.mock("@tauri-apps/plugin-store", () => {
  const load = vi.fn(async () => ({ get: async (key: string) => storeValues[key] }));
  return { Store: { load }, load };
});
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn(async () => true), open: vi.fn() }));

const VAULT = "/vault";
const files = new Map<string, string>();
const vaultAdapter = {
  exists: async (path: string) => files.has(path),
  readTextFile: async (path: string) => {
    const text = files.get(path);
    if (text === undefined) throw new Error(`no such file: ${path}`);
    return text;
  },
  writeTextFile: async (path: string, text: string) => void files.set(path, text),
  createDir: async () => {},
};
vi.mock("./contexts/VaultContext", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useVault: () => ({ vaultPath: VAULT, vaultAdapter, indexer: null, triggerFileTreeUpdate: () => {} }),
}));

import { dailyNoteTemplateKey, dailyNotesFolderKey, dailyNotesFormatKey, templateFolderKey } from "./contexts/VaultContext";
import { useDailyNoteAction } from "./hooks/useDailyNoteAction";
import { useJournalFiles } from "./hooks/useJournal";
import { dialogStore, settleDialog } from "./services/appDialogs";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The desktop's daily note and the template it is made from, at the two places
 * that make one (Sammelplan § 3.97, findings 2026-10-11).
 *
 * The button and the calendar (`useDailyNoteAction`) handed the template the
 * daily links and the vault's name, and nothing that comes from the device:
 * `{{weekday:…}}` counted from Monday whatever "Week starts on" says, and
 * `{{clipboard}}` came out empty without the question the handbook promises.
 * The journal capture (`useJournalFiles`) handed no week start either. Every
 * way that creates a note from a template now takes its context from the one
 * pipeline, so the hooks are driven here as the app mounts them.
 *
 * The date is Sunday, 2026-10-11, and the week starts on Sunday: its Monday is
 * the 12th. With Monday as the start it would be the 5th.
 */

const TEMPLATE = "{{daily-1}} · {{date}} · {{daily+1}}\nMontag: {{weekday:monday}}\nAblage: {{clipboard}}\nVault: {{vault}}\n";
const SUNDAY = new Date(2026, 9, 11);
const PATH = "Journal/2026-10-11.md";

let container: HTMLDivElement;
let root: Root;
let asked: TemplateRequest[][];
let stopAnswering: () => void;
let readClipboard: ReturnType<typeof vi.fn>;

beforeEach(() => {
  files.clear();
  files.set("Vorlagen/Tag.md", TEMPLATE);
  for (const key of Object.keys(storeValues)) delete storeValues[key];
  storeValues[dailyNotesFolderKey(VAULT)] = "Journal";
  storeValues[dailyNotesFormatKey(VAULT)] = "YYYY-MM-DD";
  storeValues[templateFolderKey(VAULT)] = "Vorlagen";
  storeValues[dailyNoteTemplateKey(VAULT)] = "Tag.md";
  setPlatformServices({
    loadSettings: async () => ({ get: async (key: string) => (key === "calendarWeekStart" ? "sunday" : storeValues[key] ?? null) }),
    credentials: {},
    openExternal: async () => {},
  } as never);
  readClipboard = vi.fn(async () => "aus der Ablage");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { readText: readClipboard } });
  // The person answers every question with what it offers.
  asked = [];
  stopAnswering = dialogStore.subscribe(() => {
    const req = dialogStore.get();
    if (req?.type !== "answers") return;
    asked.push(req.fields);
    settleDialog(req.id, Object.fromEntries(req.fields.map((field) => [field.label, field.defaultValue ?? ""])));
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  stopAnswering();
  act(() => root.unmount());
  container.remove();
  setPlatformServices(null as never);
});

describe("the desktop's daily note gets what its template names", () => {
  it("opened from the button or the calendar: the week start, and the clipboard as a question", async () => {
    let openDaily: ((date: Date) => Promise<void>) | null = null;
    const opened: string[] = [];
    function Probe() {
      openDaily = useDailyNoteAction((path) => opened.push(path));
      return null;
    }
    await act(async () => root.render(<Probe />));
    await act(async () => openDaily!(SUNDAY));

    expect(opened).toEqual([PATH]);
    expect(readClipboard).toHaveBeenCalledTimes(1);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toEqual([expect.objectContaining({ kind: "text", defaultValue: "aus der Ablage" })]);
    expect(files.get(PATH)).toBe(
      "---\ntype: Daily Note\n---\n[[Journal/2026-10-10]] · 2026-10-11 · [[Journal/2026-10-12]]\nMontag: 2026-10-12\nAblage: aus der Ablage\nVault: vault\n"
    );
  });

  it("created on the way by the journal capture: the week start, and no question", async () => {
    let journal: JournalFiles | null = null;
    function Probe() {
      journal = useJournalFiles();
      return null;
    }
    await act(async () => root.render(<Probe />));
    await act(async () => {
      await journal!.ensureDailyNote(SUNDAY);
    });

    // A capture never asks; the clipboard is not read for a note nobody looks at.
    expect(asked).toEqual([]);
    expect(readClipboard).not.toHaveBeenCalled();
    expect(files.get(PATH)).toBe(
      "---\ntype: Daily Note\n---\n[[Journal/2026-10-10]] · 2026-10-11 · [[Journal/2026-10-12]]\nMontag: 2026-10-12\nAblage: \nVault: vault\n"
    );
  });
});
