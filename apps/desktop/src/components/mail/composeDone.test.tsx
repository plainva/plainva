// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * A composer that was opened FOR somebody (AI harness P5-6): a mail the
 * assistant drafted waits in its list until the writer did something with it,
 * so the composer has to say what — and say nothing when it is just closed.
 *
 * "Sent" is the one that is easy to get wrong. Pressing Send only queues the
 * message for the undo window; told at that moment, a send that is taken back
 * would cost the draft as well as the mail.
 */

vi.mock("../../contexts/VaultContext", () => ({
  useVault: () => ({ vaultPath: "/vault", vaultAdapter: null }),
}));

vi.mock("./ComposeEditor", () => ({
  ComposeEditor: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea data-testid="draft-body" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

vi.mock("../TemplatePickerModal", () => ({ TemplatePickerModal: () => null }));

vi.mock("@plainva/ui/mail", async () => {
  const actual = await vi.importActual<typeof import("@plainva/ui/mail")>("@plainva/ui/mail");
  return {
    ...actual,
    listMailAccounts: async () => [{ id: "a1", label: "Work", user: "me@example.org", smtpHost: "smtp.example.org" }],
    listMailboxesFor: async () => [{ name: "Drafts", role: "drafts" }],
  };
});

const queued: Array<{ req: { to: string; cc?: string; bcc?: string; subject: string }; delivered?: () => void }> = [];
const stored: Array<{ to: string; cc?: string; bcc?: string; mailbox: string }> = [];
vi.mock("../../services/mail/sendQueue", () => ({
  submitSend: async (req: { to: string; cc?: string; bcc?: string; subject: string }, delivered?: () => void) => {
    queued.push({ req, ...(delivered ? { delivered } : {}) });
  },
  submitDraft: async (req: { to: string; cc?: string; bcc?: string; mailbox: string }) => {
    stored.push(req);
  },
}));

import { MailDraftModal } from "./MailDraftModal";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  queued.length = 0;
  stored.length = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(el: ReactElement) {
  act(() => root.render(el));
}

/** Lets the account/mailbox lookups and a submit (all promises) land. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

// From the document: the floating variant renders through a portal.
const byTestId = <T extends HTMLElement>(id: string) => document.querySelector(`[data-testid="${id}"]`) as T | null;
const chips = (id: string) => Array.from(document.querySelectorAll(`[data-testid="${id}"]`)).map((chip) => chip.textContent?.trim() ?? "");

async function click(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
}

const DRAFT = { subject: "Re: Shooting day", markdown: "The 14th is fixed.", initialTo: "a.okafor@example.org", initialCc: "tom@example.org", initialBcc: "me@example.org" };

describe("a composer opened with a mail somebody drafted", () => {
  it("shows every recipient the draft names: Cc and Bcc are open, never out of sight", async () => {
    render(<MailDraftModal {...DRAFT} onClose={() => {}} />);
    await settle();
    expect(byTestId("draft-cc-field")).toBeTruthy();
    expect(chips("draft-to-chip")).toEqual([expect.stringContaining("a.okafor@example.org")]);
    expect(chips("draft-cc-chip")).toEqual([expect.stringContaining("tom@example.org")]);
    expect(chips("draft-bcc-chip")).toEqual([expect.stringContaining("me@example.org")]);
    expect(byTestId<HTMLInputElement>("draft-subject")!.value).toBe("Re: Shooting day");
    // An ordinary mail keeps the two rows folded away.
    act(() => root.unmount());
    root = createRoot(container);
    render(<MailDraftModal subject="Hello" markdown="Text" initialTo="a.okafor@example.org" onClose={() => {}} />);
    await settle();
    expect(byTestId("draft-cc-field")).toBeNull();
    expect(byTestId("draft-cc-toggle")).toBeTruthy();
  });

  it("says “sent” once the queue's transport took the mail — pressing Send alone only closes the composer", async () => {
    const told: string[] = [];
    const closed = vi.fn();
    render(<MailDraftModal {...DRAFT} onDone={(how) => told.push(how)} onClose={closed} />);
    await settle();
    await click(byTestId("draft-send")!);
    expect(queued).toHaveLength(1);
    expect(queued[0]!.req).toMatchObject({ to: "a.okafor@example.org", cc: "tom@example.org", bcc: "me@example.org", subject: "Re: Shooting day" });
    expect(closed).toHaveBeenCalledTimes(1);
    // Queued, and it can still be taken back: nobody was told anything.
    expect(told).toEqual([]);
    queued[0]!.delivered!();
    expect(told).toEqual(["sent"]);
  });

  it("says “saved” once the account stored the draft, and “opened” when it moves to a window of its own", async () => {
    const told: string[] = [];
    render(<MailDraftModal {...DRAFT} onDone={(how) => told.push(how)} onClose={() => {}} />);
    await settle();
    await click(byTestId("draft-save")!);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ to: "a.okafor@example.org", cc: "tom@example.org", bcc: "me@example.org", mailbox: "Drafts" });
    expect(told).toEqual(["saved"]);

    act(() => root.unmount());
    root = createRoot(container);
    const moved: string[] = [];
    const popped = vi.fn();
    render(<MailDraftModal {...DRAFT} onPopOut={popped} onDone={(how) => moved.push(how)} onClose={() => {}} />);
    await settle();
    await click(byTestId("draft-popout")!);
    expect(popped).toHaveBeenCalledTimes(1);
    // Its text and its recipients went along; from here the window is where the mail is.
    expect(popped.mock.calls[0]![0]).toMatchObject({ to: "a.okafor@example.org", cc: "tom@example.org", bcc: "me@example.org", showCc: true });
    expect(moved).toEqual(["opened"]);
  });

  it("says nothing when it is just closed — and hands the queue nothing to tell for a mail nobody waits for", async () => {
    const told: string[] = [];
    const closed = vi.fn();
    render(<MailDraftModal {...DRAFT} onDone={(how) => told.push(how)} onClose={closed} />);
    await settle();
    const cancel = Array.from(document.querySelectorAll<HTMLButtonElement>(".pv-mail-winfoot button")).find((button) => !button.dataset.testid)!;
    await click(cancel);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(told).toEqual([]);
    expect([queued, stored]).toEqual([[], []]);

    act(() => root.unmount());
    root = createRoot(container);
    render(<MailDraftModal subject="Hello" markdown="Text" initialTo="a.okafor@example.org" onClose={() => {}} />);
    await settle();
    await click(byTestId("draft-send")!);
    expect(queued).toHaveLength(1);
    expect(queued[0]!.delivered).toBeUndefined();
  });
});
