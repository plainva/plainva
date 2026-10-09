// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { MailAccountConfig } from "@plainva/ui/mail";

/**
 * When the composer offers "Send" (finding 2026-10-08).
 *
 * The button was gated on the account's SMTP host. A Microsoft mailbox is
 * stored without one — there is no field to enter it into — and never needed
 * it: `sendMail` submits it through Graph. So every Microsoft mailbox could
 * file a draft from the desktop and never send, behind a hint asking for
 * something the account cannot have.
 *
 * The gate is the shared `mailSendRoute` now, the decision the transport reads
 * itself. What is rendered here is the real component; only the account list,
 * the mailbox lookup and the editor are stand-ins.
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
    listMailboxesFor: async () => [{ name: "Entwürfe", role: "drafts" }],
  };
});

const sent: Array<{ accountId: string; to: string }> = [];
vi.mock("../../services/mail/sendQueue", () => ({
  submitSend: async (req: { accountId: string; to: string }) => {
    sent.push(req);
  },
  submitDraft: async () => {},
}));

import { MailDraftModal } from "./MailDraftModal";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// What connecting a Microsoft mailbox stores: a kind, an address, no SMTP host.
const microsoft: MailAccountConfig = { id: "ms", label: "me@outlook.com", host: "", port: 0, user: "me@outlook.com", kind: "microsoft", clientId: "cid" };
// A mailbox connected for reading only — a valid setup that cannot send.
const readOnly: MailAccountConfig = { id: "ro", label: "me@example.org", host: "imap.example.org", port: 993, user: "me@example.org" };
const imap: MailAccountConfig = { ...readOnly, id: "imap", smtpHost: "smtp.example.org", smtpPort: 587 };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
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

async function open(list: MailAccountConfig[]) {
  accounts = list;
  render(<MailDraftModal subject="Question" markdown="Does the date work?" initialTo="you@example.org" onClose={() => {}} />);
  await settle();
  return { send: byTestId<HTMLButtonElement>("draft-send")!, hint: byTestId("draft-send-hint")!, save: byTestId<HTMLButtonElement>("draft-save")! };
}

describe("the composer offers Send by the account's route", () => {
  it("offers it for a Microsoft mailbox and asks for no SMTP host", async () => {
    const { send, hint } = await open([microsoft]);
    expect(send.disabled).toBe(false);
    expect(send.getAttribute("data-tip")).toBeNull();
    // Whatever the language: the line under the body must not ask for a host.
    expect(hint.textContent).not.toMatch(/smtp/i);

    await act(async () => {
      send.click();
      await Promise.resolve();
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ accountId: "ms", to: "you@example.org" });
  });

  it("offers it for a mailbox with an SMTP host, as before", async () => {
    const { send, hint } = await open([imap]);
    expect(send.disabled).toBe(false);
    expect(hint.textContent).toMatch(/smtp/i);
  });

  it("keeps it closed for a mailbox that only reads, and says what is missing", async () => {
    const { send, hint, save } = await open([readOnly]);
    expect(send.disabled).toBe(true);
    expect(hint.textContent).toMatch(/smtp/i);
    expect(send.getAttribute("data-tip")).toMatch(/smtp/i);
    // Filing a draft needs no way to send and stays open.
    expect(save.disabled).toBe(false);

    send.click();
    await settle();
    expect(sent).toHaveLength(0);
  });
});
