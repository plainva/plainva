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
    progress: () => 1,
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
