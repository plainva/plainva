// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { MailAccountConfig } from "@plainva/ui/mail";
import type { ComposeSnapshot } from "../../services/mail/composeHandoff";

/**
 * Which mailbox a draft starts from (finding 2026-10-09).
 *
 * The composer took the first mailbox that is stored, whatever the draft came
 * from: a reply to a message in the second mailbox opened under the first
 * one's address and with its signature, and went out that way unless "From"
 * was changed by hand. With one mailbox nobody could tell.
 *
 * The composer is told now (`initialAccountId`), and this file holds what it
 * does with that: it starts there, signs for there and sends from there; it
 * falls back to the first mailbox where nobody named one or the named one is
 * gone; it takes the mailbox along into a window of its own; and it reads the
 * mailbox ONCE — a composer does not change its sender, and stack a second
 * signature, because the shell around it rendered again.
 *
 * What is rendered is the real component; the account list, the mailbox lookup
 * and the editor are stand-ins.
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

let accounts: MailAccountConfig[] = [];

vi.mock("@plainva/ui/mail", async () => {
  const actual = await vi.importActual<typeof import("@plainva/ui/mail")>("@plainva/ui/mail");
  return {
    ...actual,
    listMailAccounts: async () => accounts,
    listMailboxesFor: async () => [{ name: "Drafts", role: "drafts" }],
  };
});

const sent: Array<{ accountId: string; fromAddress?: string; body: string }> = [];
vi.mock("../../services/mail/sendQueue", () => ({
  submitSend: async (req: { accountId: string; fromAddress?: string; body: string }) => {
    sent.push(req);
  },
  submitDraft: async () => {},
}));

import { MailDraftModal } from "./MailDraftModal";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Two mailboxes that sign differently, so neither can stand in for the other.
const work: MailAccountConfig = { id: "work", label: "Work", host: "imap.example.org", port: 993, user: "me@example.org", smtpHost: "smtp.example.org", smtpPort: 587, signature: "Signed at work" };
const home: MailAccountConfig = { id: "home", label: "Home", host: "imap.example.net", port: 993, user: "me@example.net", smtpHost: "smtp.example.net", smtpPort: 587, signature: "Signed at home" };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  accounts = [work, home];
  sent.length = 0;
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

/** Lets the account/mailbox lookups (both promises) land. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

// From the DOCUMENT: the floating composer renders through a portal.
const byTestId = <T extends HTMLElement>(id: string) => document.querySelector(`[data-testid="${id}"]`) as T | null;
const from = () => byTestId("draft-from-select")?.textContent ?? "";
const body = () => byTestId<HTMLTextAreaElement>("draft-body")?.value ?? "";
const times = (text: string, part: string) => text.split(part).length - 1;

/** A reply as the mail view asks for it: a recipient, a subject, a quoted original — and a mailbox. */
function reply(initialAccountId?: string, extra: Partial<Parameters<typeof MailDraftModal>[0]> = {}) {
  return (
    <MailDraftModal
      subject="Re: Invoice"
      markdown={"\n\nOn Monday Anna wrote:\n\n> Attached."}
      initialTo="anna@example.org"
      initialAccountId={initialAccountId}
      onClose={() => {}}
      {...extra}
    />
  );
}

describe("the mailbox a draft starts from", () => {
  it("is the one it was asked for from, with that mailbox's signature", async () => {
    render(reply("home"));
    await settle();

    expect(from()).toBe("me@example.net · Home");
    expect(times(body(), "Signed at home")).toBe(1);
    expect(body()).not.toContain("Signed at work");
  });

  it("is the mailbox the message is sent from", async () => {
    render(reply("home"));
    await settle();

    await act(async () => {
      byTestId<HTMLButtonElement>("draft-send")!.click();
      await Promise.resolve();
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ accountId: "home", fromAddress: "me@example.net" });
    expect(sent[0]!.body).toContain("Signed at home");
    expect(sent[0]!.body).not.toContain("Signed at work");
  });

  it("is the first one stored where nobody named a mailbox — a note sent by mail, an invitation", async () => {
    render(reply(undefined));
    await settle();

    expect(from()).toBe("me@example.org · Work");
    expect(body()).toContain("Signed at work");
    expect(body()).not.toContain("Signed at home");
  });

  it("is the first one stored when the named mailbox is gone", async () => {
    // Removed in the settings while the mail view still had it open.
    render(reply("removed"));
    await settle();

    expect(from()).toBe("me@example.org · Work");
    expect(body()).toContain("Signed at work");
  });

  it("travels with the draft into a window of its own", async () => {
    const popped: ComposeSnapshot[] = [];
    render(reply("home", { onPopOut: (s) => popped.push(s) }));
    await settle();

    act(() => {
      byTestId("draft-popout")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(popped).toHaveLength(1);
    expect(popped[0]).toMatchObject({ accountId: "home", fromAddress: "me@example.net" });

    // The window the snapshot is opened in: the same sender, signed once.
    act(() => root.unmount());
    root = createRoot(container);
    const snapshot = popped[0]!;
    render(<MailDraftModal variant="window" restore={snapshot} subject={snapshot.subject} markdown={snapshot.body} onClose={() => {}} />);
    await settle();

    expect(from()).toBe("me@example.net · Home");
    expect(times(body(), "Signed at home")).toBe(1);
    expect(body()).not.toContain("Signed at work");
  });

  it("is read once: a shell that renders again does not change the sender of an open draft", async () => {
    render(reply("home"));
    await settle();
    expect(from()).toBe("me@example.net · Home");

    // The same composer, handed another mailbox by its host. Following it
    // would switch the sender under the writer and put a second signature
    // beside the first.
    render(reply("work"));
    await settle();

    expect(from()).toBe("me@example.net · Home");
    expect(times(body(), "Signed at home")).toBe(1);
    expect(body()).not.toContain("Signed at work");
  });
});
