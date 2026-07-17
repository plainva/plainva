import { describe, expect, it } from "vitest";
import { readFrontmatterPath } from "@plainva/core";
import { buildMailtoUrl, buildReplyNoteContent, guessDraftsMailbox, noteToClipboardFlavors } from "./mailOut";

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
});
