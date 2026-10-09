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

import { submitSend } from "./sendQueue";

const request = (subject: string) => ({
  vaultPath: "/vault",
  accountId: "a1",
  to: "you@example.org",
  subject,
  body: "text",
  attachments: [],
});

/** The notices that stay until their owner takes them down — here: the one with "Undo". */
const notices = () => toastStore.get().filter((item) => item.persistent);
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

  it("is gone when the server refuses the message — the error stands alone", async () => {
    await submitSend(request("Refused"));
    await vi.advanceTimersByTimeAsync(UNDO_SEND_MS);

    transport.calls[0].reject(new Error("550 mailbox unavailable"));
    await vi.advanceTimersByTimeAsync(0);
    expect(notices()).toEqual([]);
    expect(said("error")).toEqual(["550 mailbox unavailable"]);
    expect(said("success")).toEqual([]);
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
