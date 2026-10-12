import { beforeEach, describe, expect, it, vi } from "vitest";
import { setPlatformServices } from "@plainva/ui";
import {
  MAIL_MAILBOX_CHANGED,
  fetchAttachments,
  setMailPlatform,
  type FetchedAttachment,
  type MailAccountConfig,
  type MailTransport,
} from "@plainva/ui/mail";

/**
 * `fetchAttachments` — the one call a forward makes for its files (plan
 * "Weiterleiten nimmt die Anhänge mit", A1), over an IMAP mailbox.
 *
 * Held here: one transport call for all files, one answer per file asked, and
 * what a transport without the batch gets instead. The Microsoft half is in
 * `graphAttachments.test.ts`, the phone's IMAP client in
 * `imapAttachments.test.ts`, the desktop's Rust in `mail_imap.rs`.
 */

const account: MailAccountConfig = { id: "mail", label: "Mail", user: "person@example.test", host: "imap.example.test", port: 993 };

type BatchArgs = { mailbox: string; uid: number; indexes: number[]; uidValidity?: number };
const batch = vi.fn<(creds: unknown, args: BatchArgs) => Promise<FetchedAttachment[]>>();
const single = vi.fn<(creds: unknown, args: { mailbox: string; uid: number; index: number }) => Promise<string>>();

function platform(transport: Partial<MailTransport>) {
  setMailPlatform({ transport: transport as MailTransport, http: { api: fetch, token: fetch } });
}

beforeEach(() => {
  batch.mockReset();
  single.mockReset();
  setPlatformServices({
    loadSettings: async () => ({ get: async () => undefined, set: async () => {}, delete: async () => true, keys: async () => [], save: async () => {} }),
    credentials: {
      readSecret: async <T,>() => ({ pass: "secret" }) as T,
      writeSecret: async () => {},
      removeSecret: async () => {},
    },
    openExternal: async () => {},
  });
});

describe("the files of one message, in one call", () => {
  it("asks the transport once for all of them, under the epoch the message was read in", async () => {
    batch.mockResolvedValue([
      { index: 0, contentBase64: "AAAA" },
      { index: 2, contentBase64: "BBBB" },
    ]);
    platform({ fetchAttachments: batch, fetchAttachment: single });

    const answers = await fetchAttachments("vault", account, "INBOX", "7", [0, 2], 42);

    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[0][1]).toEqual({ mailbox: "INBOX", uid: 7, indexes: [0, 2], uidValidity: 42 });
    expect(single).not.toHaveBeenCalled();
    expect(answers).toEqual([
      { index: 0, contentBase64: "AAAA" },
      { index: 2, contentBase64: "BBBB" },
    ]);
  });

  it("gives one answer per file asked, in that order — a file the message does not have is missing, not an error", async () => {
    // The transport answers in its own order and leaves out what is not there.
    batch.mockResolvedValue([
      { index: 5, contentBase64: "FFFF" },
      { index: 1, contentBase64: "" },
    ]);
    platform({ fetchAttachments: batch });

    const answers = await fetchAttachments("vault", account, "INBOX", "7", [1, 3, 5, 1]);

    // Asked twice is asked once.
    expect(batch.mock.calls[0][1].indexes).toEqual([1, 3, 5]);
    expect(answers).toEqual([
      // An empty file came: it is a file with no bytes, not a missing one.
      { index: 1, contentBase64: "" },
      { index: 3, failure: "missing" },
      { index: 5, contentBase64: "FFFF" },
    ]);
  });

  it("asks nobody for nothing", async () => {
    platform({ fetchAttachments: batch, fetchAttachment: single });
    expect(await fetchAttachments("vault", account, "INBOX", "7", [])).toEqual([]);
    expect(batch).not.toHaveBeenCalled();
  });

  it("rejects when the call could not be made at all, and says so for a renumbered mailbox", async () => {
    platform({ fetchAttachments: batch });
    batch.mockRejectedValueOnce(new Error("examine failed: connection reset"));
    await expect(fetchAttachments("vault", account, "INBOX", "7", [0])).rejects.toThrow("connection reset");
    batch.mockRejectedValueOnce(new Error(MAIL_MAILBOX_CHANGED));
    await expect(fetchAttachments("vault", account, "INBOX", "7", [0], 42)).rejects.toThrow(MAIL_MAILBOX_CHANGED);
  });

  it("asks a transport without the batch file by file, and one that fails is one that failed", async () => {
    single.mockImplementation(async (_creds, args) => {
      if (args.index === 1) throw new Error("attachment not found");
      return `file-${args.index}`;
    });
    platform({ fetchAttachment: single });

    const answers = await fetchAttachments("vault", account, "INBOX", "7", [0, 1, 2]);

    expect(single.mock.calls.map((call) => call[1])).toEqual([
      { mailbox: "INBOX", uid: 7, index: 0 },
      { mailbox: "INBOX", uid: 7, index: 1 },
      { mailbox: "INBOX", uid: 7, index: 2 },
    ]);
    expect(answers).toEqual([
      { index: 0, contentBase64: "file-0" },
      { index: 1, failure: "failed", detail: "attachment not found" },
      { index: 2, contentBase64: "file-2" },
    ]);
  });
});
