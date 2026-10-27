// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { setPlatformServices } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { GRAPH_FILE_LIMIT, MAIL_MAILBOX_CHANGED, formatAttachmentSize, forwardSource, setMailPlatform, type FetchedAttachment, type ForwardSource, type MailAttachment, type MailTransport } from "@plainva/ui/mail";
import { MailComposeScreen, type MailDraft } from "./screens/MailComposeScreen";
import { draftPath, parseDraft } from "./screens/mail/mailNavRefs";
import { activeLeaveGuard, resetLeaveGuard } from "./services/leaveGuard";
import { currentMobileDialog, dismissMobileDialog } from "./services/mobileDialogs";
import { createNavActions } from "./services/navActions";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * A forward on the phone brings the files of the original (plan "Weiterleiten
 * nimmt die Anhänge mit", B5).
 *
 * The composer is rendered with the draft the message screen hands it — text
 * plus a REFERENCE to the message, through the nav path like the app — and the
 * mailbox answers when the test says so. Held here is what a person meets:
 * every file says what is with it, Send and Save draft wait while one is on
 * its way and ask before a message leaves without one, and an untouched
 * forward can be left without a question in any of these states.
 *
 * The rule itself (what goes for which mailbox) and the loading are tested at
 * the shared building block; this is the phone's surface over it.
 */

const mocks = vi.hoisted(() => ({
  accounts: [] as unknown[],
  sendMail: vi.fn(async (..._args: unknown[]) => undefined),
  appendDraft: vi.fn(async (..._args: unknown[]) => undefined),
}));

vi.mock("./services/mail/mailRuntime", () => ({
  listMobileMailAccounts: vi.fn(async () => mocks.accounts),
  // The screens list the mailboxes switched on (plan "Verbinden", E3): here every one is.
  listActiveMobileMailAccounts: vi.fn(async () => mocks.accounts),
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
vi.mock("./components/AttachPickSheet", () => ({
  AttachPickSheet: ({ onPick }: { onPick: (path: string) => void }) => (
    <button type="button" data-testid="pick-file" onClick={() => onPick("Videos/Film.mp4")} />
  ),
}));
// Sending and filing are replaced at the door; everything else — the rule, the
// loading, the mail client down to the transport — is the real code.
vi.mock("@plainva/ui/mail", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendMail: mocks.sendMail,
  appendDraft: mocks.appendDraft,
  listMailboxesFor: vi.fn(async () => [{ name: "Entwürfe", role: "drafts" }]),
}));

const imap = { id: "m1", label: "anna@example.org", host: "imap.example.org", port: 993, smtpHost: "smtp.example.org", smtpPort: 587, user: "anna@example.org", kind: "imap" };
const microsoft = { id: "ms", label: "anna@example.com", host: "", port: 993, user: "anna@example.com", kind: "microsoft", clientId: "cid" };

const MB = 1024 * 1024;
const source: ForwardSource = {
  accountId: "m1",
  mailbox: "INBOX",
  messageId: "7",
  uidValidity: 42,
  files: [
    { index: 2, name: "Angebot.pdf", mime: "application/pdf", size: 412 * 1024 },
    { index: 3, name: "Begehung.mp4", mime: "video/mp4", size: 7 * MB },
  ],
};
/** The draft as the message screen hands it over — through the nav path, like the app. */
const forwarded = (accountId = "m1"): MailDraft =>
  parseDraft(draftPath({ accountId, to: "", subject: "Fwd: Angebot", body: "\n\n---------- Forwarded message ----------\n\nanbei", forward: source }));

/** One call to the mailbox for files, answered by the test. */
interface Batch {
  args: { mailbox: string; uid: number; indexes: number[]; uidValidity?: number };
  resolve(found: FetchedAttachment[]): void;
  reject(error: Error): void;
}
let batches: Batch[] = [];

let container: HTMLDivElement;
let root: Root;
let left: number;
let nav: ReturnType<typeof createNavActions>;

beforeEach(() => {
  mocks.accounts = [imap, microsoft];
  mocks.sendMail.mockClear();
  mocks.appendDraft.mockClear();
  batches = [];
  resetLeaveGuard();
  left = 0;
  nav = createNavActions(() => void (left += 1), () => {});
  setPlatformServices({
    loadSettings: async () => ({ get: async () => undefined, set: async () => {}, delete: async () => true, keys: async () => [], save: async () => {} }),
    credentials: { readSecret: async <T,>() => ({ pass: "secret" }) as T, writeSecret: async () => {}, removeSecret: async () => {} },
    openExternal: async () => {},
  });
  const transport = {
    fetchAttachments: (_creds: unknown, args: Batch["args"]) =>
      new Promise<FetchedAttachment[]>((resolve, reject) => {
        batches.push({ args, resolve, reject });
      }),
  } as unknown as MailTransport;
  setMailPlatform({ transport, http: { api: fetch, token: fetch } });
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

const bigFile = new Uint8Array(GRAPH_FILE_LIMIT + 1);
const vault = { vaultId: "/vault", files: { readBinaryFile: async () => bigFile } } as never;

/** Lets effects, the credential lookup and a settled answer play out — in
 *  microtasks only, so it works while a test holds the timers. */
const settle = () =>
  act(async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  });

async function open(draft: MailDraft) {
  await act(async () => {
    root.render(<MailComposeScreen draft={draft} onBack={nav.pop} onDone={nav.done} vault={vault} />);
  });
  await settle();
}
async function answer(batch: Batch, found: FetchedAttachment[]) {
  await act(async () => batch.resolve(found));
  await settle();
}

const q = <T extends HTMLElement = HTMLElement>(testId: string) => container.querySelector<T>(`[data-testid="${testId}"]`);
const all = (testId: string) => [...container.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`)];
/** Each file of the original as "name|state|second line". */
const carried = () => all("compose-carried").map((row) => `${row.querySelector(".m-linestack > span")?.textContent?.trim()}|${row.dataset.state}|${row.querySelector("small")?.textContent}`);
const recipient = () => container.querySelector<HTMLInputElement>('input[placeholder="name@example.com"]')!;
const sendButton = () => container.querySelector<HTMLButtonElement>("button.pv-btn--primary")!;
const sendIcon = () => container.querySelector<HTMLButtonElement>(`button[aria-label="${i18n.t("mail.send")}"]`);
/** The words the surface shows, in whatever language the test runs in. */
const loadingNote = (size: string) => `${size} · ${i18n.t("mail.fileState.loading")}`;
const tooLargeNote = (size: string) => `${size} · ${i18n.t("mail.fileState.tooLarge")}`;
const mailboxBound = () => i18n.t("mail.fileLimitMailbox", { size: formatAttachmentSize(GRAPH_FILE_LIMIT, i18n.language) });

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
  await settle();
}
async function back() {
  await act(async () => nav.pop());
  await act(async () => {});
}
const question = () => {
  const dialog = currentMobileDialog();
  return dialog?.kind === "confirm" ? dialog : null;
};
/** Answers the open question the way the dialog host does: resolve, then take it down. */
async function reply(yes: boolean) {
  const dialog = question();
  expect(dialog, "a question is open").not.toBeNull();
  await act(async () => {
    dialog!.resolve(yes);
    dismissMobileDialog(dialog!);
  });
  await settle();
}
/** The files the last send was handed. */
const sentFiles = () => (mocks.sendMail.mock.calls[0][5] as MailAttachment[]).map((a) => a.name);

describe("a forward opens with its text and fetches the files of the original", () => {
  it("shows every file as on its way, and Send and Save draft wait", async () => {
    await open(forwarded());

    // The composer is there at once, with what was written for it.
    expect(q<HTMLTextAreaElement>("compose-body")?.value).toContain("Forwarded message");
    // One call for both files, to the mailbox the message lies in.
    expect(batches).toHaveLength(1);
    expect(batches[0].args).toEqual({ mailbox: "INBOX", uid: 7, indexes: [2, 3], uidValidity: 42 });
    expect(carried()).toEqual([`Angebot.pdf|loading|${loadingNote("412 KB")}`, `Begehung.mp4|loading|${loadingNote("7 MB")}`]);
    // The line under the files says how many are on their way, and that the
    // two buttons wait for them.
    expect(q("compose-files-loading")?.textContent).toBe(`${i18n.t("mail.filesLoading", { count: 2 })} ${i18n.t("mail.filesWaiting")}`);
    expect(sendButton().disabled).toBe(true);
    expect(q<HTMLButtonElement>("compose-save-draft")?.disabled).toBe(true);
  });

  it("does not hand megabytes to the nav path: the draft names the message, the composer loads", async () => {
    // The reference is made from the message as the reader holds it, and takes
    // four things per file. Whatever else a file entry carries — here the
    // bytes themselves, as a cache or another backend might keep them next to
    // the listing — stays behind: this path is read again on every render.
    const megabyte = "QUJD".repeat(350_000);
    const message = {
      id: "7",
      uidValidity: 42,
      attachments: [
        { index: 2, name: "Angebot.pdf", mime: "application/pdf", size: 412 * 1024, contentBase64: megabyte },
        { index: 3, name: "Begehung.mp4", mime: "video/mp4", size: 7 * MB, contentBase64: megabyte, bytes: [1, 2, 3] },
      ],
    };
    const made = forwardSource("m1", "INBOX", message);
    expect(made).toEqual(source);
    const path = draftPath({ accountId: "m1", to: "", subject: "Fwd: Angebot", body: "anbei", forward: made });
    expect(path).not.toContain("contentBase64");
    expect(path).not.toContain("QUJDQUJD");
    expect(path.length).toBeLessThan(1000);
    // And a path that was handed bytes all the same does not pass them on.
    const smuggled = draftPath({ accountId: "m1", to: "", subject: "x", body: "", forward: { ...source, files: message.attachments } });
    expect(JSON.stringify(parseDraft(smuggled).forward)).not.toContain("QUJDQUJD");
    expect(parseDraft(smuggled).forward).toEqual(source);
  });

  it("shows them as here once they came, and sends them — the files of the original first, then the others", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await open(forwarded());
    await answer(batches[0], [
      { index: 2, contentBase64: "JVBERi0=" },
      { index: 3, contentBase64: "AAEC" },
    ]);
    expect(carried()).toEqual(["Angebot.pdf|ready|412 KB", "Begehung.mp4|ready|7 MB"]);
    expect(q("compose-files-loading")).toBeNull();
    expect(sendButton().disabled).toBe(false);

    await type(recipient(), "ben@example.org");
    await tap(sendButton());
    expect(question(), "everything on the draft goes: there is nothing to ask").toBeNull();
    expect(left).toBe(1);
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(mocks.sendMail).toHaveBeenCalledTimes(1);
    expect(mocks.sendMail.mock.calls[0][5]).toEqual([
      { name: "Angebot.pdf", mime: "application/pdf", contentBase64: "JVBERi0=" },
      { name: "Begehung.mp4", mime: "video/mp4", contentBase64: "AAEC" },
    ]);
  });

  it("files them with a draft as well", async () => {
    await open(forwarded());
    await answer(batches[0], [{ index: 2, contentBase64: "JVBERi0=" }, { index: 3, contentBase64: "AAEC" }]);
    await tap(q("compose-save-draft"));
    expect(question()).toBeNull();
    expect(mocks.appendDraft).toHaveBeenCalledTimes(1);
    expect((mocks.appendDraft.mock.calls[0][6] as MailAttachment[]).map((a) => a.name)).toEqual(["Angebot.pdf", "Begehung.mp4"]);
    expect(left).toBe(1);
  });
});

describe("an untouched forward is not unsaved work", () => {
  it("leaves without a question while the files are on their way", async () => {
    await open(forwarded());
    expect(activeLeaveGuard()).toBeNull();
    await back();
    expect(question()).toBeNull();
    expect(left).toBe(1);
  });

  it("leaves without a question once they are here — arriving is not a change", async () => {
    await open(forwarded());
    await answer(batches[0], [{ index: 2, contentBase64: "JVBERi0=" }, { index: 3, contentBase64: "AAEC" }]);
    expect(activeLeaveGuard()).toBeNull();
  });

  it("leaves without a question when they did not come", async () => {
    await open(forwarded());
    await act(async () => batches[0].reject(new Error("offline")));
    await settle();
    expect(activeLeaveGuard()).toBeNull();
  });

  it("asks once a file of the original was taken off by hand", async () => {
    await open(forwarded());
    await answer(batches[0], [{ index: 2, contentBase64: "JVBERi0=" }, { index: 3, contentBase64: "AAEC" }]);
    await tap(all("compose-carried-remove")[1]);
    expect(carried()).toEqual(["Angebot.pdf|ready|412 KB"]);
    expect(activeLeaveGuard()?.id).toBe("mail-compose");
  });
});

describe("a file that did not come", () => {
  it("says so, offers to ask again, and Send asks before the message leaves without it", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await open(forwarded());
    // The mailbox has no file under index 3 any more.
    await answer(batches[0], [{ index: 2, contentBase64: "JVBERi0=" }]);
    expect(carried()).toEqual(["Angebot.pdf|ready|412 KB", `Begehung.mp4|failed|${i18n.t("mail.fileState.failed")}`]);
    expect(q("compose-files-failed")?.textContent).toBe(i18n.t("mail.fileFailure.missing"));
    // Nothing is on its way: the buttons are back, and they ask.
    expect(sendButton().disabled).toBe(false);

    await type(recipient(), "ben@example.org");
    await tap(sendButton());
    const asked = question();
    expect(asked?.title).toBe(i18n.t("mail.sendWithoutTitle"));
    expect(asked?.message).toBe(`Begehung.mp4 (${i18n.t("mail.fileLeft.failed")})`);
    expect(asked?.confirmLabel).toBe(i18n.t("mail.sendWithout"));
    expect(left, "the composer stays while the question stands").toBe(0);

    // "No" keeps everything where it was.
    await reply(false);
    expect(left).toBe(0);
    expect(mocks.sendMail).not.toHaveBeenCalled();
    expect(recipient().value).toBe("ben@example.org");

    // "Yes" sends what is there.
    await tap(sendButton());
    await reply(true);
    expect(left).toBe(1);
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(sentFiles()).toEqual(["Angebot.pdf"]);
  });

  it("comes when it is asked for again", async () => {
    await open(forwarded());
    await act(async () => batches[0].reject(new Error("offline")));
    await settle();
    expect(carried().map((row) => row.split("|")[1])).toEqual(["failed", "failed"]);
    // The mailbox's own words stay with the sentence.
    expect(q("compose-files-failed")?.textContent).toBe(`${i18n.t("mail.fileFailure.failed")} (offline)`);

    await tap(q("compose-carried-retry-all"));
    expect(batches).toHaveLength(2);
    expect(batches[1].args.indexes).toEqual([2, 3]);
    await answer(batches[1], [{ index: 2, contentBase64: "JVBERi0=" }, { index: 3, contentBase64: "AAEC" }]);
    expect(carried().map((row) => row.split("|")[1])).toEqual(["ready", "ready"]);
    expect(q("compose-files-failed")).toBeNull();
  });

  it("is asked for alone from its own row", async () => {
    await open(forwarded());
    await answer(batches[0], [{ index: 2, contentBase64: "JVBERi0=" }]);
    await tap(q("compose-carried-retry"));
    expect(batches[1].args.indexes).toEqual([3]);
  });

  it("names a mailbox that was renumbered since the message was read", async () => {
    await open(forwarded());
    await act(async () => batches[0].reject(new Error(MAIL_MAILBOX_CHANGED)));
    await settle();
    expect(q("compose-files-failed")?.textContent).toBe(i18n.t("mail.fileFailure.changed"));
  });

  it("is not asked about when it was taken off by hand", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await open(forwarded());
    await answer(batches[0], [{ index: 2, contentBase64: "JVBERi0=" }]);
    await tap(all("compose-carried-remove")[1]);
    await type(recipient(), "ben@example.org");
    await tap(sendButton());
    expect(question(), "taking the file off was the answer").toBeNull();
    expect(left).toBe(1);
  });
});

describe("a mailbox that does not take every file", () => {
  it("leaves a file over Microsoft's bound behind by name, without fetching it, and asks before sending", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // The message lies in the IMAP mailbox; it is sent from the Microsoft one.
    await open(forwarded("ms"));
    expect(batches[0].args.indexes).toEqual([2]);
    expect(carried()).toEqual([`Angebot.pdf|loading|${loadingNote("412 KB")}`, `Begehung.mp4|left|${tooLargeNote("7 MB")}`]);
    // The bound is said with its number, as the reader writes sizes.
    expect(q("compose-files-limit")?.textContent).toBe(mailboxBound());
    expect(mailboxBound()).toContain(formatAttachmentSize(GRAPH_FILE_LIMIT, i18n.language));
    expect(mailboxBound()).not.toContain("{{");

    await answer(batches[0], [{ index: 2, contentBase64: "JVBERi0=" }]);
    expect(sendButton().disabled).toBe(false);
    await type(recipient(), "ben@example.org");
    await tap(sendButton());
    expect(question()?.message).toBe(`Begehung.mp4 (${i18n.t("mail.fileLeft.tooLarge")})`);
    await reply(true);
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(sentFiles()).toEqual(["Angebot.pdf"]);
  });

  it("holds a file attached by hand against the same bound — it used to fail after the screen had closed", async () => {
    await open({ accountId: "ms", to: "", subject: "", body: "" });
    await tap(q("compose-attach"));
    await tap(q("pick-file"));
    const row = q("compose-attachment")!;
    expect(row.dataset.state).toBe("left");
    expect(row.querySelector("small")?.textContent).toBe(i18n.t("mail.fileState.tooLarge"));
    expect(q("compose-files-limit")?.textContent).toBe(mailboxBound());

    await type(recipient(), "ben@example.org");
    await tap(sendButton());
    expect(question()?.message).toBe(`Film.mp4 (${i18n.t("mail.fileLeft.tooLarge")})`);
  });

  it("takes the same file over IMAP: Plainva sets no bound for a file a person chose", async () => {
    await open({ accountId: "m1", to: "", subject: "", body: "" });
    await tap(q("compose-attach"));
    await tap(q("pick-file"));
    expect(q("compose-attachment")?.dataset.state).toBe("ready");
    expect(q("compose-files-limit")).toBeNull();
  });

  it("asks before a draft is filed without a file, in the draft's own words", async () => {
    await open(forwarded("ms"));
    await answer(batches[0], [{ index: 2, contentBase64: "JVBERi0=" }]);
    await tap(q("compose-save-draft"));
    expect(question()?.title).toBe(i18n.t("mail.draftWithoutTitle"));
    expect(question()?.confirmLabel).toBe(i18n.t("mail.draftWithout"));
    expect(mocks.appendDraft).not.toHaveBeenCalled();
    await reply(true);
    expect((mocks.appendDraft.mock.calls[0][6] as MailAttachment[]).map((a) => a.name)).toEqual(["Angebot.pdf"]);
  });
});

describe("both ways to send wait", () => {
  it("closes the icon in the bar together with the button under the body", async () => {
    await open(forwarded());
    const icon = sendIcon();
    expect(icon, "the bar's send icon is on screen").not.toBeNull();
    expect(icon!.disabled).toBe(true);
    await answer(batches[0], [{ index: 2, contentBase64: "JVBERi0=" }, { index: 3, contentBase64: "AAEC" }]);
    expect(sendIcon()!.disabled).toBe(false);
  });

  it("opens them when the last file on its way is taken off", async () => {
    await open(forwarded());
    for (const remove of all("compose-carried-remove")) await tap(remove);
    expect(carried()).toEqual([]);
    expect(sendButton().disabled).toBe(false);
  });
});
