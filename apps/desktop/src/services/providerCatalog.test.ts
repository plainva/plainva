import { describe, it, expect } from "vitest";
import {
  MAIL_PRESETS,
  SUITE_PROVIDERS,
  SUITE_FAMILIES,
  FAMILY_SERVICES,
  presetById,
  presetForEmail,
  suiteProvider,
  familyOfCalDavUrl,
  familyOfWebDavUrl,
  familyOfImapHost,
} from "@plainva/ui";

/**
 * Catalog invariants (stage A+, 2026-07-20). The catalog is DATA — these
 * tests pin the properties the wizard/preset code relies on so a future
 * entry cannot silently break preset resolution or the family detection.
 */

describe("mail presets", () => {
  it("has unique ids and no domain claimed twice", () => {
    const ids = MAIL_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    const domains = MAIL_PRESETS.flatMap((p) => p.domains);
    expect(new Set(domains).size).toBe(domains.length);
  });

  it("uses TLS ports and https help links throughout", () => {
    for (const p of MAIL_PRESETS) {
      // 993 = IMAPS everywhere; 1143 = the local Proton Bridge relay.
      expect([993, 1143], p.id).toContain(p.port);
      expect([465, 587, 1025], p.id).toContain(p.smtpPort);
      expect(p.host, p.id).toBe(p.host.toLowerCase());
      expect(p.host, p.id).not.toMatch(/\s/);
      if (p.helpUrl) expect(p.helpUrl, p.id).toMatch(/^https:\/\//);
    }
  });

  it("maps gmx.com to the INTERNATIONAL hosts, not the gmx.net ones (B1)", () => {
    expect(presetForEmail("user@gmx.com")?.id).toBe("gmxcom");
    expect(presetForEmail("user@gmx.com")?.host).toBe("imap.gmx.com");
    expect(presetForEmail("user@gmx.de")?.id).toBe("gmx");
    expect(presetForEmail("user@gmx.at")?.id).toBe("gmx");
  });

  it("prefers an exact domain match over a suffix match", () => {
    // yahoo.co.jp must hit the Yahoo! JAPAN preset, never the global Yahoo one.
    expect(presetForEmail("user@yahoo.co.jp")?.id).toBe("yahoojp");
    expect(presetForEmail("user@yahoo.com")?.id).toBe("yahoo");
    expect(presetForEmail("user@mail.spoluzaci.cz")?.id).toBe("seznam");
    expect(presetForEmail("user@unknown-provider.example")).toBeNull();
    expect(presetForEmail("not-an-email")).toBeNull();
  });

  it("dead-ends the Outlook preset onto the Microsoft tile (B2)", () => {
    expect(presetById("outlook")?.useTileInstead).toBe("microsoft");
    // Exactly one dead-end preset — anything else must actually connect.
    expect(MAIL_PRESETS.filter((p) => p.useTileInstead)).toHaveLength(1);
  });

  it("flags the auth mode where the account password will NOT work (B3)", () => {
    expect(presetById("icloud")?.authMode).toBe("app-password");
    expect(presetById("yahoo")?.authMode).toBe("app-password");
    expect(presetById("qq")?.authMode).toBe("auth-code");
    expect(presetById("tonline")?.authMode).toBe("mail-password");
    expect(presetById("webde")?.authMode).toBe("password");
    expect(presetById("protonbridge")?.bridge).toBe(true);
  });
});

describe("suite providers", () => {
  it("stays consistent with the family model", () => {
    expect(SUITE_PROVIDERS.map((s) => s.family).sort()).toEqual([...SUITE_FAMILIES].sort());
    for (const s of SUITE_PROVIDERS) {
      expect([...s.services].sort(), s.family).toEqual([...FAMILY_SERVICES[s.family]].sort());
      if (s.services.includes("files")) expect(s.endpoints.webdavUrl, s.family).toMatch(/^https:\/\//);
      if (s.services.includes("calendar")) expect(s.endpoints.caldavUrl, s.family).toMatch(/^https:\/\//);
      if (s.services.includes("mail")) {
        expect(s.endpoints.imapHost, s.family).toBeTruthy();
        expect(s.endpoints.smtpHost, s.family).toBeTruthy();
        // The mail endpoints stay single-sourced with the preset list.
        const preset = presetById(s.mailPresetId ?? "");
        expect(preset, s.family).toBeTruthy();
        expect(s.endpoints.imapHost, s.family).toBe(preset!.host);
        expect(s.endpoints.smtpHost, s.family).toBe(preset!.smtpHost);
      }
      expect(s.helpUrl, s.family).toMatch(/^https:\/\//);
    }
  });

  it("resolves suite definitions by family", () => {
    expect(suiteProvider("apple")?.endpoints.caldavUrl).toBe("https://caldav.icloud.com");
    expect(suiteProvider("fastmail")?.services).toEqual(["files", "calendar", "mail"]);
    expect(suiteProvider("webdav")).toBeNull();
    expect(suiteProvider("microsoft")).toBeNull();
  });
});

describe("family detection from subsystem entries", () => {
  it("recognizes catalog CalDAV/WebDAV URLs and IMAP hosts", () => {
    expect(familyOfCalDavUrl("https://caldav.icloud.com")).toBe("apple");
    expect(familyOfCalDavUrl("https://caldav.fastmail.com/dav/calendars/user/m@x.com/")).toBe("fastmail");
    expect(familyOfCalDavUrl("https://cloud.example.org/remote.php/dav")).toBeNull();
    expect(familyOfWebDavUrl("webdav.yandex.ru")).toBe("yandex");
    expect(familyOfWebDavUrl("https://app.koofr.net/dav/Koofr")).toBe("koofr");
    expect(familyOfWebDavUrl("https://ewebdav.pcloud.com")).toBe("pcloud");
    expect(familyOfWebDavUrl("https://cloud.example.org/remote.php/dav/files/m/")).toBeNull();
    expect(familyOfImapHost("imap.mail.me.com")).toBe("apple");
    expect(familyOfImapHost("imap.mailbox.org")).toBe("mailboxorg");
    // Plain presets without a suite stay generic (no family override).
    expect(familyOfImapHost("imap.gmail.com")).toBeNull();
    expect(familyOfImapHost("imap.web.de")).toBeNull();
    expect(familyOfImapHost("")).toBeNull();
  });
});
