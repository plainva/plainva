// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { MailAccountConfig } from "@plainva/ui/mail";

/**
 * An open composer reads the mailbox list again when it is written
 * (Sammelplan § 3.47 (d)).
 *
 * It read the list once, when it opened: a composer opened before the first
 * mailbox was connected said "No mail account connected yet." until it was
 * closed and opened again — connecting the mailbox beside it changed nothing.
 * Now every write of the list is said (`announceMailAccounts`, in the shared
 * module, so no writer can forget it) and the composer reads again, keeping
 * the sender that is still there and its one signature.
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
let mailboxLookups = 0;

vi.mock("@plainva/ui/mail", async () => {
  const actual = await vi.importActual<typeof import("@plainva/ui/mail")>("@plainva/ui/mail");
  return {
    ...actual,
    listMailAccounts: async () => accounts.map((a) => ({ ...a })),
    listMailboxesFor: async () => {
      mailboxLookups += 1;
      return [{ name: "Drafts", role: "drafts" }];
    },
  };
});

vi.mock("../../services/mail/sendQueue", () => ({ submitSend: async () => {}, submitDraft: async () => {} }));

import { announceMailAccounts } from "@plainva/ui/mail";
import { MailDraftModal } from "./MailDraftModal";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const work: MailAccountConfig = { id: "work", label: "Work", host: "imap.example.org", port: 993, user: "me@example.org", smtpHost: "smtp.example.org", smtpPort: 587, signature: "Signed at work" };
const home: MailAccountConfig = { id: "home", label: "Home", host: "imap.example.net", port: 993, user: "me@example.net", smtpHost: "smtp.example.net", smtpPort: 587, signature: "Signed at home" };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  accounts = [];
  mailboxLookups = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

const byTestId = <T extends HTMLElement>(id: string) => document.querySelector(`[data-testid="${id}"]`) as T | null;
/** "From": a picker with two mailboxes or more, a read-only field with one. */
const from = () => byTestId("draft-from-select")?.textContent || byTestId<HTMLInputElement>("draft-from")?.value || "";
const body = () => byTestId<HTMLTextAreaElement>("draft-body")?.value ?? "";
const form = () => byTestId("draft-form")?.textContent ?? "";
const times = (text: string, part: string) => text.split(part).length - 1;
/** The composer's word for "no mailbox", in whichever language the test runs. */
const NONE = /No email account connected yet\.|Noch kein E-Mail-Konto verbunden\./;

function open(initialAccountId?: string) {
  act(() =>
    root.render(<MailDraftModal subject="Hello" markdown="Text" initialAccountId={initialAccountId} onClose={() => {}} />),
  );
}

async function written(next: MailAccountConfig[], vaultPath = "/vault") {
  accounts = next;
  await act(async () => {
    announceMailAccounts(vaultPath);
  });
  await settle();
}

describe("an open composer and the mailbox list", () => {
  it("offers a mailbox connected while it was open, signed once", async () => {
    open();
    await settle();
    expect(form()).toMatch(NONE);

    await written([work]);

    expect(form()).not.toMatch(NONE);
    expect(from()).toBe("me@example.org");
    expect(times(body(), "Signed at work")).toBe(1);
  });

  it("keeps its sender and its one signature when another mailbox is connected", async () => {
    accounts = [work, home];
    open("home");
    await settle();
    const lookups = mailboxLookups;

    await written([work, home, { ...work, id: "third", label: "Third", user: "third@example.org", signature: "Signed third" }]);

    expect(from()).toBe("me@example.net · Home");
    expect(times(body(), "Signed at home")).toBe(1);
    expect(body()).not.toContain("Signed third");
    // The sending mailbox did not change, so its drafts folder is not guessed again.
    expect(mailboxLookups).toBe(lookups);
  });

  it("moves to another mailbox when its own was removed, taking the old signature out", async () => {
    accounts = [work, home];
    open("home");
    await settle();

    await written([work]);

    expect(from()).toBe("me@example.org");
    expect(body()).not.toContain("Signed at home");
    expect(times(body(), "Signed at work")).toBe(1);
  });

  it("does not read again for another vault's list", async () => {
    open();
    await settle();

    await written([work], "/other-vault");

    expect(form()).toMatch(NONE);
  });
});
