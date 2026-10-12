// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { setPlatformServices, toast, toastStore } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { senderKey, setMailPlatform, type MailAttachment, type MailTransport } from "@plainva/ui/mail";
import { MailComposeScreen, type MailDraft } from "./screens/MailComposeScreen";
import { draftPath, parseDraft } from "./screens/mail/mailNavRefs";
import { useDeepLinkNav } from "./hooks/useDeepLinkNav";
import { initialNavState, navTop, type NavState } from "./navigation";
import { activeLeaveGuard, armLeaveGuard, resetLeaveGuard } from "./services/leaveGuard";
import { currentMobileDialog, dismissMobileDialog } from "./services/mobileDialogs";
import { createNavActions } from "./services/navActions";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * A message the mail server refuses comes back (plan "Weiterleiten nimmt die
 * Anhänge mit", part D) — on the phone.
 *
 * The compose screen is gone when the server answers, eight seconds after
 * "Send". A refusal used to be one line of error text; the recipients, the
 * text and the files a person had picked were gone with it. Held here is what
 * a person meets: a notice that says why and stays, the way back from it, and
 * a composer that opens with everything the message was sent with — as
 * unsaved work, so leaving it asks.
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
    <button type="button" data-testid="pick-file" onClick={() => onPick("Unterlagen/Skizze.png")} />
  ),
}));
vi.mock("@plainva/ui/mail", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendMail: mocks.sendMail,
  appendDraft: mocks.appendDraft,
  listMailboxesFor: vi.fn(async () => [{ name: "Entwürfe", role: "drafts" }]),
}));

/** One mailbox with a second address to send from, and a signature. */
const mailbox = {
  id: "m1",
  label: "anna@example.org",
  host: "imap.example.org",
  port: 993,
  smtpHost: "smtp.example.org",
  smtpPort: 587,
  user: "anna@example.org",
  kind: "imap",
  senders: ["team@example.org"],
  signature: "Anna Beispiel",
};

let container: HTMLDivElement;
let root: Root;
let left: number;
let nav: ReturnType<typeof createNavActions>;

beforeEach(() => {
  mocks.accounts = [mailbox];
  mocks.sendMail.mockReset();
  mocks.sendMail.mockImplementation(async () => undefined);
  mocks.appendDraft.mockClear();
  resetLeaveGuard();
  toast.clearAll();
  left = 0;
  nav = createNavActions(() => void (left += 1), () => {});
  setPlatformServices({
    loadSettings: async () => ({ get: async () => undefined, set: async () => {}, delete: async () => true, keys: async () => [], save: async () => {} }),
    credentials: { readSecret: async <T,>() => ({ pass: "secret" }) as T, writeSecret: async () => {}, removeSecret: async () => {} },
    openExternal: async () => {},
  });
  setMailPlatform({ transport: {} as MailTransport, http: { api: fetch, token: fetch } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  const open = currentMobileDialog();
  if (open) dismissMobileDialog(open);
  act(() => root.unmount());
  container.remove();
  toast.clearAll();
  vi.useRealTimers();
});

const vault = { vaultId: "/vault", files: { readBinaryFile: async () => new Uint8Array([137, 80, 78, 71]) } } as never;

const settle = () =>
  act(async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  });

/** Renders the composer for a draft — a new screen for a new draft, like a pushed entry. */
async function open(draft: MailDraft) {
  await act(async () => {
    root.render(<MailComposeScreen key={draftPath(draft)} draft={draft} onBack={nav.pop} onDone={nav.done} vault={vault} />);
  });
  await settle();
}

/** What the shell does when the composer says it is done: the screen is popped. */
async function closeScreen() {
  await act(async () => {
    root.render(<div />);
  });
  await settle();
}

const q = <T extends HTMLElement = HTMLElement>(testId: string) => container.querySelector<T>(`[data-testid="${testId}"]`);
const all = (testId: string) => [...container.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`)];
const recipient = () => container.querySelector<HTMLInputElement>('input[placeholder="name@example.com"]')!;
const subjectField = () =>
  [...container.querySelectorAll<HTMLLabelElement>("label.m-field")]
    .find((label) => label.querySelector("span")?.textContent === i18n.t("mail.draftSubject"))!
    .querySelector<HTMLInputElement>("input")!;
const bodyField = () => q<HTMLTextAreaElement>("compose-body")!;
const sendButton = () => container.querySelector<HTMLButtonElement>("button.pv-btn--primary")!;
const files = () => all("compose-attachment").map((row) => row.querySelector(".m-linestack > span")?.textContent?.trim());

const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
const setAreaValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
async function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    (el instanceof HTMLTextAreaElement ? setAreaValue : setInputValue).call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function tap(el: Element | null) {
  expect(el, "the control is on screen").not.toBeNull();
  await act(async () => (el as HTMLElement).click());
  await settle();
}
/** Lets the undo window pass and the mailbox answer. */
async function deliver() {
  await act(async () => {
    await vi.runAllTimersAsync();
  });
  await settle();
}

/** The notices that stand for a message the mail server refused. */
const owed = () => toastStore.get().filter((item) => item.owed);
const SIZE_REFUSAL = "the server rejected the message: 552 5.3.4 Message size exceeds fixed maximum message size";
/** What the mailbox was handed on the n-th send: recipient, subject, text, files, and the address it went from. */
const sent = (n: number) => {
  const call = mocks.sendMail.mock.calls[n] as unknown[];
  return { to: call[2] as string, subject: call[3] as string, body: call[4] as string, files: call[5] as MailAttachment[], from: call[9] as string };
};

/** Writes a message with a file on it and sends it into a refusal. */
async function sendIntoRefusal(reason = SIZE_REFUSAL) {
  mocks.sendMail.mockImplementationOnce(async () => {
    throw new Error(reason);
  });
  await open({ accountId: "m1", to: "", subject: "", body: "" });
  await type(recipient(), "ben@example.org");
  await type(subjectField(), "Skizze zum Angebot");
  await type(bodyField(), `Hallo Ben,\n\nanbei die Skizze.\n\n${bodyField().value}`);
  await tap(q("compose-attach"));
  await tap(q("pick-file"));
  expect(files()).toEqual(["Skizze.png"]);
  await tap(sendButton());
  expect(left, "the composer closes when the message is sent").toBe(1);
  await closeScreen();
  await deliver();
}

/** The shell's part: the hook that turns a notice into a pushed screen, on a nav state the test reads. */
async function mountShell() {
  const seen: { state: NavState | null } = { state: null };
  function Shell() {
    const [state, setState] = useState<NavState>(() => initialNavState("mail"));
    useDeepLinkNav(setState);
    useEffect(() => {
      seen.state = state;
    });
    return null;
  }
  const shell = createRoot(document.createElement("div"));
  await act(async () => shell.render(<Shell />));
  return { seen, unmount: () => act(async () => shell.unmount()) };
}

describe("a message the mail server refused, on the phone", () => {
  it("is kept: the notice says why, stays, and is not a line said in passing", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await sendIntoRefusal();

    expect(mocks.sendMail).toHaveBeenCalledTimes(1);
    expect(owed()).toHaveLength(1);
    expect(owed()[0].kind).toBe("error");
    expect(owed()[0].persistent).toBe(true);
    // A refusal for size is said in words, not in the server's.
    expect(owed()[0].message).toBe(i18n.t("mail.sendFailed", { reason: i18n.t("mail.sendTooLarge") }));
    expect(owed()[0].action?.label).toBe(i18n.t("mail.sendReopen"));
    expect(toastStore.get().filter((item) => item.kind === "error" && !item.owed)).toEqual([]);
  });

  it("keeps any other refusal's own words", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const reason = "the server rejected ben@example.org: 550 mailbox unavailable";
    await sendIntoRefusal(reason);
    expect(owed()[0].message).toBe(i18n.t("mail.sendFailed", { reason }));
  });

  it("comes back through the shell as a draft that names it, and opens with everything it was sent with", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await sendIntoRefusal();
    const first = sent(0);
    expect(first.files.map((file) => file.name)).toEqual(["Skizze.png"]);

    // The shell: the notice's action pushes the composer.
    const shell = await mountShell();
    await act(async () => owed()[0].action!.run());
    await settle();
    const top = navTop(shell.seen.state!);
    expect(top?.kind).toBe("mailcompose");
    const draft = parseDraft(top!.path);
    expect(draft.refused).toBeGreaterThan(0);
    // The path names the message. Its text and its files are not in it.
    expect(top!.path).not.toContain("Skizze");
    expect(top!.path).not.toContain("contentBase64");
    // Asking for the way back did not let go of it.
    expect(owed()).toHaveLength(1);

    // The composer that entry renders.
    await open(draft);
    expect(recipient().value).toBe(first.to);
    expect(subjectField().value).toBe(first.subject);
    // The text as it was sent — its signature is there once, not twice.
    expect(bodyField().value).toBe(first.body);
    expect(bodyField().value.split("Anna Beispiel")).toHaveLength(2);
    expect(files()).toEqual(["Skizze.png"]);
    // The composer has it: the notice is gone.
    expect(owed()).toEqual([]);
    // Unsent is unsaved work from the first moment: leaving asks.
    expect(activeLeaveGuard()?.id).toBe("mail-compose");

    // And it goes out again exactly as it was.
    await tap(sendButton());
    await deliver();
    expect(mocks.sendMail).toHaveBeenCalledTimes(2);
    expect(sent(1)).toEqual(first);
    expect(owed()).toEqual([]);
    await shell.unmount();
  });

  it("keeps the address it was sent from", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    mocks.sendMail.mockImplementationOnce(async () => {
      throw new Error("550 mailbox unavailable");
    });
    await open({ accountId: "m1", to: "", subject: "", body: "" });
    // The second address of the mailbox is chosen as the sender.
    await tap(container.querySelector("button.m-row"));
    const picker = currentMobileDialog();
    expect(picker?.kind).toBe("select");
    await act(async () => {
      if (picker?.kind === "select") picker.resolve(senderKey("m1", "team@example.org"));
      dismissMobileDialog(picker!);
    });
    await settle();
    await type(recipient(), "ben@example.org");
    await tap(sendButton());
    await closeScreen();
    await deliver();
    expect(sent(0).from).toBe("team@example.org");

    const shell = await mountShell();
    await act(async () => owed()[0].action!.run());
    await settle();
    await open(parseDraft(navTop(shell.seen.state!)!.path));
    await tap(sendButton());
    await deliver();
    // Not the mailbox's first address again.
    expect(sent(1).from).toBe("team@example.org");
    await shell.unmount();
  });

  it("asks before it is pushed over a screen with unsaved work, and stays held when that work is kept", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await sendIntoRefusal();
    const shell = await mountShell();
    const before = shell.seen.state;
    // Another screen holds unsaved work — only the topmost screen is rendered,
    // so pushing over it would take that work away.
    armLeaveGuard({ id: "somewhere", message: "unsaved" });

    await act(async () => owed()[0].action!.run());
    await settle();
    const asked = currentMobileDialog();
    expect(asked?.kind).toBe("confirm");
    await act(async () => {
      if (asked?.kind === "confirm") asked.resolve(false);
      dismissMobileDialog(asked!);
    });
    await settle();
    expect(shell.seen.state).toBe(before);
    // Still held, still said.
    expect(owed()).toHaveLength(1);

    // Asked again, and this time the other work is given up: the composer is
    // pushed. (The notice takes a second tap once the first has settled.)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    await act(async () => owed()[0].action!.run());
    await settle();
    const again = currentMobileDialog();
    expect(again?.kind).toBe("confirm");
    await act(async () => {
      if (again?.kind === "confirm") again.resolve(true);
      dismissMobileDialog(again!);
    });
    await settle();
    expect(navTop(shell.seen.state!)?.kind).toBe("mailcompose");
    expect(parseDraft(navTop(shell.seen.state!)!.path).refused).toBeGreaterThan(0);
    await shell.unmount();
  });
});
