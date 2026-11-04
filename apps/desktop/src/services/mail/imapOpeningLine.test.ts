import { beforeEach, describe, expect, it } from "vitest";
import { setPlatformServices } from "@plainva/ui";
import {
  listEnvelopes,
  openingLine,
  previewFromBodyPrefix,
  parseHeaders,
  setMailPlatform,
  type MailAccountConfig,
  type MailTransport,
  type RawImapEnvelopePage,
} from "@plainva/ui/mail";

/**
 * The opening words of a message in the list of an IMAP mailbox, on the desktop
 * too (Sammelplan § 3.78 Nr. 11; catalog entry `mail-imap-opening-line`, gone).
 *
 * The phone's client takes the first bytes of the body along in the request of
 * the list and reads the line from them; the desktop's Rust client did not ask
 * for them, so an opened conversation showed the sender's address where the
 * phone shows the words. The Rust client asks now (`envelope_fetch_items` in
 * mail_imap.rs) and hands the bytes on as they came; this side reads them with
 * the phone's own reader, so it is one line on both shells.
 */

const account: MailAccountConfig = { id: "mail", label: "Mail", user: "person@example.test", host: "imap.example.test", port: 993 };
const b64 = (text: string) => Buffer.from(text, "latin1").toString("base64");
const HEAD = "Content-Type: text/plain;\r\n charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n";
const BODY = "Gr=C3=BC=C3=9Fe aus M=C3=BCnchen.\r\nZweite Zeile";

beforeEach(() => {
  setPlatformServices({
    loadSettings: async () => ({ get: async () => undefined, set: async () => {}, delete: async () => true, keys: async () => [], save: async () => {} }),
    credentials: { readSecret: async <T,>() => ({ pass: "secret" }) as T, writeSecret: async () => {}, removeSecret: async () => {} },
    openExternal: async () => {},
  });
});

describe("the opening line of an IMAP list row", () => {
  it("is read from the bytes the desktop's client brings, as the phone reads its own", () => {
    const line = openingLine(b64(HEAD), b64(BODY));
    expect(line).toContain("Grüße aus München.");
    expect(line).toBe(previewFromBodyPrefix(Buffer.from(BODY, "latin1"), undefined, parseHeaders(HEAD)));
  });

  it("is in the envelope the desktop lists — and a transport that brings a line keeps its own", async () => {
    const page: RawImapEnvelopePage = {
      total: 2,
      unseen: 0,
      messages: [
        { uid: 2, subject: "Hallo", from: "a@example.test", dateTs: 2, seen: true, flagged: false, openingHead: b64(HEAD), openingBody: b64(BODY) },
        { uid: 1, subject: "Phone", from: "b@example.test", dateTs: 1, seen: true, flagged: false, preview: "already read" },
      ],
    };
    setMailPlatform({ transport: { listEnvelopes: async () => page } as unknown as MailTransport, http: { api: fetch, token: fetch } });
    const listed = await listEnvelopes("vault", account, "INBOX", 0, 50);
    expect(listed.messages[0].preview).toContain("Grüße aus München.");
    expect(listed.messages[1].preview).toBe("already read");
    // The bytes themselves do not travel further than the reader.
    expect(listed.messages[0]).not.toHaveProperty("openingBody");
    expect(listed.messages[0]).not.toHaveProperty("openingHead");
  });

  it("is empty for bytes that do not read, never an error", () => {
    expect(openingLine("", "")).toBe("");
    expect(openingLine("%%%", "%%%")).toBe("");
  });
});
