// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { readFrontmatterPath } from "@plainva/core";
import { buildEmailNoteContent, captureMailAsNote, isEmptyMailNote, mailDayKey, mailNoteStem, saveEmlFile, type MailCaptureAdapter } from "@plainva/ui/mail";
import type { MailMessage } from "@plainva/ui/mail";

function fakeAdapter(initial: Record<string, string> = {}) {
  const files = new Map<string, string | Uint8Array>(Object.entries(initial));
  const adapter: MailCaptureAdapter = {
    readTextFile: async (p) => {
      const c = files.get(p);
      if (typeof c !== "string") throw new Error("not found: " + p);
      return c;
    },
    writeTextFile: async (p, c) => {
      files.set(p, c);
    },
    writeBinaryFile: async (p, data) => {
      files.set(p, data);
    },
    exists: async (p) => files.has(p),
    createDir: async () => {},
  };
  return { adapter, files };
}

function msg(partial: Partial<MailMessage> = {}): MailMessage {
  return {
    id: "4711",
    subject: "Rechnung Q3",
    from: "Anna Beispiel <anna@example.org>",
    to: "marco@example.org",
    dateTs: new Date(2026, 6, 20, 9, 30).getTime(),
    text: "Hallo,\n\nanbei die Rechnung.\n",
    html: null,
    attachments: [],
    ...partial,
  };
}

describe("mail capture", () => {
  it("builds an anchored Email note with sender, date and the text body", () => {
    const content = buildEmailNoteContent(msg(), "acc1", "INBOX", "2026-07-20");
    expect(readFrontmatterPath(content, ["type"])).toBe("Email");
    expect(readFrontmatterPath(content, ["from"])).toBe("Anna Beispiel <anna@example.org>");
    expect(readFrontmatterPath(content, ["date"])).toBe("2026-07-20");
    expect(readFrontmatterPath(content, ["plainva", "pim", "kind"])).toBe("email");
    expect(String(readFrontmatterPath(content, ["plainva", "pim", "uid"]))).toBe("4711");
    expect(content).toContain("# Rechnung Q3");
    expect(content).toContain("anbei die Rechnung.");
  });

  it("creates the note in the mail folder and is idempotent per message", async () => {
    const { adapter, files } = fakeAdapter();
    const first = await captureMailAsNote({ adapter, message: msg(), accountId: "acc1", mailbox: "INBOX", folder: "Mail" });
    expect(first).toEqual({ path: "Mail/2026-07-20 Rechnung Q3.md", created: true, filled: false });
    const again = await captureMailAsNote({ adapter, message: msg(), accountId: "acc1", mailbox: "INBOX", folder: "Mail" });
    expect(again).toEqual({ path: first.path, created: false, filled: false });
    expect([...files.keys()].filter((p) => p.endsWith(".md"))).toHaveLength(1);
  });

  it("never reuses a same-named foreign note", async () => {
    const { adapter } = fakeAdapter({ "Mail/2026-07-20 Rechnung Q3.md": "# Eigene Notiz ohne Anker\n" });
    const res = await captureMailAsNote({ adapter, message: msg(), accountId: "acc1", mailbox: "INBOX", folder: "Mail" });
    expect(res).toEqual({ path: "Mail/2026-07-20 Rechnung Q3 2.md", created: true, filled: false });
  });

  it("deduplicates a stable RFC Message-ID across Gmail labels", async () => {
    const { adapter } = fakeAdapter();
    const message = msg({ providerMessageId: "<stable@gmail.test>", uidValidity: 99 });
    const first = await captureMailAsNote({ adapter, message, accountId: "gmail", mailbox: "INBOX", folder: "Mail" });
    const second = await captureMailAsNote({ adapter, message: { ...message, id: "9002", uidValidity: 100 }, accountId: "gmail", mailbox: "[Gmail]/All Mail", folder: "Mail" });
    expect(second).toEqual({ path: first.path, created: false, filled: false });
  });

  it("does not deduplicate a reused IMAP UID after UIDVALIDITY changes", async () => {
    const { adapter } = fakeAdapter();
    const first = await captureMailAsNote({ adapter, message: msg({ uidValidity: 10 }), accountId: "acc1", mailbox: "INBOX", folder: "Mail" });
    const second = await captureMailAsNote({ adapter, message: msg({ uidValidity: 11 }), accountId: "acc1", mailbox: "INBOX", folder: "Mail" });
    expect(first.created).toBe(true);
    expect(second.created).toBe(true);
    expect(second.path).not.toBe(first.path);
  });

  it("saves the raw message as a collision-free .eml", async () => {
    const { adapter, files } = fakeAdapter();
    const raw = btoa("From: a@example.org\r\n\r\nBody");
    const path = await saveEmlFile(adapter, msg(), raw, "Mail");
    expect(path).toBe("Mail/2026-07-20 Rechnung Q3.eml");
    expect(files.get(path)).toBeInstanceOf(Uint8Array);
    const second = await saveEmlFile(adapter, msg(), raw, "Mail");
    expect(second).toBe("Mail/2026-07-20 Rechnung Q3 2.eml");
  });

  it("stamps generated + a mid: source when the capture names its producer (OKF 0.2)", () => {
    const content = buildEmailNoteContent(
      msg({ providerMessageId: "<stable@gmail.test>" }),
      "acc1",
      "INBOX",
      "2026-07-20",
      { generatedBy: "plainva-mail-capture/0.6.7" },
    );
    expect(readFrontmatterPath(content, ["generated", "by"])).toBe("plainva-mail-capture/0.6.7");
    expect(String(readFrontmatterPath(content, ["generated", "at"]))).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(readFrontmatterPath(content, ["sources"])).toEqual([{ resource: "mid:stable@gmail.test", title: "Rechnung Q3" }]);
    // The pim anchor is untouched by the stamp.
    expect(readFrontmatterPath(content, ["plainva", "pim", "kind"])).toBe("email");
  });

  it("a message without a stable Message-ID is stamped generated but gets no source", () => {
    const content = buildEmailNoteContent(msg(), "acc1", "INBOX", "2026-07-20", { generatedBy: "plainva-mail-capture/0.6.7" });
    expect(readFrontmatterPath(content, ["generated", "by"])).toBe("plainva-mail-capture/0.6.7");
    expect(readFrontmatterPath(content, ["sources"]) ?? null).toBeNull();
  });

  it("stamps nothing without a producer, and the capture passes the producer through", async () => {
    const plain = buildEmailNoteContent(msg({ providerMessageId: "<stable@gmail.test>" }), "acc1", "INBOX", "2026-07-20");
    expect(readFrontmatterPath(plain, ["generated"]) ?? null).toBeNull();
    expect(readFrontmatterPath(plain, ["sources"]) ?? null).toBeNull();

    const { adapter, files } = fakeAdapter();
    const res = await captureMailAsNote({
      adapter,
      message: msg({ providerMessageId: "<stable@gmail.test>" }),
      accountId: "acc1",
      mailbox: "INBOX",
      folder: "Mail",
      generatedBy: "plainva-mail-capture/0.6.7",
    });
    const written = files.get(res.path);
    expect(typeof written).toBe("string");
    expect(readFrontmatterPath(written as string, ["generated", "by"])).toBe("plainva-mail-capture/0.6.7");
    expect(readFrontmatterPath(written as string, ["sources"])).toEqual([{ resource: "mid:stable@gmail.test", title: "Rechnung Q3" }]);
  });

  it("stems/day keys degrade gracefully", () => {
    expect(mailNoteStem("2026-07-20", "???")).toBe("2026-07-20");
    expect(mailDayKey({ dateTs: 0 })).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

/**
 * A second "File as note" fills a note that holds no text of its message
 * (finding 2026-10-09, decision b). Such notes were written while the text of
 * a message without a plain-text part was empty: every message of a Microsoft
 * mailbox, on the phone every HTML-only message over IMAP. Only the explicit
 * action asks for it (`fillEmpty`); a rule's capture never writes to a note
 * that is there.
 */
describe("a second capture fills a note that holds no text of its message", () => {
  const PATH = "Mail/2026-07-20 Rechnung Q3.md";
  /** The note as a capture wrote it while the message had no text. */
  const emptyNote = (message = msg()) => buildEmailNoteContent({ ...message, text: null, html: null }, "acc1", "INBOX", "2026-07-20");
  const capture = (adapter: MailCaptureAdapter, fillEmpty = true, message = msg()) =>
    captureMailAsNote({ adapter, message, accountId: "acc1", mailbox: "INBOX", folder: "Mail", fillEmpty });

  it("puts the text where a fresh capture puts it, and says so", async () => {
    const { adapter, files } = fakeAdapter({ [PATH]: emptyNote() });
    expect(await capture(adapter)).toEqual({ path: PATH, created: false, filled: true });
    // Byte for byte the note a capture writes today.
    expect(files.get(PATH)).toBe(buildEmailNoteContent(msg(), "acc1", "INBOX", "2026-07-20"));
    // Once it holds the text, a third capture only opens it.
    expect(await capture(adapter)).toEqual({ path: PATH, created: false, filled: false });
    expect(files.get(PATH)).toBe(buildEmailNoteContent(msg(), "acc1", "INBOX", "2026-07-20"));
  });

  it("counts a note with nothing but the link to the raw copy as empty, and keeps the link behind the text", async () => {
    const withLink = `${emptyNote()}\n[[Mail/2026-07-20 Rechnung Q3.eml]]\n`;
    expect(isEmptyMailNote(withLink)).toBe(true);
    const { adapter, files } = fakeAdapter({ [PATH]: withLink });
    expect((await capture(adapter)).filled).toBe(true);
    const filled = files.get(PATH) as string;
    expect(filled).toBe(`${buildEmailNoteContent(msg(), "acc1", "INBOX", "2026-07-20")}\n[[Mail/2026-07-20 Rechnung Q3.eml]]\n`);
    expect(filled.indexOf("anbei die Rechnung.")).toBeLessThan(filled.indexOf("[[Mail/"));
  });

  it("leaves a note with anything else under its title as it is, and only opens it", async () => {
    const notes = [
      `${emptyNote()}\nMeine Notiz dazu.\n`,
      `${emptyNote()}\n## Aufgaben\n`,
      `${emptyNote()}\n- [ ] Rechnung bezahlen\n`,
      `${emptyNote()}\n[[Mail/2026-07-20 Rechnung Q3.eml]] und noch ein Wort\n`,
      `${emptyNote()}\n[[Rechnungen]]\n`,
    ];
    for (const note of notes) {
      expect([note, isEmptyMailNote(note)]).toEqual([note, false]);
      const { adapter, files } = fakeAdapter({ [PATH]: note });
      expect(await capture(adapter)).toEqual({ path: PATH, created: false, filled: false });
      expect(files.get(PATH)).toBe(note);
    }
  });

  it("is what the explicit action asks for alone: a rule's capture opens the empty note and writes nothing", async () => {
    const { adapter, files } = fakeAdapter({ [PATH]: emptyNote() });
    let writes = 0;
    const counting: MailCaptureAdapter = { ...adapter, writeTextFile: async (path, content) => { writes++; await adapter.writeTextFile(path, content); } };
    expect(await capture(counting, false)).toEqual({ path: PATH, created: false, filled: false });
    expect(writes).toBe(0);
    expect(files.get(PATH)).toBe(emptyNote());
  });

  it("files a new note beside a same-named note without the anchor, as before", async () => {
    const foreign = "# Rechnung Q3\n";
    const { adapter, files } = fakeAdapter({ [PATH]: foreign });
    expect(await capture(adapter)).toEqual({ path: "Mail/2026-07-20 Rechnung Q3 2.md", created: true, filled: false });
    expect(files.get(PATH)).toBe(foreign);
  });

  it("writes nothing for a message that has no text either", async () => {
    const { adapter, files } = fakeAdapter({ [PATH]: emptyNote() });
    expect((await capture(adapter, true, msg({ text: null, html: null }))).filled).toBe(false);
    expect((await capture(adapter, true, msg({ text: "  \n", html: null }))).filled).toBe(false);
    expect(files.get(PATH)).toBe(emptyNote());
  });

  it("fills the note of a message that is HTML only with the text the reader shows", async () => {
    const html = msg({ text: null, html: "<p>Hallo,</p><p>anbei die <b>Rechnung</b>.</p>" });
    const { adapter, files } = fakeAdapter({ [PATH]: emptyNote(html) });
    expect((await capture(adapter, true, html)).filled).toBe(true);
    expect(files.get(PATH)).toContain("anbei die Rechnung.");
  });

  it("keeps the line ends and the byte order mark of the note", async () => {
    const mark = String.fromCharCode(0xfeff);
    const crlf = mark + emptyNote().replace(/\n/g, "\r\n");
    const { adapter, files } = fakeAdapter({ [PATH]: crlf });
    expect((await capture(adapter)).filled).toBe(true);
    const filled = files.get(PATH) as string;
    expect(filled.charCodeAt(0)).toBe(0xfeff);
    expect(filled.replace(/\r\n/g, "").includes("\n")).toBe(false);
    expect(filled.slice(1).replace(/\r\n/g, "\n")).toBe(buildEmailNoteContent(msg(), "acc1", "INBOX", "2026-07-20"));
  });

  it("asks the note again when it writes: a line typed into it meanwhile is never written over", async () => {
    const { adapter, files } = fakeAdapter({ [PATH]: emptyNote() });
    const typed = `${emptyNote()}\nGerade getippt.\n`;
    // The read that finds the note sees it empty; the user types before the write reads it again.
    let reads = 0;
    const racing: MailCaptureAdapter = {
      ...adapter,
      readTextFile: async (path) => {
        if (++reads === 2) files.set(PATH, typed);
        return adapter.readTextFile(path);
      },
    };
    expect((await capture(racing)).filled).toBe(false);
    expect(files.get(PATH)).toBe(typed);
  });

  it("reads what counts as the note's text from below its properties", () => {
    expect(isEmptyMailNote(emptyNote())).toBe(true);
    expect(isEmptyMailNote("# Rechnung Q3\n\n\n")).toBe(true);
    expect(isEmptyMailNote("")).toBe(true);
    // A second title is text of the user's.
    expect(isEmptyMailNote("# Rechnung Q3\n# Noch eine\n")).toBe(false);
    // A line before the title is text too.
    expect(isEmptyMailNote("Vorweg.\n# Rechnung Q3\n")).toBe(false);
  });
});
