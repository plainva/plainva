import { describe, expect, it } from "vitest";
import { readFrontmatterPath } from "@plainva/core";
import { buildMailtoUrl, buildReplyNoteContent, buildReplyBody, replyAllRecipients, bytesToBase64, guessDraftsMailbox, guessTrashMailbox, noteToClipboardFlavors, buildForwardBody, mailFolderLabel, sortMailFolders, decodeImapUtf7 } from "./mailOut";

describe("mail-out helpers (stage 6)", () => {
  it("builds mailto URLs with encoded subject/body and %20 spaces", () => {
    const res = buildMailtoUrl("Grüße & Pläne", "Hallo Welt\nZeile 2");
    expect(res.truncated).toBe(false);
    expect(res.url).toMatch(/^mailto:\?subject=/);
    expect(res.url).toContain("Gr%C3%BC%C3%9Fe%20%26%20Pl%C3%A4ne");
    expect(res.url).toContain("Hallo%20Welt%0AZeile%202");
    expect(res.url).not.toContain("+");
  });

  it("truncates over-long mailto bodies and says so", () => {
    const res = buildMailtoUrl("S", "x".repeat(5000));
    expect(res.truncated).toBe(true);
    expect(res.url.length).toBeLessThan(4000);
  });

  it("guesses the drafts mailbox across naming conventions", () => {
    expect(guessDraftsMailbox(["INBOX", "Entwürfe", "Sent"])).toBe("Entwürfe");
    expect(guessDraftsMailbox(["INBOX", "[Gmail]/Drafts", "[Gmail]/Sent Mail"])).toBe("[Gmail]/Drafts");
    expect(guessDraftsMailbox(["INBOX", "Sent"])).toBe("Drafts");
    // Modified UTF-7 encoded name (what the IMAP LIST actually returns) still
    // matches the drafts role and is returned RAW for the follow-up command.
    expect(guessDraftsMailbox(["INBOX", "Entw&APw-rfe", "Gesendet"])).toBe("Entw&APw-rfe");
  });

  it("decodes IMAP modified UTF-7 mailbox names (RFC 3501)", () => {
    expect(decodeImapUtf7("Entw&APw-rfe")).toBe("Entwürfe"); // ü = U+00FC
    expect(decodeImapUtf7("INBOX")).toBe("INBOX"); // plain names pass through
    expect(decodeImapUtf7("R&AOk-sum&AOk-s")).toBe("Résumés"); // multiple runs
    expect(decodeImapUtf7("Mail &- Test")).toBe("Mail & Test"); // "&-" is a literal &
    expect(decodeImapUtf7("&AKM-")).toBe("£"); // U+00A3
    // mailFolderLabel shows the decoded last segment.
    expect(mailFolderLabel("Ordner.Entw&APw-rfe")).toBe("Entwürfe");
  });

  it("builds a reply note addressed at the sender with the original quoted", () => {
    const content = buildReplyNoteContent(
      { subject: "Re: Rechnung Q3", from: "Anna <anna@example.org>", text: "Hallo,\nanbei die Rechnung." },
      "2026-07-20"
    );
    expect(readFrontmatterPath(content, ["type"])).toBe("Email");
    expect(readFrontmatterPath(content, ["to"])).toBe("Anna <anna@example.org>");
    expect(readFrontmatterPath(content, ["date"])).toBe("2026-07-20");
    // "Re:" is not stacked twice.
    expect(content).toContain("# Re: Rechnung Q3");
    expect(content).not.toContain("Re: Re:");
    expect(content).toContain("> Hallo,");
    expect(content).toContain("> anbei die Rechnung.");
  });

  it("clipboard flavors carry formatted html plus a clean plain text", () => {
    const { html, text } = noteToClipboardFlavors("# Titel\n\nHallo **Welt**.");
    expect(html).toContain("<strong>Welt</strong>");
    expect(html).toContain("Titel");
    expect(text).toContain("Hallo Welt.");
    expect(text).not.toContain("**");
  });

  it("builds a reply body: blank area on top, attribution line, quoted original", () => {
    const body = buildReplyBody({ from: "Anna <anna@example.org>", text: "Hallo,\nanbei die Rechnung.", dateTs: Date.UTC(2026, 6, 1) });
    expect(body.startsWith("\n\n")).toBe(true); // room to type above the quote
    expect(body).toContain("Anna <anna@example.org>:");
    expect(body).toContain("> Hallo,");
    expect(body).toContain("> anbei die Rechnung.");
  });

  it("reply-all keeps sender + original To, drops self, dedupes and unwraps addresses", () => {
    const to = replyAllRecipients(
      { from: "Anna <anna@example.org>", to: "me@example.org, Bob <bob@example.org>, anna@example.org" },
      "me@example.org"
    );
    expect(to).toBe("anna@example.org, bob@example.org");
  });

  it("bytesToBase64 round-trips arbitrary bytes (incl. NUL + high bytes) through atob", () => {
    const bytes = new Uint8Array([0, 1, 200, 255, 65, 0xc3, 0xa4]);
    const back = Uint8Array.from(atob(bytesToBase64(bytes)), (c) => c.charCodeAt(0));
    expect(Array.from(back)).toEqual(Array.from(bytes));
  });

  it("builds a forwarded body with a header block and the quoted original (E1)", () => {
    const body = buildForwardBody({ subject: "Rechnung", from: "Anna <anna@example.org>", text: "Hallo,\nanbei.", dateTs: Date.UTC(2026, 6, 1) });
    expect(body).toContain("---------- Forwarded message ----------");
    expect(body).toContain("From: Anna <anna@example.org>");
    expect(body).toContain("Subject: Rechnung");
    expect(body).toContain("Hallo,\nanbei.");
    // Empty original still produces a header, no crash.
    expect(buildForwardBody({ subject: "", from: "", text: null, dateTs: 0 })).toContain("Forwarded message");
  });

  it("labels mailboxes by last hierarchy segment and drops the [Gmail] container (E1)", () => {
    expect(mailFolderLabel("INBOX")).toBe("INBOX");
    expect(mailFolderLabel("[Gmail]/Sent Mail")).toBe("Sent Mail");
    expect(mailFolderLabel("Work/Clients/ACME")).toBe("ACME");
    expect(mailFolderLabel("INBOX.Archive")).toBe("Archive");
  });

  it("finds the Trash folder for delete (localized names + Gmail), else null (E4)", () => {
    expect(guessTrashMailbox(["INBOX", "Trash", "Sent"])).toBe("Trash");
    expect(guessTrashMailbox(["INBOX", "Papierkorb"])).toBe("Papierkorb");
    expect(guessTrashMailbox(["INBOX", "[Gmail]/Trash"])).toBe("[Gmail]/Trash");
    expect(guessTrashMailbox(["INBOX", "Sent", "Drafts"])).toBeNull();
  });

  it("orders folders INBOX-first then special-use then alphabetical (E1)", () => {
    const out = sortMailFolders(["Zeta", "[Gmail]/Trash", "Drafts", "INBOX", "Sent", "Alpha"]);
    expect(out[0]).toBe("INBOX");
    // Sent + Drafts precede the plain alphabetical tail; Trash sits in the special block too.
    expect(out.indexOf("Sent")).toBeLessThan(out.indexOf("Alpha"));
    expect(out.indexOf("Drafts")).toBeLessThan(out.indexOf("Alpha"));
    expect(out.indexOf("Alpha")).toBeLessThan(out.indexOf("Zeta"));
  });
});
