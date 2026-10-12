import { describe, expect, it } from "vitest";
import {
  CARRIED_TOTAL_LIMIT,
  GRAPH_FILE_LIMIT,
  applyFetched,
  attachmentLimits,
  base64Size,
  buildMimeMessage,
  carriedAttachment,
  carriedFilesOf,
  carriedLimitText,
  carriedRowNote,
  carriedToSend,
  cleanAttachmentMime,
  cleanAttachmentName,
  composeChanged,
  failAll,
  formatAttachmentSize,
  forwardSource,
  graphAttachments,
  leftBehind,
  leftBehindText,
  planFiles,
  readForwardSource,
  sendableAttachment,
  type CarriedFile,
  type CarriedRow,
  type ComposeContent,
  type ForwardSource,
  type MailAccountConfig,
  type MailAttachment,
} from "@plainva/ui/mail";

/**
 * The files a forward carries — the rule both composers read (plan
 * "Weiterleiten nimmt die Anhänge mit", B1 and B3).
 *
 * Nothing here talks to a mailbox. What is held: which files a reference
 * names, what a file from somebody else's message has to look like before a
 * transport takes it, and which files go for which sending mailbox.
 */

const imap: MailAccountConfig = { id: "i1", label: "IMAP", host: "imap.example.org", port: 993, user: "me@example.org", smtpHost: "smtp.example.org" };
const microsoft: MailAccountConfig = { id: "m1", label: "Microsoft", host: "", port: 993, user: "me@example.com", kind: "microsoft", clientId: "cid" };

const MB = 1024 * 1024;
/** Base64 of `bytes` zero bytes — real content of a real size. */
const packed = (bytes: number) => btoa("\0".repeat(bytes));
const file = (index: number, size: number, extra: Partial<CarriedFile> = {}): CarriedFile => ({
  index,
  name: `f${index}.bin`,
  mime: "application/octet-stream",
  size,
  load: "idle",
  ...extra,
});
const ready = (index: number, bytes: number, listed = bytes): CarriedFile => {
  const base = file(index, listed);
  return { ...base, load: "ready", attachment: carriedAttachment(base, packed(bytes)) };
};

describe("the reference a reader hands to the composer", () => {
  it("is nothing for a message without files, and the reader's own list otherwise", () => {
    expect(forwardSource("a1", "INBOX", { id: "7", attachments: [] })).toBeUndefined();
    const source = forwardSource("a1", "INBOX", {
      id: "7",
      uidValidity: 42,
      attachments: [
        { index: 2, name: "b.pdf", mime: "application/pdf", size: 10 },
        { index: 5, name: "a.png", mime: "image/png", size: 20 },
      ],
    });
    // The reader's order, not a sorted one: one list in two places.
    expect(source).toEqual({
      accountId: "a1",
      mailbox: "INBOX",
      messageId: "7",
      uidValidity: 42,
      files: [
        { index: 2, name: "b.pdf", mime: "application/pdf", size: 10 },
        { index: 5, name: "a.png", mime: "image/png", size: 20 },
      ],
    });
    // A Microsoft message has no epoch; the field is absent, not zero.
    expect(forwardSource("a1", "Inbox", { id: "AAMk=", attachments: [{ index: 0, name: "x", mime: "y/z", size: 1 }] })).not.toHaveProperty("uidValidity");
  });

  it("survives the round trip through a nav path or a window event", () => {
    const source: Required<ForwardSource> = {
      accountId: "a1",
      mailbox: 'Projekte/"Nord"',
      messageId: "AAMkAD/+=",
      uidValidity: 9,
      files: [{ index: 0, name: "Übersicht.pdf", mime: "application/pdf", size: 1234 }],
    };
    expect(readForwardSource(JSON.parse(JSON.stringify(source)))).toEqual(source);
  });

  it("reads nothing out of what is not a reference, and only well-formed files", () => {
    for (const junk of [null, undefined, 7, "x", [], {}, { accountId: "a", mailbox: "m", messageId: "1" }, { accountId: "", mailbox: "m", messageId: "1", files: [] }]) {
      expect(readForwardSource(junk)).toBeUndefined();
    }
    const read = readForwardSource({
      accountId: "a1",
      mailbox: "INBOX",
      messageId: "7",
      uidValidity: "42",
      extra: "ignored",
      files: [
        { index: 0, name: "ok.pdf", mime: "application/pdf", size: 3, contentBase64: "AAAA" },
        { index: 0, name: "twice.pdf", mime: "application/pdf", size: 3 },
        { index: -1, name: "neg", mime: "a/b", size: 1 },
        { index: 1.5, name: "frac", mime: "a/b", size: 1 },
        { index: 2, name: 5, mime: "a/b", size: 1 },
        { index: 3, name: "nan", mime: "a/b", size: Number.NaN },
        "nope",
        null,
      ],
    });
    // One file, and nothing rides along with it: no bytes, no unknown field,
    // no epoch that is not a number.
    expect(read).toEqual({ accountId: "a1", mailbox: "INBOX", messageId: "7", files: [{ index: 0, name: "ok.pdf", mime: "application/pdf", size: 3 }] });
    // A reference whose files are all malformed names no file: it is none.
    expect(readForwardSource({ accountId: "a1", mailbox: "INBOX", messageId: "7", files: [{ index: "0" }] })).toBeUndefined();
  });

  it("names every file of the message, however many", () => {
    // A list cut at some number would be files that are neither drawn nor
    // asked about before the message leaves. A scan archive has that many.
    const attachments = Array.from({ length: 260 }, (_, index) => ({ index, name: `Seite ${index + 1}.png`, mime: "image/png", size: 1000 }));
    const source = forwardSource("a1", "INBOX", { id: "7", attachments })!;
    expect(source.files).toHaveLength(260);
    expect(readForwardSource(JSON.parse(JSON.stringify(source)))!.files).toHaveLength(260);
    expect(carriedFilesOf(source)).toHaveLength(260);
    // And the plan asks for every one that goes: 260 kB is far under any bound.
    expect(planFiles(carriedFilesOf(source), [], attachmentLimits(imap)).wanted).toHaveLength(260);
  });
});

describe("a file from somebody else's message, made fit to send", () => {
  it("keeps a type that is two tokens and replaces everything else", () => {
    expect(cleanAttachmentMime("application/pdf", "a.pdf")).toBe("application/pdf");
    expect(cleanAttachmentMime("Image/PNG", "a.png")).toBe("image/png");
    // Parameters go — `method=` with them: a calendar file out of a forwarded
    // mail is a file, not an invitation in the forwarder's name.
    expect(cleanAttachmentMime("text/calendar; method=REQUEST; charset=UTF-8", "termin.ics")).toBe("text/calendar");
    expect(cleanAttachmentMime("text/plain; charset=iso-8859-1", "x.txt")).toBe("text/plain");
    // No usable type: the name decides, as it does for a file attached by hand.
    expect(cleanAttachmentMime("", "bericht.pdf")).toBe("application/pdf");
    expect(cleanAttachmentMime("application", "foto.jpg")).toBe("image/jpeg");
    expect(cleanAttachmentMime("text/pl ain", "ohne-endung")).toBe("application/octet-stream");
    expect(cleanAttachmentMime("a/b\r\nBcc: x@example.org", "x.bin")).toBe("application/octet-stream");
  });

  it("answers with a type whatever the file is called and whatever stood in its place", () => {
    // The guess reads a table, and a table read like an object answers for
    // every name an object has: `constructor` found a function, and that went
    // on as the type — refused by the transport after the composer had closed.
    for (const name of ["constructor", "__proto__", "toString", "plan.constructor", "x.__proto__"]) {
      expect(cleanAttachmentMime("text", name), name).toBe("application/octet-stream");
      expect(carriedAttachment({ index: 0, name, mime: "" }, "AA==").mime, name).toBe("application/octet-stream");
    }
    // A file that crossed a window or a nav path may have lost its type
    // altogether. That is a type no transport takes, like any other.
    const lost = { name: "bericht.pdf", contentBase64: "AA==" } as unknown as MailAttachment;
    expect(sendableAttachment(lost).mime).toBe("application/pdf");
    expect(cleanAttachmentMime(undefined as unknown as string, undefined as unknown as string)).toBe("application/octet-stream");
    expect(cleanAttachmentName(undefined as unknown as string, undefined as unknown as string, 4)).toBe("attachment-5");
  });

  it("gives every file a name without control characters or path separators", () => {
    expect(cleanAttachmentName("Bericht 2026.pdf", "application/pdf", 0)).toBe("Bericht 2026.pdf");
    expect(cleanAttachmentName("a\r\nBcc: x@example.org.pdf", "application/pdf", 0)).toBe("a Bcc: x@example.org.pdf");
    expect(cleanAttachmentName("..\\..\\etc/passwd", "text/plain", 0)).toBe(".. .. etc passwd");
    // Unicode stays: a name is what the sender called the file.
    expect(cleanAttachmentName("Übersicht 日本語.pdf", "application/pdf", 0)).toBe("Übersicht 日本語.pdf");
    // An attached mail the desktop parser lists without a name of its own.
    expect(cleanAttachmentName("attachment", "message/rfc822", 0)).toBe("attachment.eml");
    expect(cleanAttachmentName("Weitergeleitet.eml", "message/rfc822", 0)).toBe("Weitergeleitet.eml");
  });

  it("calls a file without a name after its type, and leaves a name somebody gave alone", () => {
    // No name at all, or nothing left of one: numbered, with the extension the
    // type says, so whoever receives it can open it.
    expect(cleanAttachmentName("  \t ", "application/pdf", 2)).toBe("attachment-3.pdf");
    expect(cleanAttachmentName(String.fromCharCode(0), "image/png; name=x", 0)).toBe("attachment-1.png");
    // A picture embedded in the original: the desktop's reader lists a part
    // without a name as "attachment", and a forward carries it (E1).
    expect(cleanAttachmentName("attachment", "image/jpeg", 0)).toBe("attachment.jpg");
    expect(cleanAttachmentName("attachment", "IMAGE/PNG", 3)).toBe("attachment.png");
    // A type the table does not know, or one that is a property every object
    // has: the name stays as it is.
    expect(cleanAttachmentName("attachment", "application/x-unknown", 0)).toBe("attachment");
    expect(cleanAttachmentName("", "constructor", 0)).toBe("attachment-1");
    expect(cleanAttachmentName("attachment", "__proto__", 0)).toBe("attachment");
    // A name somebody chose has no extension because they gave it none.
    expect(cleanAttachmentName("LIESMICH", "text/plain", 0)).toBe("LIESMICH");
    expect(cleanAttachmentName("Makefile", "text/plain", 0)).toBe("Makefile");
    expect(cleanAttachmentName("attachment.dat", "image/png", 0)).toBe("attachment.dat");
  });

  it("is taken by the MIME builder — which refuses the same file as it came", () => {
    // Measured against the real builder, not against a copy of its rule: this
    // is the refusal that would otherwise arrive after the undo window.
    const hostile = { index: 0, name: "rechnung\r\nX-Injected: 1.pdf", mime: "application/pdf; name=x" };
    const asItCame: MailAttachment = { name: hostile.name, mime: hostile.mime, contentBase64: "JVBERi0=" };
    const message = { from: "me@example.org", to: "you@example.org", subject: "Fwd", text: "x" };
    expect(() => buildMimeMessage({ ...message, attachments: [asItCame] })).toThrow("Invalid attachment header");
    const cleaned = carriedAttachment(hostile, "JVBERi0=");
    const mime = buildMimeMessage({ ...message, attachments: [cleaned] });
    // The line break that would have started a header of its own is gone.
    expect(mime.split("\r\n").some((line) => line.startsWith("X-Injected"))).toBe(false);
    expect(mime).toContain("JVBERi0=");
    // The bytes are the file's own: cleaning touches the label, never the content.
    expect(cleaned.contentBase64).toBe("JVBERi0=");
  });

  it("puts every other file on a draft into the same form — the note the phone types with a charset, the invitation the desktop files as a draft", () => {
    const message = { from: "me@example.org", to: "you@example.org", subject: "x", text: "x" };
    // "Send this note as an attachment" on the phone, and "send event by mail"
    // on the desktop: both hand the composer a type with parameters, and the
    // builder an IMAP mailbox sends through refused both.
    const note: MailAttachment = { name: "Angebot.md", mime: "text/markdown; charset=utf-8", contentBase64: "IyBBbmdlYm90Cg==" };
    const invitation: MailAttachment = { name: "invite.ics", mime: "text/calendar; method=REQUEST; charset=UTF-8", contentBase64: "QkVHSU46VkNBTEVOREFS" };
    for (const asItCame of [note, invitation]) {
      expect(() => buildMimeMessage({ ...message, attachments: [asItCame] }), asItCame.name).toThrow("Invalid attachment header");
      const fit = sendableAttachment(asItCame);
      expect(buildMimeMessage({ ...message, attachments: [fit] }), asItCame.name).toContain(asItCame.contentBase64);
      expect(fit.contentBase64).toBe(asItCame.contentBase64);
      expect(fit.name).toBe(asItCame.name);
    }
    expect(sendableAttachment(note).mime).toBe("text/markdown");
    expect(sendableAttachment(invitation).mime).toBe("text/calendar");
    // A file whose type is already in that form is handed on as it is — the
    // very object, so the leave question still knows it by identity.
    const plain: MailAttachment = { name: "a.pdf", mime: "application/pdf", contentBase64: "JVBERi0=" };
    expect(sendableAttachment(plain)).toBe(plain);
  });
});

describe("which files go for which sending mailbox", () => {
  it("knows the two bounds", () => {
    expect(attachmentLimits(imap)).toEqual({ perFile: null, carriedTotal: CARRIED_TOTAL_LIMIT });
    expect(attachmentLimits(microsoft)).toEqual({ perFile: GRAPH_FILE_LIMIT, carriedTotal: CARRIED_TOTAL_LIMIT });
    // No sender yet: nothing of Microsoft's is assumed.
    expect(attachmentLimits(null).perFile).toBeNull();
    expect(CARRIED_TOTAL_LIMIT).toBe(18 * MB);
  });

  it("a file at Microsoft's bound still fits a request of its own under 4 MB", () => {
    // The bound is only worth something while a file at it can be attached:
    // one request per file, 4 MB at most (read as 4,000,000 — the smaller of
    // the two things "4 MB" can mean).
    const [attachment] = graphAttachments([{ name: "größte Datei.bin", mime: "application/octet-stream", contentBase64: packed(GRAPH_FILE_LIMIT) }]);
    expect(new TextEncoder().encode(JSON.stringify(attachment)).length).toBeLessThan(4_000_000);
    expect(base64Size(packed(GRAPH_FILE_LIMIT))).toBe(GRAPH_FILE_LIMIT);
  });

  it("over IMAP every file goes until the forward's own bound is reached, and a smaller one may still follow", () => {
    const files = [file(0, 10 * MB), file(1, 9 * MB), file(2, 5 * MB), file(3, 4 * MB)];
    const plan = planFiles(files, [], attachmentLimits(imap));
    expect(plan.rows.map((r) => [r.state, r.why])).toEqual([
      ["loading", undefined],
      ["left", "overTotal"], // 10 + 9 is more than 18
      ["loading", undefined], // 10 + 5 fits
      ["left", "overTotal"], // 15 + 4 does not
    ]);
    // Only what goes is asked for — the files that stay behind cost nothing.
    expect(plan.wanted).toEqual([0, 2]);
  });

  it("a Microsoft mailbox takes every file up to its bound, however many", () => {
    const files = [file(0, GRAPH_FILE_LIMIT), file(1, GRAPH_FILE_LIMIT + 1), file(2, 2 * MB), file(3, 2 * MB), file(4, 2 * MB)];
    const plan = planFiles(files, [], attachmentLimits(microsoft));
    expect(plan.rows.map((r) => [r.state, r.why])).toEqual([
      ["loading", undefined],
      ["left", "tooLarge"],
      ["loading", undefined],
      ["loading", undefined],
      ["loading", undefined],
    ]);
    expect(plan.wanted).toEqual([0, 2, 3, 4]);
  });

  it("switching the sender switches the answer, and what has arrived stays", () => {
    const files = [ready(0, 1 * MB), ready(1, 5 * MB)];
    expect(planFiles(files, [], attachmentLimits(imap)).rows.map((r) => r.state)).toEqual(["ready", "ready"]);
    const underMicrosoft = planFiles(files, [], attachmentLimits(microsoft));
    expect(underMicrosoft.rows.map((r) => [r.state, r.why])).toEqual([["ready", undefined], ["left", "tooLarge"]]);
    // The bytes are still held: switching back needs no second download.
    expect(underMicrosoft.rows[1].file.attachment).toBeDefined();
    expect(carriedToSend(underMicrosoft).map((a) => a.name)).toEqual(["f0.bin"]);
    // And the other way round: a file left behind under Microsoft is asked for
    // once the sender takes it.
    expect(planFiles([file(0, 5 * MB)], [], attachmentLimits(microsoft)).wanted).toEqual([]);
    expect(planFiles([file(0, 5 * MB)], [], attachmentLimits(imap)).wanted).toEqual([0]);
  });

  it("reckons with the real size once the bytes are here", () => {
    // Microsoft lists an attachment a few percent larger than the file is. Listed
    // just over the bound, it stays behind unseen; once loaded, the file decides.
    const listedOver = file(0, GRAPH_FILE_LIMIT + 1000);
    expect(planFiles([listedOver], [], attachmentLimits(microsoft)).rows[0].state).toBe("left");
    const loaded = ready(0, GRAPH_FILE_LIMIT - 1000, GRAPH_FILE_LIMIT + 1000);
    expect(planFiles([loaded], [], attachmentLimits(microsoft)).rows[0].state).toBe("ready");
  });

  it("asks only for files nobody has asked for yet, and never again on its own", () => {
    const files = [file(0, 1), file(1, 1, { load: "loading" }), ready(2, 1), file(3, 1, { load: "failed", failure: "failed" }), file(4, 1, { load: "failed", failure: "notAFile" })];
    const plan = planFiles(files, [], attachmentLimits(imap));
    expect(plan.rows.map((r) => [r.state, r.why])).toEqual([
      ["loading", undefined],
      ["loading", undefined],
      ["ready", undefined],
      ["failed", undefined],
      ["left", "notAFile"],
    ]);
    expect(plan.wanted).toEqual([0]);
  });

  it("holds a file attached by hand against the mailbox's bound only", () => {
    const big: MailAttachment = { name: "video.mp4", mime: "video/mp4", contentBase64: packed(GRAPH_FILE_LIMIT + 1) };
    const small: MailAttachment = { name: "note.md", mime: "text/markdown", contentBase64: packed(100) };
    // Over IMAP Plainva sets no bound for a file a person chose — not even the
    // forward's own, which counts the files of the original alone.
    const full = [ready(0, CARRIED_TOTAL_LIMIT)];
    expect(planFiles(full, [big, small], attachmentLimits(imap)).others).toEqual([true, true]);
    expect(planFiles(full, [big, small], attachmentLimits(imap)).rows[0].state).toBe("ready");
    expect(planFiles([], [big, small], attachmentLimits(microsoft)).others).toEqual([false, true]);
  });

  it("names everything a send would leave behind, each with its reason", () => {
    const big: MailAttachment = { name: "video.mp4", mime: "video/mp4", contentBase64: packed(GRAPH_FILE_LIMIT + 1) };
    const files = [
      ready(0, 100),
      file(1, 5 * MB),
      file(2, 100, { load: "failed", failure: "failed", detail: "connection reset" }),
      file(3, 0, { load: "failed", failure: "notAFile", name: "Besprechung" }),
      file(4, 100, { load: "loading" }),
    ];
    const plan = planFiles(files, [big], attachmentLimits(microsoft));
    expect(leftBehind(plan, [big])).toEqual([
      { name: "f1.bin", size: 5 * MB, why: "tooLarge" },
      { name: "f2.bin", size: 100, why: "failed" },
      { name: "Besprechung", size: 0, why: "notAFile" },
      { name: "video.mp4", size: GRAPH_FILE_LIMIT + 1, why: "tooLarge" },
    ]);
    // A file still on its way is not "left behind": Send waits for it instead.
    expect(leftBehind(planFiles([file(0, 1, { load: "loading" })], [], attachmentLimits(imap)), [])).toEqual([]);
  });
});

describe("a batch answer, applied", () => {
  const files = carriedFilesOf({
    accountId: "a1",
    mailbox: "INBOX",
    messageId: "7",
    files: [
      { index: 0, name: "a.pdf", mime: "application/pdf", size: 5 },
      { index: 1, name: "b\r\n.txt", mime: "text/plain; charset=utf-8", size: 3 },
      { index: 2, name: "Termin", mime: "", size: 0 },
    ],
  });

  it("starts with nothing asked for", () => {
    expect(files.map((f) => f.load)).toEqual(["idle", "idle", "idle"]);
    expect(carriedFilesOf(undefined)).toEqual([]);
  });

  it("turns bytes into the attachment that goes out and everything else into its reason", () => {
    const applied = applyFetched(files, [
      { index: 0, contentBase64: "JVBERi0=" },
      { index: 1, contentBase64: "" },
      { index: 2, failure: "notAFile" },
      { index: 9, contentBase64: "AAAA" },
    ]);
    expect(applied[0]).toEqual({ index: 0, name: "a.pdf", mime: "application/pdf", size: 5, load: "ready", attachment: { name: "a.pdf", mime: "application/pdf", contentBase64: "JVBERi0=" } });
    // An empty file is a file — and its label is made fit on the way.
    expect(applied[1].load).toBe("ready");
    expect(applied[1].attachment).toEqual({ name: "b .txt", mime: "text/plain", contentBase64: "" });
    expect(applied[2]).toEqual({ index: 2, name: "Termin", mime: "", size: 0, load: "failed", failure: "notAFile" });
    // An answer for a file that is not on the draft (taken off meanwhile) is dropped.
    expect(applied).toHaveLength(3);
  });

  it("leaves a file alone the answer does not mention", () => {
    const applied = applyFetched(files, [{ index: 1, failure: "missing" }]);
    expect(applied.map((f) => [f.load, f.failure])).toEqual([["idle", undefined], ["failed", "missing"], ["idle", undefined]]);
  });

  it("marks exactly the files that were asked for when the call itself failed", () => {
    const failed = failAll(files, [0, 2], "failed", "connection reset");
    expect(failed.map((f) => [f.load, f.failure, f.detail])).toEqual([
      ["failed", "failed", "connection reset"],
      ["idle", undefined, undefined],
      ["failed", "failed", "connection reset"],
    ]);
    // A failed file holds no bytes from an earlier try.
    const again = failAll([ready(0, 3)], [0], "changed");
    expect(again[0]).toEqual({ index: 0, name: "f0.bin", mime: "application/octet-stream", size: 3, load: "failed", failure: "changed" });
  });
});

describe("sizes", () => {
  it("counts the bytes behind a base64 string", () => {
    expect(base64Size("")).toBe(0);
    for (const n of [1, 2, 3, 4, 5, 1000, 1001, 1002]) expect(base64Size(packed(n))).toBe(n);
  });

  it("writes a size the way the mail surfaces show it", () => {
    expect(formatAttachmentSize(36)).toBe("36 B");
    expect(formatAttachmentSize(1023)).toBe("1023 B");
    expect(formatAttachmentSize(412 * 1024)).toBe("412 KB");
    expect(formatAttachmentSize(1.8 * MB, "en")).toBe("1.8 MB");
    expect(formatAttachmentSize(1.8 * MB, "de")).toBe("1,8 MB");
    // The bounds read like the sizes next to them.
    expect(formatAttachmentSize(GRAPH_FILE_LIMIT, "en")).toBe("2.8 MB");
    expect(formatAttachmentSize(CARRIED_TOTAL_LIMIT, "en")).toBe("18 MB");
    expect(formatAttachmentSize(Number.NaN)).toBe("");
  });
});

describe("what a composer says about a file, and about the bounds", () => {
  /** The key, and what was put into it — the words are the catalogs' business. */
  const t = (key: string, options?: Record<string, unknown>) => (options ? `${key}${JSON.stringify(options)}` : key);
  const row = (state: CarriedRow["state"], why?: CarriedRow["why"]): CarriedRow => ({ file: file(0, 5 * MB), state, ...(why ? { why } : {}) });

  it("gives every state its note", () => {
    expect(carriedRowNote(row("ready"), t, "en")).toBe("5 MB");
    expect(carriedRowNote(row("loading"), t, "en")).toBe("5 MB · mail.fileState.loading");
    expect(carriedRowNote(row("failed"), t, "en")).toBe("mail.fileState.failed");
    expect(carriedRowNote(row("left", "notAFile"), t, "en")).toBe("mail.fileState.notAFile");
    expect(carriedRowNote(row("left", "tooLarge"), t, "en")).toBe("5 MB · mail.fileState.tooLarge");
  });

  it("does not call a file too large that only stays behind because the forward's own bound is reached", () => {
    // Four files of 5 MB over IMAP: three go, the fourth would make it 20. It
    // is as large as the three beside it — "too large" on it reads as a fault.
    const plan = planFiles([0, 1, 2, 3].map((index) => file(index, 5 * MB)), [], attachmentLimits(imap));
    expect(plan.rows.map((r) => r.why)).toEqual([undefined, undefined, undefined, "overTotal"]);
    expect(carriedRowNote(plan.rows[3], t, "en")).toBe("5 MB · mail.fileState.overTotal");
    // The same reason the question before sending gives for it.
    const left = leftBehind(plan, []);
    expect(leftBehindText(left, t)).toBe("f3.bin (mail.fileLeft.overTotal)");
    expect(carriedLimitText(plan.rows, plan.others, attachmentLimits(imap), t, "en")).toBe('mail.fileLimitOwn{"size":"18 MB"}');
  });

  it("names every bound something was held against, and none when nothing was", () => {
    const limits = attachmentLimits(microsoft);
    expect(carriedLimitText([row("ready"), row("loading"), row("failed")], [true], limits, t, "en")).toBeNull();
    expect(carriedLimitText([row("left", "notAFile")], [], limits, t, "en")).toBeNull();
    expect(carriedLimitText([row("left", "tooLarge")], [], limits, t, "en")).toBe('mail.fileLimitMailbox{"size":"2.8 MB"}');
    // A file attached by hand that the mailbox does not take: the mailbox's bound.
    expect(carriedLimitText([row("ready")], [true, false], limits, t, "en")).toBe('mail.fileLimitMailbox{"size":"2.8 MB"}');
    // Both reasons on one draft: each file's note names its own, and each has
    // its number here.
    expect(carriedLimitText([row("left", "tooLarge"), row("left", "overTotal")], [], limits, t, "en")).toBe(
      'mail.fileLimitMailbox{"size":"2.8 MB"} mail.fileLimitOwn{"size":"18 MB"}',
    );
  });
});

describe("the leave question and the files of the original", () => {
  const opened: ComposeContent = { to: "", cc: "", bcc: "", subject: "Fwd: x", body: "text", attachments: [], carried: [0, 1, 2] };

  it("is asked with the files named, and the same names are no change", () => {
    // What the composers hand over names the files and says nothing about how
    // far each is. That a file arriving, failing or staying behind leaves an
    // untouched forward untouched is held where files really arrive:
    // composeForwardFiles.test.tsx and the phone's mailComposeForward.test.tsx.
    expect(composeChanged(opened, { ...opened, carried: [0, 1, 2] })).toBe(false);
  });

  it("counts a file taken off by hand as a change", () => {
    expect(composeChanged(opened, { ...opened, carried: [0, 2] })).toBe(true);
    expect(composeChanged(opened, { ...opened, carried: [] })).toBe(true);
  });

  it("reads a composer without a forward as it always did", () => {
    const plain: ComposeContent = { to: "", cc: "", bcc: "", subject: "", body: "", attachments: [] };
    expect(composeChanged(plain, { ...plain })).toBe(false);
    expect(composeChanged(plain, { ...plain, carried: [] })).toBe(false);
  });
});
