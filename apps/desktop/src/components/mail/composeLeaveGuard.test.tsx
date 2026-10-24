// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "@plainva/ui/i18n";
import type { MailAttachment } from "@plainva/ui/mail";
import type { ComposeSnapshot } from "../../services/mail/composeHandoff";

/**
 * Leaving the composer (finding 2026-10-09).
 *
 * Escape, the close button and "Cancel" dropped whatever stood in the desktop
 * composer without a word, while the phone asked. Now all three ask — when the
 * draft was changed against what the composer opened with, and only then. The
 * measure is the shared rule (`composeChanged`, pinned in
 * services/mail/composeChange.test.ts); what is pinned here is the composer
 * around it: which ways out ask, what the question leaves standing, and that
 * the composer's own doing — the signature, a file the draft arrived with, a
 * move to another window — never counts as something a person wrote.
 *
 * Behaviour, not shape: the composer is rendered with the real floating window
 * and the real dialog host, and it is left the way a person leaves it.
 *
 * The editor is mocked to a plain textarea; what the real one does to a body is
 * covered next to the rule.
 */

const mocks = vi.hoisted(() => ({
  accounts: [] as unknown[],
  sent: [] as unknown[],
  filed: [] as unknown[],
  /** What the composer has declared to the window around it. */
  held: new Set<() => Promise<boolean>>(),
}));

vi.mock("../../contexts/VaultContext", () => ({
  useVault: () => ({ vaultPath: "/vault", vaultAdapter: null }),
}));

vi.mock("./ComposeEditor", () => ({
  ComposeEditor: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea data-testid="draft-body" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

// The picker's own way of closing on Escape, as the real one has it: a key
// handler on its search field that closes and does NOT mark the key as used.
vi.mock("../TemplatePickerModal", () => ({
  TemplatePickerModal: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <input
        data-testid="template-search"
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      />
    ) : null,
}));

vi.mock("@plainva/ui/mail", async () => {
  const actual = await vi.importActual<typeof import("@plainva/ui/mail")>("@plainva/ui/mail");
  return {
    ...actual,
    listMailAccounts: async () => mocks.accounts,
    listMailboxesFor: async () => [{ name: "Drafts", role: "drafts" }],
  };
});

vi.mock("../../services/mail/sendQueue", () => ({
  submitSend: async (req: unknown) => {
    mocks.sent.push(req);
  },
  submitDraft: async (req: unknown) => {
    mocks.filed.push(req);
  },
}));

// The window around the composer: what it is told to hold is asserted below,
// the window's own half is windowCloseGuard.test.ts.
vi.mock("../../services/windowCloseGuard", () => ({
  holdWindowClose: (question: () => Promise<boolean>) => {
    mocks.held.add(question);
    return () => {
      mocks.held.delete(question);
    };
  },
}));

// "Attach file": the OS picker hands back a path, the fs plugin its bytes.
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: async () => "C:\\Bilder\\Skizze.png" }));
vi.mock("@tauri-apps/plugin-fs", () => ({ readFile: async () => new Uint8Array([137, 80, 78, 71]) }));

import { MailDraftModal } from "./MailDraftModal";
import { DialogHost } from "../ui/DialogHost";
import { dialogStore } from "../../services/appDialogs";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// The From picker scrolls its active option into view; jsdom has no layout to scroll.
Element.prototype.scrollIntoView = () => {};

const plain ={ id: "a1", label: "Work", user: "me@example.org", smtpHost: "smtp.example.org" };
const signing = { ...plain, signature: "Marco" };
/** One mailbox, two addresses, a signature of its own for the second. */
const twoSenders = {
  ...signing,
  senders: ["Support <support@example.org>"],
  signatures: { "support@example.org": "Support-Team" },
};
const note: MailAttachment = { name: "Angebot.md", mime: "text/markdown; charset=utf-8", contentBase64: "IyBBbmdlYm90Cg==" };

let container: HTMLDivElement;
let root: Root;
let closed: number;
let popped: ComposeSnapshot[];

beforeEach(() => {
  mocks.accounts = [plain];
  mocks.sent.length = 0;
  mocks.filed.length = 0;
  mocks.held.clear();
  closed = 0;
  popped = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  dialogStore.clearAll();
});

function render(el: ReactElement) {
  act(() => root.render(el));
}

/** Lets the account/mailbox lookups and a dialog's answer land. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

type Props = Partial<Parameters<typeof MailDraftModal>[0]>;

/** The composer as a shell hosts it, next to the app's dialog host. */
async function open(props: Props = {}) {
  render(
    <>
      <MailDraftModal
        subject="Angebot"
        markdown=""
        onPopOut={(snapshot) => popped.push(snapshot)}
        {...props}
        onClose={() => {
          closed += 1;
        }}
      />
      <DialogHost />
    </>,
  );
  await settle();
}

// From the DOCUMENT: the floating window renders through a portal.
const byTestId = <T extends HTMLElement>(id: string) => document.querySelector(`[data-testid="${id}"]`) as T | null;
const value = (id: string) => byTestId<HTMLInputElement | HTMLTextAreaElement>(id)!.value;
const files = () => [...document.querySelectorAll<HTMLElement>('[data-testid="draft-attachments"]')].map((chip) => chip.textContent?.trim());
/** Everyone in the To field: the confirmed chips and whatever is still being typed. */
const recipients = () =>
  [...[...document.querySelectorAll<HTMLElement>('[data-testid="draft-to-chip"]')].map((chip) => chip.textContent?.trim()), value("draft-to")].filter(Boolean);

/** React tracks the value itself, so the NATIVE setter has to write it. */
function type(id: string, text: string) {
  const el = byTestId(id)!;
  for (let p = Object.getPrototypeOf(el); p; p = Object.getPrototypeOf(p)) {
    const desc = Object.getOwnPropertyDescriptor(p, "value");
    if (desc?.set) {
      desc.set.call(el, text);
      break;
    }
  }
  act(() => {
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(el: Element | null) {
  expect(el, "the control is on screen").not.toBeNull();
  act(() => {
    el!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
}

/** Escape, where the keyboard focus is — exactly what a key press does. */
async function escape() {
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  });
  await settle();
}

/** Escape pressed in one particular field. */
async function escapeIn(el: HTMLElement | null) {
  expect(el, "the field is on screen").not.toBeNull();
  act(() => el!.focus());
  await escape();
}

/** The discard question, as the dialog host draws it. */
const question = () => {
  const dialog = container.querySelector<HTMLElement>(".pv-overlay--dialog");
  if (!dialog) return null;
  const [cancel, discard] = [...dialog.querySelectorAll<HTMLButtonElement>(".pv-modal-footer button")];
  return {
    title: dialog.querySelector(".pv-modal-heading")?.textContent,
    message: dialog.querySelector(".pv-dialog-msg")?.textContent,
    cancel,
    discard,
  };
};

describe("an untouched composer", () => {
  it("closes on Escape without a question", async () => {
    await open();
    await escape();
    expect(question()).toBeNull();
    expect(closed).toBe(1);
  });

  it("closes without a question although the composer signed the body", async () => {
    mocks.accounts = [signing];
    await open({ markdown: "Hallo Anna," });
    expect(value("draft-body")).toContain("Marco");
    await escape();
    expect(question(), "the signature alone is not something a person wrote").toBeNull();
    expect(closed).toBe(1);
  });

  it("closes without a question although the draft arrived with a recipient and a file", async () => {
    mocks.accounts = [signing];
    await open({ initialTo: "Anna Beispiel <anna@example.org>; ben@example.org", attachments: [note] });
    expect(files()).toEqual(["Angebot.md"]);
    await click(byTestId("draft-close"));
    expect(question(), "what the draft came with is not unsaved work").toBeNull();
    expect(closed).toBe(1);
  });

  it("stays untouched when the sender is switched — the signature is swapped, not written", async () => {
    mocks.accounts = [twoSenders];
    await open({ markdown: "Hallo Anna," });
    expect(value("draft-body")).toContain("Marco");
    await click(byTestId("draft-from-select"));
    await click([...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.includes("support@example.org")) ?? null);
    expect(value("draft-body")).toContain("Support-Team");
    expect(value("draft-body")).not.toContain("Marco");
    await click(byTestId("draft-cancel"));
    expect(question()).toBeNull();
    expect(closed).toBe(1);
  });

  it("declares nothing to the window around it", async () => {
    mocks.accounts = [signing];
    await open({ attachments: [note] });
    expect(mocks.held.size).toBe(0);
  });
});

describe("a changed draft", () => {
  it("asks on Escape, and Cancel leaves the composer with everything typed", async () => {
    await open();
    type("draft-to", "anna@example.org");
    type("draft-subject", "Angebot (neu)");
    type("draft-body", "Hallo Anna,");
    await escape();

    const asked = question();
    expect(asked, "a changed draft is not dropped without a word").not.toBeNull();
    expect(asked!.title).toBe(i18n.t("mobile.leaveTitle"));
    expect(asked!.message).toBe(i18n.t("mobile.leaveCompose"));
    expect(asked!.discard.textContent).toBe(i18n.t("mobile.leaveDiscard"));
    expect(closed).toBe(0);

    await click(asked!.cancel);
    expect(question()).toBeNull();
    expect(closed).toBe(0);
    // The recipient that was only typed has become a chip meanwhile: the field
    // confirms it when the focus leaves for the question. It is still there.
    expect(recipients()).toEqual(["anna@example.org"]);
    expect(value("draft-subject")).toBe("Angebot (neu)");
    expect(value("draft-body")).toBe("Hallo Anna,");
  });

  it("closes once the answer is Discard", async () => {
    await open();
    type("draft-body", "Hallo Anna,");
    await escape();
    await click(question()!.discard);
    expect(question()).toBeNull();
    expect(closed).toBe(1);
  });

  it("asks on the close button and on Cancel as well", async () => {
    await open();
    type("draft-subject", "Angebot (neu)");
    await click(byTestId("draft-close"));
    expect(question()).not.toBeNull();
    await click(question()!.cancel);

    await click(byTestId("draft-cancel"));
    expect(question()).not.toBeNull();
    expect(closed).toBe(0);
  });

  it("gives Escape to the question while it stands — it cancels, and no second one follows", async () => {
    // The floating window takes Escape in the capture phase. With the question
    // open it used to take that one too: the composer's handler ran again, and
    // the dialog on top never saw the key.
    await open();
    type("draft-body", "Hallo Anna,");
    await escape();
    expect(question()).not.toBeNull();
    await escape();
    expect(question(), "Escape answers the question with Cancel").toBeNull();
    expect(closed).toBe(0);
    expect(value("draft-body")).toBe("Hallo Anna,");
  });

  it("counts a recipient that is typed and not yet confirmed", async () => {
    await open({ initialTo: "anna@example.org" });
    type("draft-to", "ben@exam");
    await escape();
    expect(question()).not.toBeNull();
  });

  it("asks when a file was put on by hand — and no longer once it is off again", async () => {
    await open();
    await click(byTestId("draft-attach-file"));
    expect(files()).toEqual(["Skizze.png"]);
    await escape();
    expect(question(), "a file attached by hand is unsaved work").not.toBeNull();
    await click(question()!.cancel);

    await click(byTestId("draft-attach-remove"));
    expect(files()).toEqual([]);
    await escape();
    expect(question(), "back to how it opened: nothing to lose").toBeNull();
    expect(closed).toBe(1);
  });

  it("asks when a file the draft arrived with was taken off", async () => {
    await open({ attachments: [note] });
    await click(byTestId("draft-attach-remove"));
    await escape();
    expect(question()).not.toBeNull();
  });

  it("still counts what was typed after the sender was switched", async () => {
    mocks.accounts = [twoSenders];
    await open();
    type("draft-body", `Hallo Anna,${value("draft-body")}`);
    await click(byTestId("draft-from-select"));
    await click([...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.includes("support@example.org")) ?? null);
    expect(value("draft-body")).toContain("Hallo Anna,");
    expect(value("draft-body")).toContain("Support-Team");
    await escape();
    expect(question()).not.toBeNull();
  });

  it("is declared to the window around the composer for as long as it is changed", async () => {
    await open();
    type("draft-subject", "Angebot (neu)");
    expect(mocks.held.size).toBe(1);
    // The window asks the composer's own question — one, not a second beside it.
    const [ask] = [...mocks.held];
    let answer: boolean | undefined;
    act(() => {
      void ask().then((a) => (answer = a));
    });
    await escape();
    await settle();
    expect(answer, "Escape in the question is Cancel for the window too").toBe(false);

    type("draft-subject", "Angebot");
    expect(mocks.held.size, "back to how it opened: the window may go").toBe(0);
  });
});

describe("whose key Escape is", () => {
  /*
   * The floating window used to take every Escape in the app, first: with a
   * composer open, the key that should close a menu in the composer — or
   * anything at all in the note beside it — closed the composer instead. With
   * the question in place that would be a question nobody asked for.
   */
  it("is not the composer's when it is pressed in the work beside it", async () => {
    await open();
    type("draft-body", "Hallo Anna,");
    // A field of the note, the search, a palette: something else has the focus.
    const beside = document.createElement("input");
    document.body.appendChild(beside);
    await escapeIn(beside);
    expect(question(), "an Escape for the note is not a wish to discard the message").toBeNull();
    expect(closed).toBe(0);
    beside.remove();
  });

  it("does not close an untouched composer from the work beside it either", async () => {
    await open();
    const beside = document.createElement("input");
    document.body.appendChild(beside);
    await escapeIn(beside);
    expect(closed).toBe(0);
    beside.remove();
  });

  it("closes the sender list first, and leaves the composer alone", async () => {
    mocks.accounts = [twoSenders];
    await open();
    type("draft-subject", "Angebot (neu)");
    await click(byTestId("draft-from-select"));
    expect(document.querySelector('[role="listbox"]')).not.toBeNull();
    // A click puts the focus on the list's button; that is where the key goes.
    await escapeIn(byTestId("draft-from-select"));
    expect(document.querySelector('[role="listbox"]'), "Escape closed the list").toBeNull();
    expect(question()).toBeNull();
    expect(closed).toBe(0);
  });

  it("closes the template picker first, and is the composer's again afterwards", async () => {
    await open();
    type("draft-subject", "Angebot (neu)");
    await click(byTestId("draft-insert-template"));
    await escapeIn(byTestId("template-search"));
    expect(byTestId("template-search"), "Escape closed the picker").toBeNull();
    expect(question(), "and nothing asked about the message").toBeNull();
    expect(closed).toBe(0);

    await escapeIn(byTestId("draft-subject"));
    expect(question(), "now the key is the composer's").not.toBeNull();
  });

  it("is the composer's when the focus is nowhere", async () => {
    await open();
    type("draft-subject", "Angebot (neu)");
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    expect(document.activeElement).toBe(document.body);
    await escape();
    expect(question(), "nothing else is claiming the key").not.toBeNull();
  });
});

describe("the ways out that lose nothing", () => {
  it("sends without the question", async () => {
    await open();
    type("draft-to", "anna@example.org");
    type("draft-body", "Hallo Anna,");
    await click(byTestId("draft-send"));
    expect(mocks.sent).toHaveLength(1);
    expect(question(), "a message that is on its way is not a discarded one").toBeNull();
    expect(closed).toBe(1);
  });

  it("files a draft without the question", async () => {
    await open();
    type("draft-to", "anna@example.org");
    type("draft-body", "Hallo Anna,");
    await click(byTestId("draft-save"));
    expect(mocks.filed).toHaveLength(1);
    expect(question()).toBeNull();
    expect(closed).toBe(1);
  });

  it("pops out without the question", async () => {
    await open();
    type("draft-body", "Hallo Anna,");
    await click(byTestId("draft-popout"));
    expect(popped).toHaveLength(1);
    expect(question(), "the message lives on in its own window").toBeNull();
    expect(closed).toBe(1);
  });
});

describe("a composer in a window of its own", () => {
  /** Pops the floating composer out and hands the snapshot over the way the bus does: as JSON. */
  async function popOut(): Promise<ComposeSnapshot> {
    await click(byTestId("draft-popout"));
    const snapshot = JSON.parse(JSON.stringify(popped[0])) as ComposeSnapshot;
    act(() => root.unmount());
    root = createRoot(container);
    closed = 0;
    return snapshot;
  }
  const restore = (snapshot: ComposeSnapshot) =>
    open({ variant: "window", restore: snapshot, subject: snapshot.subject, markdown: snapshot.body, onPopOut: undefined });

  it("still knows what the writer changed before it was popped out", async () => {
    mocks.accounts = [signing];
    await open({ attachments: [note] });
    type("draft-body", `Hallo Anna,${value("draft-body")}`);
    await restore(await popOut());

    // Measured against the pop-out, this draft would look untouched — and a
    // whole written message could be closed in the new window without a word.
    expect(mocks.held.size, "the window holds a changed draft").toBe(1);
    await click(byTestId("draft-cancel"));
    expect(question()).not.toBeNull();
    expect(closed).toBe(0);
  });

  it("does not turn an untouched draft into a changed one on the way", async () => {
    mocks.accounts = [signing];
    await open({ initialTo: "anna@example.org", attachments: [note] });
    await restore(await popOut());

    // Every string and every file is a copy now; none of it was written.
    expect(files()).toEqual(["Angebot.md"]);
    expect(mocks.held.size).toBe(0);
    await click(byTestId("draft-cancel"));
    expect(question()).toBeNull();
    expect(closed).toBe(1);
  });

  it("takes a snapshot without an opened state as what it opened with", async () => {
    // A snapshot built by someone who knows nothing of the leave question: the
    // window measures against what it was handed, and asks once that changes.
    const snapshot: ComposeSnapshot = {
      accountId: "a1",
      fromAddress: "me@example.org",
      to: "anna@example.org",
      cc: "",
      bcc: "",
      showCc: false,
      subject: "Angebot",
      body: "Hallo Anna,",
      attachments: [],
      mailbox: "Drafts",
    };
    await restore(snapshot);
    expect(mocks.held.size).toBe(0);
    type("draft-subject", "Angebot (neu)");
    await click(byTestId("draft-cancel"));
    expect(question()).not.toBeNull();
  });
});
