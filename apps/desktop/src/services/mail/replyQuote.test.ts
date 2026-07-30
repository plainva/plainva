import { describe, it, expect } from "vitest";
import {
  buildQuoteBlock,
  buildForwardBody,
  buildReplyBody,
  quoteText,
  quotedOriginalStart,
  withSignature,
  withoutSignature,
  FORWARD_SEPARATOR,
  type MailAccountConfig,
} from "@plainva/ui/mail";

/**
 * The signature has to sit BELOW what you write and ABOVE the quoted original
 * (maintainer report 2026-07-29: a scrap of the quoted mail appeared above it).
 * The heart of these tests is the pair: whoever BUILDS a quote block and
 * whoever LOOKS for its start must agree — that is what drifted apart.
 */

const account = (signature: string): MailAccountConfig => ({
  id: "a1",
  label: "Work",
  host: "imap.example.org",
  port: 993,
  user: "me@example.org",
  signature,
});

const message = {
  from: "Anna <anna@example.org>",
  text: "Hallo,\nanbei die Rechnung.",
  dateTs: Date.UTC(2026, 6, 1, 9, 30),
  subject: "Rechnung",
};

describe("quote grammar", () => {
  it("prefixes every line of the original", () => {
    expect(quoteText("eins\nzwei")).toBe("> eins\n> zwei");
  });

  it("finds the start of a block it built itself — attribution included", () => {
    const attribution = "Am 1. Juli 2026 schrieb Anna:";
    const body = `Mein Text\n\n${buildQuoteBlock("Hallo", attribution)}`;
    const at = quotedOriginalStart(body);
    expect(at).toBeGreaterThan(-1);
    // The exact contract: the block starts AT the attribution, not at the ">".
    expect(body.slice(at)).toBe(`${attribution}\n> Hallo`);
  });

  it("agrees with buildReplyBody about where the quote begins", () => {
    const attribution = "Am 1. Juli 2026 schrieb Anna:";
    const body = buildReplyBody(message, attribution);
    expect(body.slice(quotedOriginalStart(body)).startsWith(attribution)).toBe(true);
  });

  it("recognises a forwarded message, which carries no quote marker at all", () => {
    const body = buildForwardBody(message);
    const at = quotedOriginalStart(body);
    expect(at).toBeGreaterThan(-1);
    expect(body.slice(at).startsWith(FORWARD_SEPARATOR)).toBe(true);
  });

  it("takes the first block when a body carries both", () => {
    const body = `Text\n\n${FORWARD_SEPARATOR}\nFrom: x\n\nAm 1. Juli schrieb Anna:\n> zitiert`;
    expect(body.slice(quotedOriginalStart(body)).startsWith(FORWARD_SEPARATOR)).toBe(true);
  });

  it("returns -1 for a plain body", () => {
    expect(quotedOriginalStart("nur mein Text\n\nnoch eine Zeile")).toBe(-1);
  });

  it("does not mistake a quoted line's own leading colon line for attribution", () => {
    const body = "Text\n\n> Anna schrieb:\n> zitiert";
    expect(body.slice(quotedOriginalStart(body)).startsWith("> Anna schrieb:")).toBe(true);
  });

  it("keeps a blank line between text and quote out of the block", () => {
    const body = "Mein Text\n\n> zitiert";
    expect(body.slice(quotedOriginalStart(body))).toBe("> zitiert");
  });
});

describe("withSignature and the quoted original", () => {
  it("puts the signature above the attribution line of a reply", () => {
    const attribution = "Am 1. Juli 2026 schrieb Anna:";
    const body = withSignature(buildReplyBody(message, attribution), account("Marco\nPlainva"));
    const sigAt = body.indexOf("-- \nMarco");
    const quoteAt = body.indexOf(attribution);
    expect(sigAt).toBeGreaterThan(-1);
    expect(quoteAt).toBeGreaterThan(-1);
    expect(sigAt).toBeLessThan(quoteAt); // the regression: it used to be the other way round
    // And nothing from the original stands above the signature.
    expect(body.slice(0, sigAt)).not.toContain("Anna");
    expect(body.slice(0, sigAt)).not.toContain(">");
  });

  it("pins the regression: the old rule cut at the first '>' and left the attribution above", () => {
    const attribution = "Am 1. Juli 2026 schrieb Anna:";
    const body = buildReplyBody(message, attribution);
    const oldRule = body.search(/^>/m); // what withSignature used to do
    const now = quotedOriginalStart(body);
    expect(now).toBeLessThan(oldRule);
    // And the difference is exactly the line the reader saw above the signature.
    expect(body.slice(now, oldRule).trim()).toBe(attribution);
  });

  it("puts the signature above a forwarded message", () => {
    const body = withSignature(buildForwardBody(message), account("Marco"));
    expect(body.indexOf("-- \nMarco")).toBeLessThan(body.indexOf(FORWARD_SEPARATOR));
  });

  it("appends at the end when there is nothing quoted", () => {
    const body = withSignature("Kurze Nachricht", account("Marco"));
    expect(body).toBe("Kurze Nachricht\n\n-- \nMarco\n");
  });

  it("never adds the same signature twice", () => {
    const once = withSignature("Text", account("Marco"));
    expect(withSignature(once, account("Marco"))).toBe(once);
  });

  it("swaps signatures on a sender change without touching the quote", () => {
    const attribution = "Am 1. Juli 2026 schrieb Anna:";
    const first = withSignature(buildReplyBody(message, attribution), account("Marco"));
    const swapped = withSignature(withoutSignature(first, account("Marco")), account("Zweitkonto"));
    expect(swapped).toContain("-- \nZweitkonto");
    expect(swapped).not.toContain("-- \nMarco");
    expect(swapped.indexOf("-- \nZweitkonto")).toBeLessThan(swapped.indexOf(attribution));
    expect(swapped).toContain("> Hallo,");
  });
});

describe("buildReplyBody", () => {
  it("uses the attribution the shell supplies", () => {
    const body = buildReplyBody(message, "On 1 July 2026, Anna wrote:");
    expect(body).toContain("On 1 July 2026, Anna wrote:");
  });

  it("falls back to a readable local date, never a machine timestamp", () => {
    const body = buildReplyBody(message);
    expect(body).toContain("Anna <anna@example.org>:");
    expect(body).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/); // no ISO stamp
  });

  it("leaves room to type above the quote", () => {
    expect(buildReplyBody(message, "Anna:").startsWith("\n\n")).toBe(true);
  });

  it("writes no attribution when the message has no sender", () => {
    const body = buildReplyBody({ from: "", text: "Hallo", dateTs: 0 });
    expect(body).toBe("\n\n> Hallo\n");
  });
});
