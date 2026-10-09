// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { MailAttachment } from "@plainva/ui/mail";
import { MailComposeScreen, type MailDraft } from "./screens/MailComposeScreen";
import { draftPath, parseDraft } from "./screens/mail/mailNavRefs";
import { activeLeaveGuard, resetLeaveGuard } from "./services/leaveGuard";
import { currentMobileDialog, dismissMobileDialog } from "./services/mobileDialogs";
import { createNavActions } from "./services/navActions";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The composer with a draft that ARRIVES with something on it, and what leaving
 * it asks (finding 2026-10-09).
 *
 * "Send this note as an attachment" opened the composer without the attachment;
 * the codec and the route tests pin that hand-off. This is the other end: the
 * file is on screen, it goes out with the message, and the leave guard treats
 * it as what it is. Checking that turned up three faults in the guard itself,
 * none of them about files — each has its test below:
 *
 *  - sending or filing a draft left through the same exit as the back arrow, so
 *    the shell asked whether to discard a message that was already on its way;
 *  - an account's signature counted as unsaved work, so an untouched composer
 *    asked on the way out;
 *  - the files were not looked at, so one put on or taken off by hand was
 *    dropped without a word.
 *
 * Behaviour, not shape: the screen is rendered and driven, and it leaves
 * through the shell's real `pop` and `done`, because the question lives there.
 */

const mocks = vi.hoisted(() => ({
  accounts: [] as unknown[],
  sendMail: vi.fn(async (..._args: unknown[]) => undefined),
  appendDraft: vi.fn(async (..._args: unknown[]) => undefined),
}));

vi.mock("./services/mail/mailRuntime", () => ({
  listMobileMailAccounts: vi.fn(async () => mocks.accounts),
  mailVaultId: () => "/vault",
}));
// The shared Markdown editor is CodeMirror; what matters here is that the body
// is a field someone can type into.
vi.mock("./screens/mail/MailComposeEditor", async () => {
  const { TextArea } = await import("@plainva/ui");
  return {
    MailComposeEditor: ({ value, onChange }: { value: string; onChange: (next: string) => void }) => (
      <TextArea data-testid="compose-body" value={value} onChange={(e) => onChange(e.target.value)} />
    ),
  };
});
vi.mock("./components/AttachPickSheet", () => ({
  AttachPickSheet: ({ onPick }: { onPick: (path: string) => void }) => (
    <button type="button" data-testid="pick-file" onClick={() => onPick("Bilder/Skizze.png")} />
  ),
}));
vi.mock("@plainva/ui/mail", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendMail: mocks.sendMail,
  appendDraft: mocks.appendDraft,
  listMailboxesFor: vi.fn(async () => [{ name: "Entwürfe", role: "drafts" }]),
}));

const file: MailAttachment = { name: "Angebot.md", mime: "text/markdown; charset=utf-8", contentBase64: "IyBBbmdlYm90Cg==" };
const plain = { id: "m1", label: "anna@example.org", host: "imap.example.org", port: 993, smtpHost: "smtp.example.org", smtpPort: 587, user: "anna@example.org", kind: "imap" };
const signing = { ...plain, signature: "Anna Beispiel" };

/** The draft as the note route hands it over — through the nav path, like the app. */
const fromNote = (): MailDraft => parseDraft(draftPath({ accountId: "", to: "", subject: "Angebot", body: "", attachments: [file] }));

let container: HTMLDivElement;
let root: Root;
let left: number;
let nav: ReturnType<typeof createNavActions>;

beforeEach(() => {
  mocks.accounts = [plain];
  mocks.sendMail.mockClear();
  mocks.appendDraft.mockClear();
  resetLeaveGuard();
  left = 0;
  // The shell's own actions: `pop` asks the leave guard, `done` does not.
  nav = createNavActions(() => void (left += 1), () => {});
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

const vault = {
  vaultId: "/vault",
  files: { readBinaryFile: async () => new Uint8Array([137, 80, 78, 71]) },
} as never;

async function open(draft: MailDraft) {
  await act(async () => {
    root.render(<MailComposeScreen draft={draft} onBack={nav.pop} onDone={nav.done} vault={vault} />);
  });
  // The account list arrives a tick later, and the signature with it.
  await act(async () => {});
}

const q = <T extends HTMLElement = HTMLElement>(testId: string) => container.querySelector<T>(`[data-testid="${testId}"]`);
const files = () => [...container.querySelectorAll<HTMLElement>('[data-testid="compose-attachment"]')].map((row) => row.textContent?.trim());
const recipient = () => container.querySelector<HTMLInputElement>('input[placeholder="name@example.com"]')!;

const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
async function type(el: HTMLInputElement, value: string) {
  await act(async () => {
    setInputValue.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function tap(el: Element | null) {
  expect(el, "the control is on screen").not.toBeNull();
  await act(async () => (el as HTMLElement).click());
  await act(async () => {});
}
/** The back arrow, as the shell runs it. Resolves once the guard has answered or asked. */
async function back() {
  await act(async () => nav.pop());
  await act(async () => {});
}
const question = () => {
  const dialog = currentMobileDialog();
  return dialog?.kind === "confirm" ? dialog : null;
};

describe("a draft that arrives with a file on it", () => {
  it("shows the file, and takes it off again", async () => {
    await open(fromNote());
    expect(files()).toEqual(["Angebot.mdtext/markdown; charset=utf-8"]);
    await tap(q("compose-attachment-remove"));
    expect(files()).toEqual([]);
  });

  it("keeps it while the shell re-reads the draft from its path", async () => {
    // The route parses the nav path on every render, so the composer is handed
    // a new draft object — and a new file list — each time. Neither may reset
    // what is on screen, and neither may look like a change.
    await open(fromNote());
    await open(fromNote());
    expect(files()).toHaveLength(1);
    expect(activeLeaveGuard()).toBeNull();
  });
});

describe("leaving the composer", () => {
  it("asks nothing while nothing was changed — a file that came with the draft is not unsaved work", async () => {
    await open(fromNote());
    expect(activeLeaveGuard()).toBeNull();
    await back();
    expect(question()).toBeNull();
    expect(left).toBe(1);
  });

  it("asks nothing about a signature the composer put there itself", async () => {
    mocks.accounts = [signing];
    await open(fromNote());
    expect(q<HTMLTextAreaElement>("compose-body")?.value).toContain("Anna Beispiel");
    expect(activeLeaveGuard(), "the signature alone is not something a person wrote").toBeNull();
    // What is typed above the signature still counts.
    const body = q<HTMLTextAreaElement>("compose-body")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(body, `Hallo Ben,${body.value}`);
      body.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(activeLeaveGuard()?.id).toBe("mail-compose");
  });

  it("asks once something was typed, and stays when the answer is no", async () => {
    await open(fromNote());
    await type(recipient(), "ben@example.org");
    await back();
    const asked = question();
    expect(asked, "a typed recipient is unsaved work").not.toBeNull();
    expect(left).toBe(0);
    await act(async () => asked!.resolve(false));
    expect(left).toBe(0);
    expect(recipient().value).toBe("ben@example.org");
  });

  it("asks nothing about how the recipients are written, only about who they are", async () => {
    // The measure is the shared rule since the desktop composer asks too: a
    // recipient field names a list, and a separator typed behind the last
    // address is somebody still typing, not a recipient that would be lost.
    await open({ accountId: "m1", to: "ben@example.org", subject: "Angebot", body: "" });
    await type(recipient(), "ben@example.org, ");
    expect(activeLeaveGuard()).toBeNull();
    await type(recipient(), "ben@example.org, carla@example.org");
    expect(activeLeaveGuard()?.id).toBe("mail-compose");
  });

  it("asks when a file was taken off by hand", async () => {
    await open(fromNote());
    await tap(q("compose-attachment-remove"));
    expect(activeLeaveGuard()?.id).toBe("mail-compose");
  });

  it("asks when a file was put on by hand — and no longer once it is off again", async () => {
    await open({ accountId: "m1", to: "", subject: "", body: "" });
    expect(activeLeaveGuard()).toBeNull();
    await tap(q("compose-attach"));
    await tap(q("pick-file"));
    expect(files()).toEqual(["Skizze.pngimage/png"]);
    expect(activeLeaveGuard()?.id).toBe("mail-compose");
    await tap(q("compose-attachment-remove"));
    expect(activeLeaveGuard(), "back to how it opened: nothing to lose").toBeNull();
  });
});

describe("sending and filing are not leaving", () => {
  it("sends without the discard question, and the file that came with the draft goes out", async () => {
    vi.useFakeTimers();
    await open(fromNote());
    await type(recipient(), "ben@example.org");
    await tap(container.querySelector("button.pv-btn--primary"));
    expect(question(), "the shell asked whether to discard a message that is on its way").toBeNull();
    expect(left).toBe(1);
    // The undo window passes; then the message is handed over.
    expect(mocks.sendMail).not.toHaveBeenCalled();
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(mocks.sendMail).toHaveBeenCalledTimes(1);
    const [, , to, subject, , attachments] = mocks.sendMail.mock.calls[0];
    expect({ to, subject, attachments }).toEqual({ to: "ben@example.org", subject: "Angebot", attachments: [file] });
  });

  it("files a draft without the discard question, with the file on it", async () => {
    await open(fromNote());
    await type(recipient(), "ben@example.org");
    await tap(q("compose-save-draft"));
    expect(mocks.appendDraft).toHaveBeenCalledTimes(1);
    expect(mocks.appendDraft.mock.calls[0][2]).toBe("Entwürfe");
    expect(mocks.appendDraft.mock.calls[0][6]).toEqual([file]);
    expect(question(), "the shell asked whether to discard a draft that was just saved").toBeNull();
    expect(left).toBe(1);
  });
});
