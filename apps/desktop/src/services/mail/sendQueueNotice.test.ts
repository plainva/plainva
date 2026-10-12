// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The notice that carries "Undo" for a delayed send, in the central window.
 *
 * `sendQueue.test.ts` asks WHERE a message goes; this asks what the writer is
 * shown while it goes. The notice is a persistent toast, so nothing takes it
 * down but the queue that raised it — and the queue found it through one
 * module-level id, read only after the transport had answered. A second
 * message sent in the meantime had replaced that id by then: the delivery of
 * the first took down the notice of the SECOND (which was still waiting, and
 * lost its "Undo"), and its own notice stayed until it was closed by hand.
 *
 * The rule is the one the handbook states: the notice keeps "Undo" ready WHILE
 * the message waits. That window ends when the timer runs out, when Plainva is
 * closed, or when a second message pushes the first one out — and in that
 * moment the notice goes, before the transport has answered. From then on
 * there is at most one notice, and it belongs to the message that is waiting.
 * What the transport says in the end stands on its own.
 *
 * The toast is observed through the REAL store: what is asserted is what the
 * writer gets, including that the notice is persistent.
 */
import { toast, toastStore } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { UNDO_SEND_MS } from "@plainva/ui/mail";

/** One transport call per message; the test decides when and how each one ends. */
const transport = vi.hoisted(() => ({
  calls: [] as Array<{ subject: string; resolve: () => void; reject: (reason: unknown) => void }>,
}));

vi.mock("../windowContext", () => ({ isOwnerWindow: () => true }));
vi.mock("../windowBus", () => ({
  getWindowBus: async () => ({ request: async () => {} }),
}));
vi.mock("@plainva/ui/mail", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listMailAccounts: async () => [{ id: "a1", label: "Work", user: "me@example.org", smtpHost: "smtp.example.org" }],
  sendMail: (_vault: string, _account: unknown, _to: string, subject: string) =>
    new Promise<void>((resolve, reject) => {
      transport.calls.push({ subject, resolve, reject });
    }),
}));

/** The compose windows the queue asked for; the test decides whether one comes up. */
const windows = vi.hoisted(() => ({
  opened: [] as Array<{ vaultPath: string; title?: string; snapshot: Record<string, unknown> }>,
  fail: null as Error | null,
}));
vi.mock("../windowManager", () => ({
  openComposeWindow: async (params: { vaultPath: string; title?: string; snapshot: Record<string, unknown> }) => {
    if (windows.fail) throw windows.fail;
    windows.opened.push(params);
    return {};
  },
}));

// Loaded up front: the queue imports the window manager on demand, and that
// import must not be what a test waits for.
import "../windowManager";
import { releaseRefusedSend, submitSend, type MailSendRequest } from "./sendQueue";

const request = (subject: string): MailSendRequest => ({
  vaultPath: "/vault",
  accountId: "a1",
  to: "you@example.org",
  subject,
  body: "text",
  attachments: [],
});

/** The notice that offers "Undo" while a message waits: it stays until the queue takes it down. */
const notices = () => toastStore.get().filter((item) => item.persistent && !item.owed);
/** The notices that stand for a message the mail server refused. */
const owed = () => toastStore.get().filter((item) => item.owed);
/** What the app said in passing, by kind. */
const said = (kind: string) =>
  toastStore
    .get()
    .filter((item) => item.kind === kind && !item.persistent)
    .map((item) => item.message);
const sentSubjects = () => transport.calls.map((call) => call.subject);

beforeEach(() => {
  vi.useFakeTimers();
  toast.clearAll();
  transport.calls.length = 0;
  windows.opened.length = 0;
  windows.fail = null;
});

afterEach(async () => {
  // The queue is the module's: nothing may wait into the next test.
  window.dispatchEvent(new Event("beforeunload"));
  for (const call of transport.calls) call.resolve();
  await vi.advanceTimersByTimeAsync(0);
  toast.clearAll();
  vi.useRealTimers();
});

describe("the undo notice of a delayed send", () => {
  it("is gone when the window is over, and the outcome stands on its own", async () => {
    await submitSend(request("First"));

    // While the message waits, the notice is the way back.
    expect(notices()).toHaveLength(1);
    expect(notices()[0].action?.label).toBe(i18n.t("common.undo"));
    expect(sentSubjects()).toEqual([]);

    await vi.advanceTimersByTimeAsync(UNDO_SEND_MS);
    // The transport has the message and has not answered yet. "Undo" can no
    // longer stop anything, so the notice that offers it is gone already.
    expect(sentSubjects()).toEqual(["First"]);
    expect(notices()).toEqual([]);

    transport.calls[0].resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(notices()).toEqual([]);
    // The notice no longer stands in for the outcome, so the outcome is said.
    expect(said("success")).toEqual([i18n.t("mail.sent")]);
  });

  it("is gone when the server refuses the message — and the message is not: it is kept, with its way back", async () => {
    await submitSend(request("Refused"));
    await vi.advanceTimersByTimeAsync(UNDO_SEND_MS);

    transport.calls[0].reject(new Error("550 mailbox unavailable"));
    await vi.advanceTimersByTimeAsync(0);
    expect(notices()).toEqual([]);
    expect(said("success")).toEqual([]);
    // Until 2026-10 the refusal was one passing line of text, and the message
    // — its recipients, its text, its files — was gone with it.
    expect(said("error")).toEqual([]);
    expect(owed()).toHaveLength(1);
    expect(owed()[0].kind).toBe("error");
    expect(owed()[0].message).toBe(i18n.t("mail.sendFailed", { reason: "550 mailbox unavailable" }));
    expect(owed()[0].action?.label).toBe(i18n.t("mail.sendReopen"));
  });

  it("is gone when Plainva is closed and the message is sent at once", async () => {
    await submitSend(request("Closing"));
    expect(notices()).toHaveLength(1);

    window.dispatchEvent(new Event("beforeunload"));
    await vi.advanceTimersByTimeAsync(0);
    expect(sentSubjects()).toEqual(["Closing"]);
    expect(notices()).toEqual([]);

    transport.calls[0].resolve();
    await vi.advanceTimersByTimeAsync(UNDO_SEND_MS * 2);
    // Exactly once: the timer that was still running sends nothing again.
    expect(sentSubjects()).toEqual(["Closing"]);
  });

  it("belongs to its own message when a second one follows", async () => {
    await submitSend(request("First"));
    const first = notices()[0].id;

    // A second message pushes the first one out: it is sent at once, and its
    // window — with its notice — is over.
    await vi.advanceTimersByTimeAsync(1000);
    await submitSend(request("Second"));
    expect(sentSubjects()).toEqual(["First"]);
    expect(notices()).toHaveLength(1);
    expect(notices()[0].id).not.toBe(first);

    // The first delivery ends while the second message still waits. That
    // notice is not the first one's to take down ...
    transport.calls[0].resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(notices()).toHaveLength(1);

    // ... and its "Undo" still stops the message it stands for.
    notices()[0].action!.run();
    expect(said("info")).toContain(i18n.t("mail.sendCancelled"));
    expect(notices()).toEqual([]);
    await vi.advanceTimersByTimeAsync(UNDO_SEND_MS * 2);
    expect(sentSubjects()).toEqual(["First"]);
  });
});

/**
 * The composer is closed by the time the mail server answers. A message it
 * refuses comes back (plan "Weiterleiten nimmt die Anhänge mit", part D): as a
 * compose window of the vault it was written in, with everything it was sent
 * with. The queue holds it until that window has collected it — the notice is
 * the way back for exactly that long.
 */
describe("a message the mail server refused", () => {
  const file = { name: "Angebot.pdf", mime: "application/pdf", contentBase64: "JVBERi0=" };

  async function refuse(req: MailSendRequest, reason: string) {
    await submitSend(req);
    await vi.advanceTimersByTimeAsync(UNDO_SEND_MS);
    transport.calls[transport.calls.length - 1].reject(new Error(reason));
    await vi.advanceTimersByTimeAsync(0);
  }

  it("comes back in a compose window of its vault, as it was sent", async () => {
    await refuse(
      {
        ...request("Angebot"),
        vaultPath: "/other-vault",
        cc: "carla@example.org",
        fromAddress: "alias@example.org",
        attachments: [file],
        calendar: { ics: "BEGIN:VCALENDAR", method: "REQUEST" },
      },
      "smtp error (552): 5.3.4 Message size exceeds fixed maximum message size",
    );
    // The reason is said in words where there are words for it.
    expect(owed()[0].message).toBe(i18n.t("mail.sendFailed", { reason: i18n.t("mail.sendTooLarge") }));

    owed()[0].action!.run();
    await vi.advanceTimersByTimeAsync(0);
    expect(windows.opened).toHaveLength(1);
    const { vaultPath, title, snapshot } = windows.opened[0];
    // The vault it was written in — the central window may show another one.
    expect(vaultPath).toBe("/other-vault");
    expect(title).toBe("Angebot");
    expect(snapshot).toMatchObject({
      accountId: "a1",
      fromAddress: "alias@example.org",
      to: "you@example.org",
      cc: "carla@example.org",
      bcc: "",
      showCc: true,
      subject: "Angebot",
      body: "text",
    });
    // The files that went along — and the invitation as the invitation it was,
    // so sending again sends it as one.
    expect(snapshot.attachments).toEqual([file, { name: "invite.ics", mime: "text/calendar; method=REQUEST", contentBase64: btoa("BEGIN:VCALENDAR") }]);
    // Unsent is unsaved: the window measures against an empty composer and
    // asks before it closes.
    expect(snapshot.opened).toEqual({ to: "", cc: "", bcc: "", subject: "", body: "", attachments: [] });

    // Asking for the window does not let go of the message ...
    expect(owed()).toHaveLength(1);
    // ... the window collecting its draft does.
    releaseRefusedSend(snapshot.refused as number);
    expect(owed()).toEqual([]);
  });

  it("opens one window: asking again while that window has not collected its draft does nothing", async () => {
    await refuse(request("Once"), "550 mailbox unavailable");

    owed()[0].action!.run();
    await vi.advanceTimersByTimeAsync(0);
    expect(windows.opened).toHaveLength(1);
    // The window exists, the notice still stands — a new window takes its time
    // to start and fetch megabytes. A second click now, or ten seconds on,
    // would put the same message into a second window, and a message in two
    // windows can be sent twice.
    owed()[0].action!.run();
    await vi.advanceTimersByTimeAsync(10_000);
    owed()[0].action!.run();
    await vi.advanceTimersByTimeAsync(0);
    expect(windows.opened).toHaveLength(1);

    // A window that has not collected it after all that time never will (its
    // own fetch gave up at fifteen seconds): the notice answers again.
    await vi.advanceTimersByTimeAsync(10_000);
    owed()[0].action!.run();
    await vi.advanceTimersByTimeAsync(0);
    expect(windows.opened).toHaveLength(2);
    expect(owed()).toHaveLength(1);
  });

  it("stays held when the window does not come up, and says so", async () => {
    await refuse(request("Kept"), "550 mailbox unavailable");
    windows.fail = new Error("the window could not be created");

    owed()[0].action!.run();
    await vi.advanceTimersByTimeAsync(0);
    expect(said("error")).toEqual(["the window could not be created"]);
    expect(owed()).toHaveLength(1);

    // The next try gets through.
    windows.fail = null;
    owed()[0].action!.run();
    await vi.advanceTimersByTimeAsync(0);
    expect(windows.opened.map((w) => w.title)).toEqual(["Kept"]);
  });

  it("is held again when it is refused a second time", async () => {
    await refuse(request("Twice"), "550 mailbox unavailable");
    const first = owed()[0].id;
    owed()[0].action!.run();
    await vi.advanceTimersByTimeAsync(0);
    releaseRefusedSend(windows.opened[0].snapshot.refused as number);
    expect(owed()).toEqual([]);

    // The reopened window sends the same message; the server refuses again.
    await refuse(request("Twice"), "550 mailbox unavailable");
    expect(owed()).toHaveLength(1);
    expect(owed()[0].id).not.toBe(first);
  });

  it("takes the window's title from the app when the message has no subject", async () => {
    await refuse(request("  "), "550 mailbox unavailable");
    owed()[0].action!.run();
    await vi.advanceTimersByTimeAsync(0);
    expect(windows.opened[0].title).toBe(i18n.t("mail.composeTitle"));
  });
});
