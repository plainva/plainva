// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Where a message goes when someone hits send (multi-window P3, plan §12.4).
 *
 * The delayed send is a TIMER, and a timer only survives if the window holding
 * it survives. A compose window is the one most likely in the whole app to be
 * closed while that timer runs — so the queue belongs to the central window,
 * and every other window hands the message over instead of starting a timer of
 * its own. What is asserted here is exactly that split, in both directions.
 */

const sent: Array<{ to: string; subject: string; from?: string }> = [];
const drafted: Array<{ mailbox: string; subject: string }> = [];
const requests: Array<{ kind: string; args: unknown }> = [];
let role: "owner" | "aux" | "compose" = "owner";
/** The undo toast's one action, as the queue handed it over. */
let undo: (() => void) | null = null;
/** The server refuses the message. */
let refuse = false;

vi.mock("../windowContext", () => ({
  isOwnerWindow: () => role === "owner",
}));

vi.mock("../windowBus", () => ({
  getWindowBus: async () => ({
    request: async (kind: string, args: unknown) => {
      requests.push({ kind, args });
    },
  }),
}));

vi.mock("@plainva/ui", () => ({
  toast: {
    progress: (_text: string, action?: { run: () => void }) => {
      undo = action?.run ?? null;
      return 1;
    },
    dismiss: () => {},
    info: () => {},
    error: () => {},
  },
}));

vi.mock("@plainva/ui/mail", async () => {
  const actual = await vi.importActual<typeof import("@plainva/ui/mail")>("@plainva/ui/mail");
  return {
    ...actual,
    listMailAccounts: async () => [{ id: "a1", label: "Work", user: "me@example.org", smtpHost: "smtp.example.org" }],
    sendMail: async (
      _vault: string,
      _account: unknown,
      to: string,
      subject: string,
      _body: string,
      _files: unknown,
      _cal: unknown,
      _cc: string,
      _bcc: string,
      from?: string,
    ) => {
      if (refuse) throw new Error("550 mailbox unavailable");
      sent.push({ to, subject, from });
    },
    appendDraft: async (
      _vault: string,
      _account: unknown,
      mailbox: string,
      _to: string,
      subject: string,
    ) => {
      drafted.push({ mailbox, subject });
    },
  };
});

import { submitSend, submitDraft } from "./sendQueue";

const REQ = {
  vaultPath: "/vault",
  accountId: "a1",
  to: "you@example.org",
  subject: "Hello",
  body: "text",
  attachments: [],
};

beforeEach(() => {
  sent.length = 0;
  drafted.length = 0;
  requests.length = 0;
  role = "owner";
  undo = null;
  refuse = false;
  vi.useFakeTimers();
});

describe("where the delayed send lives", () => {
  it("queues in the central window and delivers when the undo window is over", async () => {
    await submitSend({ ...REQ, fromAddress: "me@example.org" });

    // Not yet: the whole point of the delay is that it can still be taken back.
    expect(sent).toEqual([]);
    expect(requests, "the owner has the queue — it must not ask another window").toEqual([]);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(sent).toEqual([{ to: "you@example.org", subject: "Hello", from: "me@example.org" }]);
  });

  it("hands the message to the central window from a compose window", async () => {
    role = "compose";
    await submitSend(REQ);

    expect(requests).toEqual([{ kind: "mail-send", args: REQ }]);
    // A second timer in a window that is about to close is exactly what §12.4
    // forbids: closing a window would then decide between sending and losing.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent).toEqual([]);
  });

  it("saves a draft locally in the owner and over the bus everywhere else", async () => {
    await submitDraft({ ...REQ, mailbox: "Drafts" });
    expect(drafted).toEqual([{ mailbox: "Drafts", subject: "Hello" }]);

    role = "aux";
    await submitDraft({ ...REQ, mailbox: "Drafts" });
    expect(drafted).toHaveLength(1);
    expect(requests.map((r) => r.kind)).toEqual(["mail-draft"]);
  });

  it("says which account it cannot find rather than sending into nothing", async () => {
    await expect(submitSend({ ...REQ, accountId: "nope" })).rejects.toThrow(/nope/);
    expect(sent).toEqual([]);
  });
});

/**
 * Somebody who keeps the text until it is really out — a draft the assistant
 * wrote stays in its list until then (AI harness P5-6) — must not be told
 * "sent" for a message that is only waiting in the queue: "undo send" drops
 * it, and so does a server that refuses.
 */
describe("telling whoever keeps the text that the mail is out", () => {
  it("tells once the transport took the message — not when it was queued", async () => {
    let told = 0;
    await submitSend(REQ, () => told++);
    expect(told).toBe(0);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(sent).toHaveLength(1);
    expect(told).toBe(1);
  });

  it("tells nothing for a send that was taken back, or that the server refused", async () => {
    let told = 0;
    await submitSend(REQ, () => told++);
    expect(undo, "the queue offers the one chance to stop it").not.toBeNull();
    undo!();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(sent).toEqual([]);
    expect(told).toBe(0);

    refuse = true;
    await submitSend(REQ, () => told++);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(sent).toEqual([]);
    expect(told).toBe(0);
  });

  it("tells a window that is not the owner once the owner's queue has the message: a function does not cross windows", async () => {
    role = "compose";
    let told = 0;
    await submitSend(REQ, () => told++);
    expect(requests).toEqual([{ kind: "mail-send", args: REQ }]);
    expect(told).toBe(1);
  });
});
