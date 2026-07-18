import { describe, expect, it } from "vitest";
import { MAIL_PRESETS, presetById, presetForEmail } from "./mailPresets";

describe("mail provider presets (E2)", () => {
  it("carries IMAP + SMTP host/port for each preset", () => {
    for (const p of MAIL_PRESETS) {
      expect(p.host).toMatch(/\./);
      expect(p.smtpHost).toMatch(/\./);
      expect(p.port).toBeGreaterThan(0);
      expect(p.smtpPort).toBeGreaterThan(0);
      expect(p.domains.length).toBeGreaterThan(0);
    }
  });

  it("resolves a preset by id", () => {
    expect(presetById("gmail")?.smtpHost).toBe("smtp.gmail.com");
    expect(presetById("nope")).toBeNull();
  });

  it("guesses the provider from an email domain (case-insensitive, subdomains)", () => {
    expect(presetForEmail("me@gmail.com")?.id).toBe("gmail");
    expect(presetForEmail("ME@GoogleMail.com")?.id).toBe("gmail");
    expect(presetForEmail("a@outlook.com")?.id).toBe("outlook");
    expect(presetForEmail("a@hotmail.com")?.id).toBe("outlook");
    expect(presetForEmail("a@corp.fastmail.com")?.id).toBe("fastmail");
    expect(presetForEmail("a@example.org")).toBeNull();
    expect(presetForEmail("not-an-email")).toBeNull();
    expect(presetForEmail("a@")).toBeNull();
  });
});
