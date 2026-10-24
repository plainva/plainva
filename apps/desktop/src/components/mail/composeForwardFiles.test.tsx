// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "@plainva/ui/i18n";
import { setPlatformServices } from "@plainva/ui";
import type { ComposeSnapshot } from "../../services/mail/composeHandoff";
import type { FetchedAttachment, ForwardSource, MailAttachment, MailTransport } from "@plainva/ui/mail";

/**
 * The desktop composer and the files of a forwarded original (plan
 * "Weiterleiten nimmt die Anhänge mit", B4).
 *
 * The rule (what goes for which mailbox) and the loading are held at the
 * shared building block, and the flow through the running app in
 * `e2e/mail.spec.ts`. This holds what only the composer decides: which files
 * a send and a filed draft are handed, what becomes of a calendar file, what a
 * composer takes along when it is popped out, and that the sender's bound
 * reaches a file attached by hand.
 *
 * The editor is a plain textarea and the transport answers when the test says
 * so; everything between them is the real code.
 */

const mocks = vi.hoisted(() => ({
  accounts: [] as unknown[],
  sent: [] as Array<Record<string, unknown>>,
  drafted: [] as Array<Record<string, unknown>>,
  picked: { path: "C:\\Videos\\Film.mp4", bytes: new Uint8Array(0) as Uint8Array },
}));

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
    listMailAccounts: async () => mocks.accounts,
    listMailboxesFor: async () => [{ name: "Drafts", role: "drafts" }],
  };
});
vi.mock("../../services/mail/sendQueue", () => ({
  submitSend: async (req: Record<string, unknown>) => {
    mocks.sent.push(req);
  },
  submitDraft: async (req: Record<string, unknown>) => {
    mocks.drafted.push(req);
  },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: async () => mocks.picked.path }));
vi.mock("@tauri-apps/plugin-fs", () => ({ readFile: async () => mocks.picked.bytes }));

import { GRAPH_FILE_LIMIT, setMailPlatform } from "@plainva/ui/mail";
import { DialogHost } from "../ui/DialogHost";
import { dialogStore } from "../../services/appDialogs";
import { MailDraftModal } from "./MailDraftModal";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const imap = { id: "i1", label: "Work", host: "imap.example.org", port: 993, user: "me@example.org", smtpHost: "smtp.example.org" };
const microsoft = { id: "m1", label: "Microsoft", host: "", port: 993, user: "me@example.com", kind: "microsoft", clientId: "cid" };

const ICS = "QkVHSU46VkNBTEVOREFS"; // BEGIN:VCALENDAR
const source: ForwardSource = {
  accountId: "i1",
  mailbox: "INBOX",
  messageId: "7",
  files: [
    { index: 0, name: "Angebot.pdf", mime: "application/pdf", size: 400 * 1024 },
    // A calendar file that came with the mail — typed the way a server types
    // an invitation.
    { index: 1, name: "termin.ics", mime: "text/calendar; method=REQUEST; charset=UTF-8", size: 2048 },
  ],
};

/** One call to the mailbox for files, answered by the test. */
interface Batch {
  indexes: number[];
  resolve(found: FetchedAttachment[]): void;
}
let batches: Batch[] = [];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  mocks.accounts = [imap, microsoft];
  mocks.sent.length = 0;
  mocks.drafted.length = 0;
  mocks.picked = { path: "C:\\Videos\\Film.mp4", bytes: new Uint8Array(0) };
  batches = [];
  setPlatformServices({
    loadSettings: async () => ({ get: async () => undefined, set: async () => {}, delete: async () => true, keys: async () => [], save: async () => {} }),
    credentials: { readSecret: async <T,>() => ({ pass: "secret" }) as T, writeSecret: async () => {}, removeSecret: async () => {} },
    openExternal: async () => {},
  });
  const transport = {
    fetchAttachments: (_creds: unknown, args: { indexes: number[] }) =>
      new Promise<FetchedAttachment[]>((resolve) => {
        batches.push({ indexes: args.indexes, resolve });
      }),
  } as unknown as MailTransport;
  setMailPlatform({ transport, http: { api: fetch, token: fetch } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  dialogStore.clearAll();
});

/** Lets the account lookup, the credential lookup and a settled answer land. */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

async function open(el: ReactElement) {
  act(() =>
    root.render(
      <>
        {el}
        <DialogHost />
      </>,
    ),
  );
  await settle();
}
async function answer(batch: Batch, found: FetchedAttachment[]) {
  await act(async () => batch.resolve(found));
  await settle();
}

const byTestId = <T extends HTMLElement>(id: string) => document.querySelector(`[data-testid="${id}"]`) as T | null;
const all = (id: string) => [...document.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
/** Each file of the original as "name|state". */
const carried = () => all("draft-carried").map((chip) => `${chip.querySelector(".pv-mail-attach-name")?.textContent}|${chip.dataset.state}`);
/** Each other file on the draft as "name|state". */
const others = () => all("draft-attachments").map((chip) => `${chip.querySelector(".pv-mail-attach-name")?.textContent}|${chip.dataset.state}`);
const question = () => document.querySelector(".pv-overlay--dialog");
const answerQuestion = async (confirm: boolean) => {
  const buttons = [...question()!.querySelectorAll<HTMLButtonElement>(".pv-modal-footer button")];
  await act(async () => buttons[confirm ? buttons.length - 1 : 0]!.click());
  await settle();
};

function fire(el: HTMLElement, event: Event) {
  act(() => {
    el.dispatchEvent(event);
  });
}
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
async function click(id: string) {
  const el = byTestId(id);
  expect(el, `${id} is on screen`).not.toBeNull();
  await act(async () => el!.click());
  await settle();
}
/** Attaches the file the picker hands out, and waits until its chip is there. */
async function attachPicked() {
  const before = all("draft-attachments").length;
  await click("draft-attach-file");
  for (let i = 0; i < 50 && all("draft-attachments").length === before; i++) await settle();
  expect(all("draft-attachments")).toHaveLength(before + 1);
}

const forwardOf = (extra: Partial<Parameters<typeof MailDraftModal>[0]> = {}) => (
  <MailDraftModal subject="Fwd: Angebot" markdown="anbei" forward={source} onClose={() => {}} {...extra} />
);
const files = (req: Record<string, unknown>) => (req.attachments as MailAttachment[]).map((a) => `${a.name}|${a.mime}`);

describe("a forward in the desktop composer", () => {
  it("draws each file of the original with its state, and Send and Save draft wait for them", async () => {
    await open(forwardOf());
    expect(batches).toHaveLength(1);
    expect(batches[0].indexes).toEqual([0, 1]);
    expect(carried()).toEqual(["Angebot.pdf|loading", "termin.ics|loading"]);
    expect(byTestId("draft-files-loading")?.textContent).toBe(`${i18n.t("mail.filesLoading", { count: 2 })} ${i18n.t("mail.filesWaiting")}`);
    expect(byTestId<HTMLButtonElement>("draft-send")!.disabled).toBe(true);
    expect(byTestId<HTMLButtonElement>("draft-save")!.disabled).toBe(true);

    await answer(batches[0], [{ index: 0, contentBase64: "JVBERi0=" }, { index: 1, contentBase64: ICS }]);
    expect(carried()).toEqual(["Angebot.pdf|ready", "termin.ics|ready"]);
    expect(byTestId("draft-files-loading")).toBeNull();
    expect(byTestId<HTMLButtonElement>("draft-send")!.disabled).toBe(false);
    expect(byTestId<HTMLButtonElement>("draft-save")!.disabled).toBe(false);
  });

  it("sends a calendar file of the original as a file — it does not invite anyone in the forwarder's name", async () => {
    await open(forwardOf());
    await answer(batches[0], [{ index: 0, contentBase64: "JVBERi0=" }, { index: 1, contentBase64: ICS }]);
    type(byTestId("draft-to")!, "ben@example.org");
    await click("draft-send");

    expect(question(), "everything on the draft goes").toBeNull();
    expect(mocks.sent).toHaveLength(1);
    expect(mocks.sent[0].calendar).toBeUndefined();
    // Its type in the form a transport takes, the method gone with the rest.
    expect(files(mocks.sent[0])).toEqual(["Angebot.pdf|application/pdf", "termin.ics|text/calendar"]);
  });

  it("asks before a message leaves without a file that did not come, in the words of the way out", async () => {
    await open(forwardOf());
    // The mailbox no longer has the second file.
    await answer(batches[0], [{ index: 0, contentBase64: "JVBERi0=" }]);
    expect(carried()).toEqual(["Angebot.pdf|ready", "termin.ics|failed"]);
    expect(byTestId("draft-files-failed")?.textContent).toBe(i18n.t("mail.fileFailure.missing"));
    type(byTestId("draft-to")!, "ben@example.org");

    await click("draft-send");
    expect(question()?.textContent).toContain(i18n.t("mail.sendWithoutTitle"));
    expect(question()?.textContent).toContain(`termin.ics (${i18n.t("mail.fileLeft.failed")})`);
    await answerQuestion(false);
    expect(mocks.sent).toEqual([]);

    await click("draft-save");
    expect(question()?.textContent).toContain(i18n.t("mail.draftWithoutTitle"));
    await answerQuestion(true);
    expect(mocks.drafted).toHaveLength(1);
    expect(files(mocks.drafted[0])).toEqual(["Angebot.pdf|application/pdf"]);
  });

  it("does not ask when the file was taken off by hand", async () => {
    await open(forwardOf());
    await answer(batches[0], [{ index: 0, contentBase64: "JVBERi0=" }]);
    await act(async () => all("draft-carried-remove")[1]!.click());
    await settle();
    expect(carried()).toEqual(["Angebot.pdf|ready"]);
    type(byTestId("draft-to")!, "ben@example.org");
    await click("draft-send");
    expect(question()).toBeNull();
    expect(files(mocks.sent[0])).toEqual(["Angebot.pdf|application/pdf"]);
  });

  it("takes the files along when it is popped out — the bytes that are here, and the reference for the rest", async () => {
    const popped: ComposeSnapshot[] = [];
    await open(forwardOf({ onPopOut: (snapshot) => popped.push(snapshot) }));
    await answer(batches[0], [{ index: 0, contentBase64: "JVBERi0=" }]);
    await click("draft-popout");

    expect(popped).toHaveLength(1);
    const snapshot = popped[0]!;
    expect(snapshot.carried?.source).toEqual(source);
    expect(snapshot.carried?.files.map((file) => `${file.name}|${file.load}`)).toEqual(["Angebot.pdf|ready", "termin.ics|failed"]);
    // They travel once: the opened state names them, it does not hold them.
    expect(JSON.stringify(snapshot.opened)).not.toContain("JVBERi0=");
    expect(snapshot.attachments).toEqual([]);

    // The new window goes on where the first one was: nothing is asked for
    // again that is already here.
    act(() => root.unmount());
    root = createRoot(container);
    batches = [];
    await open(<MailDraftModal variant="window" restore={snapshot} subject={snapshot.subject} markdown={snapshot.body} onClose={() => {}} />);
    expect(carried()).toEqual(["Angebot.pdf|ready", "termin.ics|failed"]);
    expect(batches).toEqual([]);
    // And it is the same draft: untouched in the first window, untouched here.
    await click("draft-cancel");
    expect(question()).toBeNull();
  });
});

describe("the invitation a draft arrived with", () => {
  const invitation: MailAttachment = { name: "invite.ics", mime: "text/calendar; method=REQUEST; charset=UTF-8", contentBase64: ICS };

  it("is sent as an invitation — the one file that is lifted into the message", async () => {
    await open(<MailDraftModal subject="Besprechung" markdown="" attachments={[invitation]} onClose={() => {}} />);
    type(byTestId("draft-to")!, "ben@example.org");
    await click("draft-send");
    expect(mocks.sent[0].calendar).toEqual({ ics: "BEGIN:VCALENDAR", method: "REQUEST" });
    expect(files(mocks.sent[0])).toEqual([]);
  });

  it("is filed as the calendar file it is — a draft used to be refused for its type", async () => {
    await open(<MailDraftModal subject="Besprechung" markdown="" attachments={[invitation]} onClose={() => {}} />);
    type(byTestId("draft-to")!, "ben@example.org");
    await click("draft-save");
    expect(mocks.drafted).toHaveLength(1);
    expect(files(mocks.drafted[0])).toEqual(["invite.ics|text/calendar"]);
  });

  it("stays a file when it is a calendar file somebody attached by hand", async () => {
    mocks.picked = { path: "C:\\Termine\\urlaub.ics", bytes: new TextEncoder().encode("BEGIN:VCALENDAR") };
    await open(<MailDraftModal subject="Urlaub" markdown="" onClose={() => {}} />);
    await attachPicked();
    expect(others()).toEqual(["urlaub.ics|ready"]);
    type(byTestId("draft-to")!, "ben@example.org");
    await click("draft-send");
    // Until 2026-10 the first calendar file of any kind was lifted, and the
    // recipient was invited to somebody's holiday.
    expect(mocks.sent[0].calendar).toBeUndefined();
    expect(files(mocks.sent[0])).toEqual(["urlaub.ics|text/calendar"]);
  });
});

describe("the sending mailbox's bound reaches every file on the draft", () => {
  it("holds a file attached by hand against a Microsoft mailbox's bound, and lets it go over IMAP", async () => {
    mocks.picked = { path: "C:\\Videos\\Film.mp4", bytes: new Uint8Array(GRAPH_FILE_LIMIT + 1) };
    // The first mailbox is the sender: Microsoft.
    mocks.accounts = [microsoft, imap];
    await open(<MailDraftModal subject="Film" markdown="" onClose={() => {}} />);
    await attachPicked();
    expect(others()).toEqual(["Film.mp4|left"]);
    expect(byTestId("draft-files-limit")?.textContent).not.toContain("{{");

    // It used to go to the mailbox as it was and fail there, after the window
    // had closed. Now the composer asks first, and sends without it.
    type(byTestId("draft-to")!, "ben@example.org");
    await click("draft-send");
    expect(question()?.textContent).toContain(`Film.mp4 (${i18n.t("mail.fileLeft.tooLarge")})`);
    await answerQuestion(true);
    expect(files(mocks.sent[0])).toEqual([]);
  });

  it("sets no bound of its own for a file a person chose, over IMAP", async () => {
    mocks.picked = { path: "C:\\Videos\\Film.mp4", bytes: new Uint8Array(GRAPH_FILE_LIMIT + 1) };
    await open(<MailDraftModal subject="Film" markdown="" onClose={() => {}} />);
    await attachPicked();
    expect(others()).toEqual(["Film.mp4|ready"]);
    expect(byTestId("draft-files-limit")).toBeNull();
  });
});
