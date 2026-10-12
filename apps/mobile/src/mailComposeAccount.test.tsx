// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MailComposeScreen, type MailDraft } from "./screens/MailComposeScreen";
import { resetLeaveGuard } from "./services/leaveGuard";
import { currentMobileDialog, dismissMobileDialog } from "./services/mobileDialogs";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Which mailbox the composer starts from (finding 2026-10-09).
 *
 * The desktop composer took the first mailbox that is stored, whatever the
 * draft came from; a reply to a message in the second mailbox went out under
 * the first one's address and signature. The phone did not have that fault —
 * a draft names its mailbox (`MailDraft.accountId`), and the composer starts
 * there — but no test said so, and the two shells are meant to do the same.
 *
 * This is the composer's half: it starts with the mailbox the draft names,
 * signs for it and sends from it, and it falls back to the first mailbox where
 * the draft names none (a note sent by mail) or the named one is gone. That
 * the reader and the list name the right mailbox is held by the built app in
 * `e2e-prod/mail-sender.spec.ts`; the routes in between by `mailRoutes.test.ts`.
 * The desktop's half is `components/mail/composeStartAccount.test.tsx` there.
 */

const mocks = vi.hoisted(() => ({
  accounts: [] as unknown[],
  sendMail: vi.fn(async (..._args: unknown[]) => undefined),
}));

vi.mock("./services/mail/mailRuntime", () => ({
  listMobileMailAccounts: vi.fn(async () => mocks.accounts),
  mailVaultId: () => "/vault",
}));
// The shared Markdown editor is CodeMirror; what matters here is the text it is given.
vi.mock("./screens/mail/MailComposeEditor", async () => {
  const { TextArea } = await import("@plainva/ui");
  return {
    MailComposeEditor: ({ value, onChange }: { value: string; onChange: (next: string) => void }) => (
      <TextArea data-testid="compose-body" value={value} onChange={(e) => onChange(e.target.value)} />
    ),
  };
});
vi.mock("./components/AttachPickSheet", () => ({ AttachPickSheet: () => null }));
vi.mock("@plainva/ui/mail", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendMail: mocks.sendMail,
  appendDraft: vi.fn(async () => undefined),
  listMailboxesFor: vi.fn(async () => [{ name: "Entwürfe", role: "drafts" }]),
}));

// Two mailboxes that sign differently, so neither can stand in for the other.
const work = { id: "work", label: "Work", host: "imap.example.org", port: 993, smtpHost: "smtp.example.org", smtpPort: 587, user: "me@example.org", kind: "imap", signature: "Signed at work" };
const home = { id: "home", label: "Home", host: "imap.example.net", port: 993, smtpHost: "smtp.example.net", smtpPort: 587, user: "me@example.net", kind: "imap", signature: "Signed at home" };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  mocks.accounts = [work, home];
  mocks.sendMail.mockClear();
  resetLeaveGuard();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  const open = currentMobileDialog();
  if (open) dismissMobileDialog(open);
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const vault = { vaultId: "/vault", files: {} } as never;

async function open(draft: MailDraft) {
  await act(async () => {
    root.render(<MailComposeScreen draft={draft} onBack={() => {}} onDone={() => {}} vault={vault} />);
  });
  // The account list arrives a tick later, and the sender and signature with it.
  await act(async () => {});
}

/** The address under "From" — the row is there because there is more than one sender to choose from. */
const from = () => container.querySelector(".m-settings > button.m-row small")?.textContent ?? "";
const body = () => container.querySelector<HTMLTextAreaElement>('[data-testid="compose-body"]')?.value ?? "";
const times = (text: string, part: string) => text.split(part).length - 1;

/** A reply as the reader hands it over: a recipient, a subject, a quoted original — and the mailbox the message is in. */
const reply = (accountId: string): MailDraft => ({ accountId, to: "anna@example.org", subject: "Re: Invoice", body: "\n\nOn Monday Anna wrote:\n\n> Attached." });

describe("the mailbox the composer starts from", () => {
  it("is the one the draft names, with that mailbox's signature", async () => {
    await open(reply("home"));

    expect(from()).toBe("me@example.net");
    expect(times(body(), "Signed at home")).toBe(1);
    expect(body()).not.toContain("Signed at work");
  });

  it("is the mailbox the message is sent from", async () => {
    vi.useFakeTimers();
    await open(reply("home"));

    await act(async () => (container.querySelector("button.pv-btn--primary") as HTMLButtonElement).click());
    // The undo window passes; then the message is handed over.
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(mocks.sendMail).toHaveBeenCalledTimes(1);
    const [, account, to, subject, text, , , , , sender] = mocks.sendMail.mock.calls[0];
    expect(account).toMatchObject({ id: "home", user: "me@example.net" });
    expect({ to, subject, sender }).toEqual({ to: "anna@example.org", subject: "Re: Invoice", sender: "me@example.net" });
    expect(text).toContain("Signed at home");
    expect(text).not.toContain("Signed at work");
  });

  it("is the first one stored where the draft names none — a note sent by mail", async () => {
    await open({ accountId: "", to: "", subject: "Offer", body: "" });

    expect(from()).toBe("me@example.org");
    expect(body()).toContain("Signed at work");
    expect(body()).not.toContain("Signed at home");
  });

  it("is the first one stored when the named mailbox is gone", async () => {
    await open(reply("removed"));

    expect(from()).toBe("me@example.org");
    expect(body()).toContain("Signed at work");
    expect(body()).not.toContain("Signed at home");
  });
});
