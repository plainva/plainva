import { describe, expect, it } from "vitest";
import { MailCredentialsMissingError, isMailCredentialsMissing, mailErrorText } from "@plainva/ui/mail";

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
