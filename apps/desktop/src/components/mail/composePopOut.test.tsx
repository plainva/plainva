// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ComposeSnapshot } from "../../services/mail/composeHandoff";

/**
 * Popping the composer out must not cost a word (multi-window P3).
 *
 * The promise is "loses nothing", and the place that promise is easiest to
 * break is the recipient that was TYPED but not yet turned into a chip: it
 * lives in a draft state of its own, and a snapshot built from the committed
 * lists alone would drop it — silently, in the one moment the writer is least
 * likely to look.
 *
 * The editor is mocked to a plain textarea: what is asserted here is the
 * snapshot, not CodeMirror.
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

const account = {
  id: "a1",
  label: "Work",
  user: "me@example.org",
  smtpHost: "smtp.example.org",
  signature: "-- \nMarco",
};

vi.mock("@plainva/ui/mail", async () => {
  const actual = await vi.importActual<typeof import("@plainva/ui/mail")>("@plainva/ui/mail");
  return {
    ...actual,
    listMailAccounts: async () => [account],
    listMailboxesFor: async () => [{ name: "Drafts", role: "drafts" }],
  };
});

const sent: unknown[] = [];
vi.mock("../../services/mail/sendQueue", () => ({
  submitSend: async (req: unknown) => {
    sent.push(req);
  },
  submitDraft: async () => {},
}));

import { MailDraftModal } from "./MailDraftModal";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

// Queried from the DOCUMENT, not the container: the floating variant renders
// through a portal, so a container-scoped lookup would find nothing and the
// test would fail for the wrong reason.
const byTestId = <T extends HTMLElement>(id: string) => document.querySelector(`[data-testid="${id}"]`) as T | null;

function fire(el: HTMLElement, event: Event) {
  act(() => {
    el.dispatchEvent(event);
  });
}

/**
 * React listens for `input` and tracks the value itself, so the NATIVE setter
 * has to be the one that writes it. Walking the element's own prototype chain
 * (rather than naming a class) keeps it in the realm the element came from.
 */
function type(el: HTMLElement, value: string) {
  for (let p = Object.getPrototypeOf(el); p; p = Object.getPrototypeOf(p)) {
    const desc = Object.getOwnPropertyDescriptor(p, "value");
    if (desc?.set) {
      desc.set.call(el, value);
      break;
    }
  }
  fire(el, new Event("input", { bubbles: true }));
}

describe("popping the composer out", () => {
  it("takes along a recipient that was typed but not yet confirmed", async () => {
    const popped: ComposeSnapshot[] = [];
    const closed = vi.fn();
    render(
      <MailDraftModal
        subject="Quarterly numbers"
        markdown="Body text"
        onPopOut={(s) => popped.push(s)}
        onClose={closed}
      />,
    );
    await settle();

    // Typed, NOT confirmed with Enter — the state a writer is in when they
    // decide the window is too small.
    type(byTestId("draft-to")!, "you@example.org");
    fire(byTestId("draft-popout")!, new MouseEvent("click", { bubbles: true }));

    expect(popped).toHaveLength(1);
    expect(popped[0]!.to).toBe("you@example.org");
    expect(popped[0]!.subject).toBe("Quarterly numbers");
    expect(popped[0]!.body).toContain("Body text");
    // The floating composer goes away: the message is in the new window now,
    // and two composers on one draft would be two drafts.
    expect(closed).toHaveBeenCalled();
  });

  it("restores a popped-out draft without signing it a second time", async () => {
    const signature = ["-- ", "Marco"].join("\n");
    const snapshot: ComposeSnapshot = {
      accountId: "a1",
      fromAddress: "me@example.org",
      to: "you@example.org",
      cc: "team@example.org",
      bcc: "",
      showCc: true,
      subject: "Quarterly numbers",
      body: ["Body text", "", signature].join("\n"),
      attachments: [],
      mailbox: "Drafts",
    };

    render(
      <MailDraftModal
        variant="window"
        restore={snapshot}
        subject={snapshot.subject}
        markdown={snapshot.body}
        onClose={() => {}}
      />,
    );
    await settle();

    // The Cc row was open when the window was popped out, so it is open here.
    expect(byTestId("draft-cc-field")).toBeTruthy();
    expect(byTestId<HTMLInputElement>("draft-subject")!.value).toBe("Quarterly numbers");
    expect(byTestId("draft-to-chip")!.textContent).toContain("you@example.org");

    // The accounts have loaded by now — and the signature the body already
    // carries must not be appended a second time.
    const body = byTestId<HTMLTextAreaElement>("draft-body")!.value;
    expect(body.split(signature).length - 1).toBe(1);

    // As a window it draws no floating chrome of its own: the OS frame and the
    // aux title bar above it are the chrome.
    expect(document.querySelector(".pv-mail-winpane")).toBeTruthy();
    expect(byTestId("draft-popout")).toBeNull();
  });
});
