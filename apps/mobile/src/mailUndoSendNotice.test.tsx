// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toast, toastStore } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { UNDO_SEND_MS } from "@plainva/ui/mail";
import { MailComposeScreen } from "./screens/MailComposeScreen";

/**
 * The notice that carries "Undo" for a delayed send, on the phone.
 *
 * It is a persistent toast: nothing takes it down but its owner. The queue
 * that owns it forgot the notice's id after a delivery and never dismissed the
 * notice itself — so after every sent mail "Sending in 8 s · Undo" stayed over
 * the tab bar until it was closed by hand, with a button that could no longer
 * stop anything.
 *
 * The rule asserted here is the one the handbook states: the notice keeps
 * "Undo" ready WHILE the message waits. That window ends when the timer runs
 * out, when the app goes to the background, or when a second message pushes
 * the first one out — and in that moment the notice goes, before the transport
 * has answered. What the transport then says stands on its own.
 *
 * This renders the screen and reads the real toast store. The queue and the
 * notice's id are private to the module, and a source-text guard would have
 * passed all along: the id was being "handled" — set, and reset — the whole
 * time.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** What the phone tells the module's own listener, as Capacitor would. */
const app = vi.hoisted(() => ({ listeners: new Map<string, (state: { isActive: boolean }) => void>() }));
/** One transport call per message; the test decides when and how each one ends. */
const transport = vi.hoisted(() => ({
  calls: [] as Array<{ subject: string; resolve: () => void; reject: (reason: unknown) => void }>,
}));

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: (event: string, handler: (state: { isActive: boolean }) => void) => {
      app.listeners.set(event, handler);
      return Promise.resolve({ remove: async () => {} });
    },
  },
}));
vi.mock("./services/mail/mailRuntime", () => ({
  listMobileMailAccounts: async () => [{ id: "m1", label: "Work", host: "", port: 0, user: "anna@example.org", kind: "microsoft" }],
  mailVaultId: () => "/vault",
}));
vi.mock("@plainva/ui/mail", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendMail: (_vault: string, _account: unknown, _to: string, subject: string) =>
    new Promise<void>((resolve, reject) => {
      transport.calls.push({ subject, resolve, reject });
    }),
}));
// The body editor is CodeMirror, and not what is being asked about here.
vi.mock("./screens/mail/MailComposeEditor", () => ({ MailComposeEditor: () => null }));

let container: HTMLDivElement;
let root: Root;

/** The notices that stay until their owner takes them down — here: the one with "Undo". */
const notices = () => toastStore.get().filter((item) => item.persistent);
/** What the app said in passing, by kind. */
const said = (kind: string) =>
  toastStore
    .get()
    .filter((item) => item.kind === kind && !item.persistent)
    .map((item) => item.message);
const sentSubjects = () => transport.calls.map((call) => call.subject);

const pass = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

/** A fresh composer with an addressed message, as "reply" or "new" opens it. */
async function compose(subject: string) {
  await act(async () => {
    root.render(
      <MailComposeScreen
        key={subject}
        draft={{ accountId: "m1", to: "ben@example.org", subject, body: "Text" }}
        onBack={() => {}}
        vault={{} as never}
      />,
    );
  });
  // The account list arrives one tick later; without it Send has no mailbox.
  await pass(0);
}

async function tapSend() {
  const label = i18n.t("mail.send");
  const hits = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).filter((b) => b.textContent?.trim() === label);
  const send = hits[hits.length - 1];
  expect(send, "the composer offers Send").toBeTruthy();
  await act(async () => send.click());
}

const goToBackground = () => app.listeners.get("appStateChange")?.({ isActive: false });

beforeEach(() => {
  vi.useFakeTimers();
  toast.clearAll();
  transport.calls.length = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  // The queue is the module's, not the screen's: nothing may wait into the
  // next test.
  goToBackground();
  for (const call of transport.calls) call.resolve();
  await pass(0);
  act(() => root.unmount());
  container.remove();
  toast.clearAll();
  vi.useRealTimers();
});

describe("the undo notice of a delayed send", () => {
  it("is gone when the window is over, and the outcome stands on its own", async () => {
    await compose("First");
    await tapSend();

    // While the message waits, the notice is the way back.
    expect(notices()).toHaveLength(1);
    expect(notices()[0].action?.label).toBe(i18n.t("common.undo"));
    expect(sentSubjects()).toEqual([]);

    await pass(UNDO_SEND_MS);
    // The transport has the message and has not answered yet. "Undo" can no
    // longer stop anything, so the notice that offers it is gone already.
    expect(sentSubjects()).toEqual(["First"]);
    expect(notices()).toEqual([]);

    transport.calls[0].resolve();
    await pass(0);
    expect(notices()).toEqual([]);
    expect(said("success")).toEqual([i18n.t("mail.sent")]);
  });

  it("is gone when the server refuses the message — the error stands alone", async () => {
    await compose("Refused");
    await tapSend();
    await pass(UNDO_SEND_MS);

    transport.calls[0].reject(new Error("550 mailbox unavailable"));
    await pass(0);
    expect(notices()).toEqual([]);
    expect(said("error")).toEqual(["550 mailbox unavailable"]);
    expect(said("success")).toEqual([]);
  });

  it("is gone when the app goes to the background and the message is sent at once", async () => {
    await compose("Background");
    await tapSend();
    expect(notices()).toHaveLength(1);

    goToBackground();
    await pass(0);
    // Sent now rather than dropped — and whoever comes back to the app does
    // not find a notice counting down to something that has already happened.
    expect(sentSubjects()).toEqual(["Background"]);
    expect(notices()).toEqual([]);

    transport.calls[0].resolve();
    await pass(UNDO_SEND_MS * 2);
    // Exactly once: the timer that was still running sends nothing again.
    expect(sentSubjects()).toEqual(["Background"]);
    expect(notices()).toEqual([]);
  });

  it("belongs to its own message when a second one follows", async () => {
    await compose("First");
    await tapSend();
    const first = notices()[0].id;

    // A second message pushes the first one out: it is sent at once, and its
    // window — with its notice — is over.
    await pass(1000);
    await compose("Second");
    await tapSend();
    expect(sentSubjects()).toEqual(["First"]);
    expect(notices()).toHaveLength(1);
    expect(notices()[0].id).not.toBe(first);

    // The first delivery ends while the second message still waits. That
    // notice is not the first one's to take down ...
    transport.calls[0].resolve();
    await pass(0);
    expect(notices()).toHaveLength(1);

    // ... and its "Undo" still stops the message it stands for.
    const second = notices()[0];
    act(() => second.action!.run());
    expect(said("info")).toContain(i18n.t("mail.sendCancelled"));
    expect(notices()).toEqual([]);
    await pass(UNDO_SEND_MS * 2);
    expect(sentSubjects()).toEqual(["First"]);
  });
});
