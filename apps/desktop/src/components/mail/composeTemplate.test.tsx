// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { setPlatformServices, type TemplateRequest } from "@plainva/ui";

/**
 * "Insert template" in the desktop's composer (Sammelplan § 3.97, Nr. 7 and 9).
 *
 * The composer filled the template twice: once with nothing but its title — a
 * question became nothing, its default too, the clipboard and the week start
 * never arrived — and then through the pipeline with questions, which found
 * nothing left to ask and resolved what the first pass had left as text. The
 * handbook says the questions are asked once, in one dialog (Email_Capture.md).
 * The phone's composer had the same two passes (`apps/mobile/src/mailComposeTemplate.test.tsx`).
 */

const BOM = String.fromCharCode(0xfeff);
/** A template written on Windows by a program that sets a byte order mark. */
const TEMPLATE = `${BOM}---\r\ntype: Note\r\n---\r\nHallo {{prompt:Name|Welt}}, bis {{weekday:monday}}.\r\nSo schreibt man einen Platzhalter: \\{{date}}\r\n`;

const mocks = vi.hoisted(() => ({ read: vi.fn(async (_path: string) => "") }));

vi.mock("@tauri-apps/plugin-store", () => {
  const load = vi.fn(async () => ({ get: async () => null }));
  return { Store: { load }, load };
});
vi.mock("../../contexts/VaultContext", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useVault: () => ({ vaultPath: "/vault", vaultAdapter: { readTextFile: mocks.read } }),
}));
vi.mock("./ComposeEditor", () => ({
  ComposeEditor: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea data-testid="draft-body" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
// The picker hands over the template a person picked.
vi.mock("../TemplatePickerModal", () => ({
  TemplatePickerModal: ({ onPick }: { onPick: (path: string) => void }) => (
    <button type="button" data-testid="pick-template" onClick={() => onPick("Vorlagen/Brief.md")} />
  ),
}));
vi.mock("@plainva/ui/mail", async () => {
  const actual = await vi.importActual<typeof import("@plainva/ui/mail")>("@plainva/ui/mail");
  // A composer without an account shows no body and no toolbar.
  const imap = { id: "i1", label: "Work", host: "imap.example.org", port: 993, user: "me@example.org", smtpHost: "smtp.example.org" };
  return { ...actual, listMailAccounts: async () => [imap], listMailboxesFor: async () => [{ name: "Drafts", role: "drafts" }] };
});

import { dialogStore, settleDialog } from "../../services/appDialogs";
import { MailDraftModal } from "./MailDraftModal";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let asked: TemplateRequest[][];
let stopAnswering: () => void;

beforeEach(() => {
  mocks.read.mockImplementation(async () => TEMPLATE);
  // Sunday, 2026-10-11, with the week starting on Sunday: its Monday is the 12th.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 11, 9, 30));
  setPlatformServices({
    loadSettings: async () => ({
      get: async <T,>(key: string): Promise<T | undefined> => (key === "calendarWeekStart" ? ("sunday" as T) : undefined),
      set: async () => {},
      delete: async () => true,
      keys: async () => [],
      save: async () => {},
    }),
    credentials: { readSecret: async <T,>() => ({ pass: "secret" }) as T, writeSecret: async () => {}, removeSecret: async () => {} },
    openExternal: async () => {},
  });
  asked = [];
  stopAnswering = dialogStore.subscribe(() => {
    const req = dialogStore.get();
    if (req?.type !== "answers") return;
    asked.push(req.fields);
    settleDialog(req.id, { Name: "Ben" });
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  stopAnswering();
  act(() => root.unmount());
  container.remove();
  dialogStore.clearAll();
  setPlatformServices(null as never);
  vi.useRealTimers();
});

const byTestId = <T extends HTMLElement>(id: string) => document.querySelector(`[data-testid="${id}"]`) as T | null;
async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

describe("insert template in the desktop's composer", () => {
  it("asks the template's questions once, with their defaults, and fills the rest in the one pass", async () => {
    act(() => root.render(<MailDraftModal subject="Angebot" markdown="" onClose={() => {}} />));
    await settle();
    await act(async () => byTestId("draft-insert-template")!.click());
    await settle();
    await act(async () => byTestId("pick-template")!.click());
    for (let i = 0; i < 20 && byTestId<HTMLTextAreaElement>("draft-body")!.value === ""; i++) await settle();

    expect(mocks.read).toHaveBeenCalledWith("Vorlagen/Brief.md");
    // Until 2026-10-22 no dialog came: the question had been answered with nothing.
    expect(asked).toEqual([[{ label: "Name", kind: "text", defaultValue: "Welt" }]]);
    // The template's properties and its byte order mark stay out; the week
    // starts where the setting says; the escaped date stays as written.
    expect(byTestId<HTMLTextAreaElement>("draft-body")!.value).toBe("Hallo Ben, bis 2026-10-12.\nSo schreibt man einen Platzhalter: {{date}}\n");
  });
});
