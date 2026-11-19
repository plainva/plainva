import { beforeEach, describe, expect, it } from "vitest";
import { setPlatformServices } from "@plainva/ui";
import {
  decodeWords,
  fetchMessage,
  listEnvelopes,
  setMailPlatform,
  type MailAccountConfig,
  type MailTransport,
  type RawImapEnvelopePage,
  type RawImapMessage,
} from "@plainva/ui/mail";

/**
 * The subject and the names of an IMAP message on the desktop, read as the
 * phone reads them (Fehlerliste 0.9.0 C7; catalog entry `mail-base64-reading`,
 * gone).
 *
 * mail-parser leaves an encoded word it cannot read as it was written — one
 * whose base64 holds a character that is no base64, a hyphen too —, so the
 * desktop showed `=?utf-8?B?…?=` where the phone, passing the character over
 * as RFC 2045 says, showed the word. The Rust client hands the SUBJECT, FROM
 * and TO lines on as sent (`shown_head_lines` in mail_imap.rs); this side
 * reads them with the phone's own reader.
 */

const account: MailAccountConfig = { id: "mail", label: "Mail", user: "person@example.test", host: "imap.example.test", port: 993 };
const b64 = (text: string) => Buffer.from(text, "latin1").toString("base64");
/** "Grüße" with a hyphen inside its base64, and "Anna" — as the server sent them. */
const WORD = "=?utf-8?B?R3LD-vMOfZQ==?=";
/** "Anna" and "Ben", with a hyphen inside their base64 too. */
const ANNA = "=?utf-8?B?QW5u-YQ==?=";
const BEN = "=?utf-8?B?Q-mVu?=";
const LINES = `From: ${ANNA} <a@example.test>\r\nTo: ${BEN} <b@example.test>,\r\n c@example.test\r\nSubject: ${WORD}\r\n`;

beforeEach(() => {
  setPlatformServices({
    loadSettings: async () => ({ get: async () => undefined, set: async () => {}, delete: async () => true, keys: async () => [], save: async () => {} }),
    credentials: { readSecret: async <T,>() => ({ pass: "secret" }) as T, writeSecret: async () => {}, removeSecret: async () => {} },
    openExternal: async () => {},
  });
});

describe("the head of an IMAP message on the desktop", () => {
  it("is the phone's reading of the words the desktop's parser leaves written", () => {
    expect(decodeWords(WORD)).toBe("Grüße");
    expect(decodeWords(ANNA)).toBe("Anna");
    expect(decodeWords(BEN)).toBe("Ben");
  });

  it("reads the subject and the sender of a listed message from the lines as sent", async () => {
    const page: RawImapEnvelopePage = {
      total: 2,
      unseen: 0,
      messages: [
        // What the Rust client sends: its own reading, and the lines.
        { uid: 2, subject: WORD, from: `${ANNA} <a@example.test>`, dateTs: 2, seen: true, flagged: false, headLines: b64(LINES) },
        // A transport that reads the head itself (the phone's) sends no lines.
        { uid: 1, subject: "Phone", from: "b@example.test", dateTs: 1, seen: true, flagged: false },
      ],
    };
    setMailPlatform({ transport: { listEnvelopes: async () => page } as unknown as MailTransport, http: { api: fetch, token: fetch } });
    const listed = await listEnvelopes("vault", account, "INBOX", 0, 50);
    expect(listed.messages[0].subject).toBe("Grüße");
    expect(listed.messages[0].from).toBe("Anna <a@example.test>");
    expect(listed.messages[0]).not.toHaveProperty("headLines");
    expect(listed.messages[1]).toMatchObject({ subject: "Phone", from: "b@example.test" });
  });

  it("reads the subject and the names of an opened message from the lines as sent", async () => {
    const raw: RawImapMessage = { uid: 2, subject: WORD, from: `${ANNA} <a@example.test>`, to: `${BEN} <b@example.test>, c@example.test`, dateTs: 2, text: "Hallo", html: null, attachments: [], headLines: b64(LINES) };
    setMailPlatform({ transport: { fetchMessage: async () => raw } as unknown as MailTransport, http: { api: fetch, token: fetch } });
    const message = await fetchMessage("vault", account, "INBOX", "2");
    expect(message.subject).toBe("Grüße");
    expect(message.from).toBe("Anna <a@example.test>");
    expect(message.to).toBe("Ben <b@example.test>, c@example.test");
    expect(message).not.toHaveProperty("headLines");
  });

  it("keeps the desktop's own form of a name list it could read", async () => {
    const lines = b64(`From: "Beispiel, Anna" <a@example.test>\r\nSubject: Hallo\r\n`);
    const raw: RawImapMessage = { uid: 3, subject: "Hallo", from: "Beispiel, Anna <a@example.test>", to: "me@example.test", dateTs: 2, text: "Hallo", html: null, attachments: [], headLines: lines };
    setMailPlatform({ transport: { fetchMessage: async () => raw } as unknown as MailTransport, http: { api: fetch, token: fetch } });
    const message = await fetchMessage("vault", account, "INBOX", "3");
    expect(message).toMatchObject({ subject: "Hallo", from: "Beispiel, Anna <a@example.test>", to: "me@example.test" });
  });

  it("keeps the transport's own reading where the lines do not read or name no such field", async () => {
    const page: RawImapEnvelopePage = {
      total: 2,
      unseen: 0,
      messages: [
        { uid: 2, subject: "Own", from: "a@example.test", dateTs: 2, seen: true, flagged: false, headLines: "%%%" },
        { uid: 1, subject: "Own too", from: "b@example.test", dateTs: 1, seen: true, flagged: false, headLines: b64("Date: Mon, 20 Jul 2026 10:00:00 +0200\r\n") },
      ],
    };
    setMailPlatform({ transport: { listEnvelopes: async () => page } as unknown as MailTransport, http: { api: fetch, token: fetch } });
    const listed = await listEnvelopes("vault", account, "INBOX", 0, 50);
    expect(listed.messages.map((m) => [m.subject, m.from])).toEqual([["Own", "a@example.test"], ["Own too", "b@example.test"]]);
  });
});
