// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { setPlatformServices } from "@plainva/ui";
import { MailComposeScreen } from "./screens/MailComposeScreen";
import { currentMobileDialog, dismissMobileDialog, type MobileDialog } from "./services/mobileDialogs";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * "Insert template" in the phone's composer (Sammelplan § 3.97, Nr. 7 and 9).
 *
 * The composer filled the template twice: once with nothing but its title — a
 * question became nothing, its default too, the clipboard and the week start
 * never arrived — and then through the pipeline with questions, which found
 * nothing left to ask and resolved what the first pass had left as text. The
 * handbook says the questions are asked once, in one sheet (Email_Capture.md).
 * The desktop's composer had the same two passes
 * (`apps/desktop/src/components/mail/composeTemplate.test.tsx`).
 */

const BOM = String.fromCharCode(0xfeff);
/** A template written on Windows by a program that sets a byte order mark. */
const TEMPLATE = `${BOM}---\r\ntype: Note\r\n---\r\nHallo {{prompt:Name|Welt}}, bis {{weekday:monday}}.\r\nSo schreibt man einen Platzhalter: \\{{date}}\r\n`;

const mocks = vi.hoisted(() => ({
  read: vi.fn(async (_path: string) => ""),
}));

vi.mock("./services/mail/mailRuntime", () => ({
  listMobileMailAccounts: vi.fn(async () => [{ id: "m1", label: "anna@example.org", host: "imap.example.org", port: 993, smtpHost: "smtp.example.org", smtpPort: 587, user: "anna@example.org", kind: "imap" }]),
  mailVaultId: () => "/vault",
}));
vi.mock("./screens/mail/MailComposeEditor", async () => {
  const { TextArea } = await import("@plainva/ui");
  return {
    MailComposeEditor: ({ value, onChange }: { value: string; onChange: (next: string) => void }) => (
      <TextArea data-testid="compose-body" value={value} onChange={(e) => onChange(e.target.value)} />
    ),
  };
});
vi.mock("@plainva/ui/mail", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendMail: vi.fn(async () => undefined),
  appendDraft: vi.fn(async () => undefined),
  listMailboxesFor: vi.fn(async () => [{ name: "Entwürfe", role: "drafts" }]),
}));
vi.mock("./services/vaultService", () => ({
  getMobileVault: async () => ({
    adapter: {
      exists: async (path: string) => path === "Templates",
      listDir: async () => [{ path: "Templates/Brief.md", isDirectory: false }],
    },
    files: { readTextFile: mocks.read },
  }),
}));
vi.mock("./services/vaultRegistry", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getActiveVaultEntry: async () => ({ id: "v1", name: "Notizen" }),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  mocks.read.mockImplementation(async () => TEMPLATE);
  // Sunday, 2026-10-11, with the week starting on Sunday: its Monday is the 12th.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 11, 9, 30));
  setPlatformServices({
    loadSettings: async () => ({ get: async (key: string) => (key === "calendarWeekStart" ? "sunday" : null) }),
    credentials: {},
    openExternal: async () => {},
  } as never);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  for (let open = currentMobileDialog(); open; open = currentMobileDialog()) dismissMobileDialog(open);
  act(() => root.unmount());
  container.remove();
  setPlatformServices(null as never);
  vi.useRealTimers();
});

/** Waits until the next sheet is on screen, and hands it over. */
async function nextSheet(kind: MobileDialog["kind"]): Promise<MobileDialog> {
  for (let i = 0; i < 50; i++) {
    const open = currentMobileDialog();
    if (open?.kind === kind) return open;
    await act(async () => {});
  }
  throw new Error(`no "${kind}" sheet opened (on screen: ${currentMobileDialog()?.kind ?? "nothing"})`);
}

describe("insert template in the phone's composer", () => {
  it("asks the template's questions once, with their defaults, and fills the rest in the one pass", async () => {
    await act(async () => {
      root.render(<MailComposeScreen draft={{ accountId: "", to: "", subject: "Angebot", body: "" }} onBack={() => {}} onDone={() => {}} vault={{ vaultId: "/vault" } as never} />);
    });
    await act(async () => {});
    await act(async () => container.querySelector<HTMLElement>('[data-testid="compose-insert-template"]')!.click());

    const pick = await nextSheet("target");
    await act(async () => {
      (pick as Extract<MobileDialog, { kind: "target" }>).resolve("Templates/Brief.md");
      dismissMobileDialog(pick);
    });
    expect(mocks.read).toHaveBeenCalledWith("Templates/Brief.md");

    // Until 2026-10-22 no sheet came: the question had been answered with nothing.
    const asked = (await nextSheet("answers")) as Extract<MobileDialog, { kind: "answers" }>;
    expect(asked.fields).toEqual([{ label: "Name", kind: "text", defaultValue: "Welt" }]);
    await act(async () => {
      asked.resolve({ Name: "Ben" });
      dismissMobileDialog(asked);
    });
    await act(async () => {});

    // The template's properties and its byte order mark stay out; the week
    // starts where the setting says; the escaped date stays as written.
    expect(container.querySelector<HTMLTextAreaElement>('[data-testid="compose-body"]')!.value).toBe(
      "Hallo Ben, bis 2026-10-12.\nSo schreibt man einen Platzhalter: {{date}}\n"
    );
  });
});
