// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "@plainva/ui/i18n";
import type { MailAttachment } from "@plainva/ui/mail";

/**
 * Asking for another message while the composer is open (finding 2026-10-09).
 *
 * A window hosts one composer. "Reply" to a second message, "New message",
 * "Forward" or "Send note by mail" while it was open did nothing: the host
 * stored the new draft, and the composer — which reads what it is given once,
 * when it opens — went on showing the old one. Now the request has a result. A
 * composer nobody wrote in is replaced by the new draft; a changed one is asked
 * about first, with the question every other way out of it asks, and both
 * answers do what they say.
 *
 * Walked through in BOTH places a composer is hosted: beside the shell of the
 * central and the full window (`MailComposeHost`), and in an auxiliary window
 * (the bridge, and the composer as `AuxApp` renders it). The hosts are the real
 * ones, and so are the composer, its floating window and the dialog host; a
 * request is made the way the app makes it — with the window event the mail
 * view, the editor and the calendar dispatch. The same walk through the running
 * app is in e2e/mail.spec.ts.
 *
 * The editor is mocked to a plain textarea; what the real one does to a body is
 * covered next to the rule (services/mail/composeChange.test.ts).
 */

const mocks = vi.hoisted(() => ({
  accounts: [] as unknown[],
  filed: [] as unknown[],
  /** Set to hold a filing back: the server takes as long as the test says. */
  filing: null as Promise<void> | null,
}));

vi.mock("../../contexts/VaultContext", () => ({
  useVault: () => ({ vaultPath: "/vault", vaultAdapter: null, isLoading: false }),
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
    listMailAccounts: async () => mocks.accounts,
    listMailboxesFor: async () => [{ name: "Drafts", role: "drafts" }],
  };
});

vi.mock("../../services/mail/sendQueue", () => ({
  submitSend: async () => {},
  submitDraft: async (req: unknown) => {
    mocks.filed.push(req);
    await mocks.filing;
  },
}));

// The window around the composer is not what is asked here (windowCloseGuard.test.ts).
vi.mock("../../services/windowCloseGuard", () => ({ holdWindowClose: () => () => {} }));
// Nor is the way into a window of its own (composePopOut.test.tsx).
vi.mock("../../services/mail/composeWindow", () => ({ popOutCompose: async () => {} }));

// What the bridge reaches for besides the composer: none of it is asked for here.
vi.mock("../../services/windowBus", () => ({ getWindowBus: async () => ({ request: async () => undefined }) }));
vi.mock("../../services/linkCreatePrompt", () => ({ getAskBeforeCreateLink: async () => false }));
vi.mock("../../services/newNote", () => ({ getConfiguredNoteType: async () => "plain" }));
vi.mock("../../services/openRouting", () => ({ routeOpenThroughOwner: () => true }));

import { MailDraftModal } from "./MailDraftModal";
import { MailComposeHost } from "./MailComposeHost";
import { DialogHost } from "../ui/DialogHost";
import { dialogStore } from "../../services/appDialogs";
import { useAuxBridge } from "../../hooks/useAuxBridge";
import { resetComposeHostForTest } from "../../services/mail/composeHost";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// The From picker scrolls its active option into view; jsdom has no layout to scroll.
Element.prototype.scrollIntoView = () => {};

const plain = { id: "a1", label: "Work", user: "me@example.org", smtpHost: "smtp.example.org" };
const signing = { ...plain, signature: "Marco" };
/** One mailbox, two addresses, a signature of its own for the second. */
const twoSenders = {
  ...signing,
  senders: ["Support <support@example.org>"],
  signatures: { "support@example.org": "Support-Team" },
};
const note: MailAttachment = { name: "Angebot.md", mime: "text/markdown; charset=utf-8", contentBase64: "IyBBbmdlYm90Cg==" };

/** What the mail view asks for on "Reply". */
const reply = { subject: "Re: Rechnung Q3", markdown: "\n\n> anbei die Rechnung.", to: "Anna Beispiel <anna@example.org>" };
/** What the editor asks for on "Send as attachment", with a recipient from the note's properties. */
const noteByMail = { subject: "Angebot", markdown: "Wie besprochen.", to: "ben@example.org", attachments: [note] };
/** What the mail view asks for on "New message". */
const blank = { subject: "", markdown: "" };

/** The shell's neighbours as `main.tsx` and `FullApp` mount them: the composer's host and the app's dialog host. */
function CentralShell() {
  return (
    <>
      <MailComposeHost />
      <DialogHost />
    </>
  );
}

/** The composer as `AuxApp` hosts it, next to the app's dialog host. */
function AuxShell() {
  const bridge = useAuxBridge({ label: "aux-1", openInFocusedPane: () => {}, revealRightSidebar: () => {} });
  return (
    <>
      {bridge.mailDraft && (
        <MailDraftModal
          key={bridge.mailDraftKey}
          subject={bridge.mailDraft.subject}
          markdown={bridge.mailDraft.markdown}
          attachments={bridge.mailDraft.attachments}
          initialTo={bridge.mailDraft.to}
          onClose={bridge.closeMailDraft}
        />
      )}
      <DialogHost />
    </>
  );
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  mocks.accounts = [plain];
  mocks.filed.length = 0;
  mocks.filing = null;
  resetComposeHostForTest();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  dialogStore.clearAll();
});

/** Lets the account/mailbox lookups and a dialog's answer land. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

// From the DOCUMENT: the floating window renders through a portal.
const byTestId = <T extends HTMLElement>(id: string) => document.querySelector(`[data-testid="${id}"]`) as T | null;
const composers = () => document.querySelectorAll('[data-testid="draft-form"]').length;
const value = (id: string) => byTestId<HTMLInputElement | HTMLTextAreaElement>(id)!.value;
const files = () => [...document.querySelectorAll<HTMLElement>('[data-testid="draft-attachments"]')].map((chip) => chip.textContent?.trim());
/** Everyone in the To field: the confirmed chips and whatever is still being typed. */
const recipients = () =>
  [...[...document.querySelectorAll<HTMLElement>('[data-testid="draft-to-chip"]')].map((chip) => chip.textContent?.trim()), value("draft-to")].filter(Boolean);
/** Everything a draft consists of, as the composer shows it. */
const shown = () => ({ to: recipients(), subject: value("draft-subject"), body: value("draft-body"), files: files() });

/** A compose request, as every sender in the app makes it. */
async function ask(detail: { subject: string; markdown: string; to?: string; attachments?: MailAttachment[] }) {
  act(() => {
    window.dispatchEvent(new CustomEvent("plainva-compose-mail", { detail }));
  });
  await settle();
  // One host loads the composer as a chunk of its own: the first request waits
  // for it to arrive and for its accounts to be read — the fields are drawn
  // once there is a mailbox to write from —, not for a fixed number of ticks.
  for (let i = 0; i < 50 && (composers() === 0 || !byTestId("draft-subject")); i += 1) await settle();
}

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

async function escape() {
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  });
  await settle();
}

const questions = () => container.querySelectorAll<HTMLElement>(".pv-overlay--dialog");
/** The discard question, as the dialog host draws it. */
const question = () => {
  const dialog = questions()[0];
  if (!dialog) return null;
  const [cancel, discard] = [...dialog.querySelectorAll<HTMLButtonElement>(".pv-modal-footer button")];
  return {
    title: dialog.querySelector(".pv-modal-heading")?.textContent,
    message: dialog.querySelector(".pv-dialog-msg")?.textContent,
    cancel,
    discard,
  };
};

describe.each([
  ["the central and the full window", CentralShell],
  ["an auxiliary window", AuxShell],
])("in %s", (_where, Shell) => {
  beforeEach(() => {
    act(() => root.render(<Shell />));
  });

  describe("a composer nobody wrote in", () => {
    it("is replaced by the draft that is asked for next: recipient, subject, text and file", async () => {
      await ask(reply);
      expect(shown()).toEqual({ to: ["Anna Beispiel <anna@example.org>"], subject: "Re: Rechnung Q3", body: "\n\n> anbei die Rechnung.", files: [] });

      await ask(noteByMail);
      expect(question(), "nothing was written, so nothing is asked").toBeNull();
      expect(composers()).toBe(1);
      expect(shown()).toEqual({ to: ["ben@example.org"], subject: "Angebot", body: "Wie besprochen.", files: ["Angebot.md"] });
    });

    it("is replaced although the composer itself signed the body", async () => {
      mocks.accounts = [signing];
      await ask(reply);
      expect(value("draft-body")).toContain("Marco");

      await ask(noteByMail);
      expect(question(), "the signature alone is not something a person wrote").toBeNull();
      expect(value("draft-subject")).toBe("Angebot");
      expect(value("draft-body")).toContain("Wie besprochen.");
      expect(value("draft-body")).not.toContain("anbei die Rechnung.");
      expect(value("draft-body").split("Marco"), "signed once, for the new message").toHaveLength(2);
    });

    it("leaves nothing of itself in the composer that takes its place", async () => {
      mocks.accounts = [twoSenders];
      await ask(noteByMail);
      // Neither counts as writing: another sender, an opened Cc row.
      await click(byTestId("draft-from-select"));
      await click([...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.includes("support@example.org")) ?? null);
      await click(byTestId("draft-cc-toggle"));
      expect(byTestId("draft-from-select")!.textContent).toContain("support@example.org");
      expect(byTestId("draft-cc")).not.toBeNull();

      await ask(blank);
      expect(question()).toBeNull();
      expect(shown()).toEqual({ to: [], subject: "", body: expect.stringContaining("Marco"), files: [] });
      expect(value("draft-body"), "the signature of the sender a new message starts with").not.toContain("Support-Team");
      expect(byTestId("draft-from-select")!.textContent).toContain("me@example.org");
      expect(byTestId("draft-cc"), "the Cc row is closed again").toBeNull();
    });
  });

  describe("a draft someone changed", () => {
    async function writeAnswer() {
      await ask(reply);
      type("draft-subject", "Re: Rechnung Q3 (korrigiert)");
      type("draft-body", "Danke, passt!\n\n> anbei die Rechnung.");
    }
    const written = { to: ["Anna Beispiel <anna@example.org>"], subject: "Re: Rechnung Q3 (korrigiert)", body: "Danke, passt!\n\n> anbei die Rechnung.", files: [] };

    it("is asked about first, and Cancel leaves it standing with everything typed", async () => {
      await writeAnswer();
      await ask(noteByMail);

      const asked = question();
      expect(asked, "a written message is not replaced without a word").not.toBeNull();
      expect(asked!.title).toBe(i18n.t("mobile.leaveTitle"));
      expect(asked!.message).toBe(i18n.t("mobile.leaveCompose"));
      expect(asked!.discard.textContent).toBe(i18n.t("mobile.leaveDiscard"));
      expect(shown(), "still the draft that was being written").toEqual(written);

      await click(asked!.cancel);
      expect(question()).toBeNull();
      expect(composers()).toBe(1);
      expect(shown()).toEqual(written);
    });

    it("makes way for the new draft once the answer is Discard", async () => {
      await writeAnswer();
      await ask(noteByMail);
      await click(question()!.discard);

      expect(question()).toBeNull();
      expect(composers()).toBe(1);
      expect(shown()).toEqual({ to: ["ben@example.org"], subject: "Angebot", body: "Wie besprochen.", files: ["Angebot.md"] });
    });

    it("asks again when the request is made again after Cancel", async () => {
      await writeAnswer();
      await ask(noteByMail);
      await click(question()!.cancel);

      await ask(noteByMail);
      expect(question(), "Cancel was an answer to that request, not to every later one").not.toBeNull();
      expect(shown()).toEqual(written);
    });

    it("is asked about once when a second request arrives while the question stands, and the later request is the one shown", async () => {
      await writeAnswer();
      await ask(noteByMail);
      await ask(blank);
      expect(questions(), "one question about one draft").toHaveLength(1);

      await click(question()!.discard);
      expect(questions()).toHaveLength(0);
      expect(shown()).toEqual({ to: [], subject: "", body: "", files: [] });
    });

    it("does not come up again for the draft that took its place", async () => {
      await writeAnswer();
      await ask(noteByMail);
      await click(question()!.discard);

      await ask(blank);
      expect(question(), "the new composer is untouched: nothing to ask").toBeNull();
      expect(shown()).toEqual({ to: [], subject: "", body: "", files: [] });
    });

    it("counts a file that was taken off, and a recipient that is typed and not yet confirmed", async () => {
      await ask(noteByMail);
      await click(byTestId("draft-attach-remove"));
      await ask(blank);
      expect(question(), "a file taken off is a change").not.toBeNull();
      await click(question()!.discard);

      type("draft-to", "carla@exam");
      await ask(reply);
      expect(question(), "half an address is something someone typed").not.toBeNull();
    });
  });

  describe("a message that is being filed this moment", () => {
    /*
     * "Save draft" takes as long as the server does. A request in that time used
     * to meet a composer that was neither untouched nor simply changed: asked
     * "discard?" about a message on its way, or replaced under a filing whose
     * failure then reached nobody.
     */
    /** "Save draft", and the server takes its time: the test says when, and how, it answers. */
    async function fileSlowly() {
      let answer!: { done: () => void; fail: (reason: Error) => void };
      mocks.filing = new Promise<void>((resolve, reject) => (answer = { done: resolve, fail: reject }));
      await click(byTestId("draft-save"));
      expect(mocks.filed).toHaveLength(1);
      // The answer, and everything that follows from it: the composer closes or
      // shows its error, and a request that waited is taken up.
      const then = async (land: () => void) => {
        land();
        await settle();
        await settle();
      };
      return { done: () => then(answer.done), fail: (reason: Error) => then(() => answer.fail(reason)) };
    }

    it("holds a request back until the server has answered, then opens the new draft without a question", async () => {
      await ask(reply);
      type("draft-body", "Danke, passt!");
      const server = await fileSlowly();

      await ask(noteByMail);
      expect(question(), "not a question about a message that is being saved").toBeNull();
      expect(value("draft-subject"), "and not replaced under its own filing").toBe("Re: Rechnung Q3");

      await server.done();
      expect(question()).toBeNull();
      expect(composers()).toBe(1);
      expect(shown()).toEqual({ to: ["ben@example.org"], subject: "Angebot", body: "Wie besprochen.", files: ["Angebot.md"] });
    });

    it("keeps the composer, its error and everything written when the filing fails", async () => {
      await ask(reply);
      type("draft-body", "Danke, passt!");
      const server = await fileSlowly();
      await ask(noteByMail);

      await server.fail(new Error("APPEND failed: over quota"));
      expect(question()).toBeNull();
      expect(composers()).toBe(1);
      expect(byTestId("draft-error")?.textContent).toContain("over quota");
      expect(shown()).toEqual({ to: ["Anna Beispiel <anna@example.org>"], subject: "Re: Rechnung Q3", body: "Danke, passt!", files: [] });

      // The filing is over and the draft is a changed one again: the next request asks.
      await ask(noteByMail);
      expect(question()).not.toBeNull();
    });

    it("does not replace a draft nobody wrote in under its filing either: the error is for the person", async () => {
      await ask(noteByMail);
      const server = await fileSlowly();
      await ask(blank);
      expect(value("draft-subject")).toBe("Angebot");

      await server.fail(new Error("APPEND failed: over quota"));
      expect(composers()).toBe(1);
      expect(value("draft-subject")).toBe("Angebot");
      expect(byTestId("draft-error")?.textContent).toContain("over quota");
    });
  });

  describe("once the composer is closed", () => {
    it("the next request opens one, and a discarded draft is not asked about again", async () => {
      await ask(reply);
      type("draft-body", "Danke, passt!");
      await escape();
      await click(question()!.discard);
      expect(composers()).toBe(0);

      await ask(noteByMail);
      expect(question()).toBeNull();
      expect(shown()).toEqual({ to: ["ben@example.org"], subject: "Angebot", body: "Wie besprochen.", files: ["Angebot.md"] });
    });
  });
});
