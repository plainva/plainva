import { describe, expect, it } from "vitest";
import { carriedFailureText, isMailServiceBusy, MailCredentialsMissingError, isMailCredentialsMissing, mailErrorText, mailFailureWords, type CarriedRow } from "@plainva/ui/mail";

/**
 * S15: `missing mail credentials` reached German surfaces unchanged — reported
 * twice, from two different rounds.
 *
 * The repair is a named condition plus a sentence at the display, so these pin
 * both halves: the predicate survives the trip across a bridge that keeps only
 * plain data, and everything the core cannot name keeps its own words instead
 * of being flattened into a friendly sentence that says less.
 */

const t = (key: string, opts?: Record<string, unknown>) =>
  key === "mail.credentialsMissing" ? "Kein Passwort auf diesem Gerät." : String(opts?.defaultValue ?? key);

describe("mailErrorText", () => {
  it("translates the missing-password condition", () => {
    expect(mailErrorText(new MailCredentialsMissingError(), t)).toBe("Kein Passwort auf diesem Gerät.");
  });

  it("recognises the condition after a bridge stripped the prototype", () => {
    // Tauri and Capacitor hand back plain data; `instanceof` cannot survive
    // that, which is why the class carries a `code` as well.
    expect(isMailCredentialsMissing({ code: "mail-credentials-missing" })).toBe(true);
    expect(mailErrorText({ code: "mail-credentials-missing", message: "missing mail credentials" }, t)).toBe(
      "Kein Passwort auf diesem Gerät.",
    );
  });

  it("leaves a server's own words alone", () => {
    // A timeout or a refusal has no action to offer, so it keeps what it said.
    expect(mailErrorText(new Error("AUTHENTICATE failed: invalid credentials"), t)).toBe(
      "AUTHENTICATE failed: invalid credentials",
    );
    expect(isMailCredentialsMissing(new Error("missing mail credentials"))).toBe(false);
  });

  it("keeps the core's message English for the log", () => {
    // The class is the label's source, not the sentence: diagnostics and logs
    // want one wording regardless of the app's language.
    expect(new MailCredentialsMissingError().message).toBe("missing mail credentials");
  });
});

/**
 * A transport's words as a person reads them (Sammelplan § 3.95 Nr. 6): a file
 * of a forwarded message that did not come said why in Graph's whole answer as
 * JSON ("Graph mail GET … failed: 503 {…}"), and so did every other mail failure
 * without a sentence of its own.
 */
describe("a transport's words", () => {
  const say = (key: string, opts?: Record<string, unknown>) =>
    key === "mail.serviceBusy" ? "Der Mail-Dienst antwortet gerade nicht." : key === "mail.fileFailure.failed" ? "Nicht geladen." : String(opts?.defaultValue ?? key);
  const graph = (status: number, body: string) => `Graph mail GET /me/messages/AAA/attachments/BBB failed: ${status} ${body}`;

  it("a service that is busy or down for a moment says so in our words — on both shells' transports", () => {
    for (const text of [
      graph(503, '{"error":{"code":"ServiceUnavailable","message":"Service Unavailable"}}'),
      graph(429, '{"error":{"code":"ApplicationThrottled","message":"Too many requests"}}'),
      graph(504, ""),
      "smtp error (421): 4.3.2 Service not available, closing transmission channel",
      "MAIL FROM: 4.3.2 try again later",
    ]) {
      expect(mailFailureWords(text, say), text).toBe("Der Mail-Dienst antwortet gerade nicht.");
      expect(mailErrorText(new Error(text), say), text).toBe("Der Mail-Dienst antwortet gerade nicht.");
    }
  });

  it("of any other JSON answer, its message and status — never the JSON", () => {
    expect(mailFailureWords(graph(404, '{"error":{"code":"ErrorItemNotFound","message":"The specified object was not found in the store."}}'), say)).toBe(
      "The specified object was not found in the store. (404)",
    );
    // An answer that is no JSON, or JSON without a message, stays as it is.
    expect(mailFailureWords(graph(400, "{not json"), say)).toBe(graph(400, "{not json"));
    expect(mailFailureWords(graph(400, "{}"), say)).toBe(graph(400, "{}"));
  });

  it("is what the line under a forward's files says", () => {
    const row = { state: "failed", file: { index: 1, name: "a.pdf", mime: "application/pdf", size: 1, load: "failed", failure: "failed", detail: graph(503, '{"error":{"code":"ServiceUnavailable"}}') } } as unknown as CarriedRow;
    expect(carriedFailureText([row], say)).toBe("Nicht geladen. (Der Mail-Dienst antwortet gerade nicht.)");
  });

  it("a bare number in a server's text is not a status", () => {
    expect(isMailServiceBusy("550 5.1.1 user503@example.org unknown")).toBe(false);
    expect(isMailServiceBusy("AUTHENTICATE failed: invalid credentials")).toBe(false);
  });
});
