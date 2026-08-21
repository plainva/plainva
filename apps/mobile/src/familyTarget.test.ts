import { describe, expect, it } from "vitest";
import { calendarTargetForFamily, FAMILY_SERVICES, filesTargetForFamily, mailTargetForFamily, type CloudProviderFamily } from "@plainva/ui";

const ALL_FAMILIES = Object.keys(FAMILY_SERVICES) as CloudProviderFamily[];

describe("which form a picked family lands in (S0a)", () => {
  /**
   * The reported bug: pick Google, tap "Dateien", land on a WebDAV form.
   * `AddVaultScreen` starts on `useState<ProviderId>("webdav")`, so without the
   * family reaching it, every file connection began as WebDAV.
   */
  it("sends Google to Drive, not to WebDAV", () => {
    expect(filesTargetForFamily("google")).toEqual({ provider: "drive" });
  });

  it("sends Microsoft to OneDrive and Dropbox to Dropbox", () => {
    expect(filesTargetForFamily("microsoft")).toEqual({ provider: "onedrive" });
    expect(filesTargetForFamily("dropbox")).toEqual({ provider: "dropbox" });
  });

  it("leaves WebDAV and S3 as themselves — the family IS the provider", () => {
    expect(filesTargetForFamily("webdav")).toEqual({ provider: "webdav" });
    expect(filesTargetForFamily("s3")).toEqual({ provider: "s3" });
  });

  /**
   * The second red counter-check from the plan, and the one that decides
   * whether the fix is real rather than half done: a suite's files ride on
   * WebDAV, so the provider is right by accident — but arriving from the
   * Fastmail tile must NOT show an empty server field. The endpoint comes from
   * the shared catalog.
   */
  it("gives suite families their own WebDAV endpoint, never an empty form", () => {
    expect(filesTargetForFamily("fastmail")).toEqual({
      provider: "webdav",
      webdavUrl: "https://webdav.fastmail.com",
    });
    expect(filesTargetForFamily("koofr")?.webdavUrl).toBe("https://app.koofr.net/dav/Koofr");
    expect(filesTargetForFamily("pcloud")?.webdavUrl).toBe("https://webdav.pcloud.com");
  });

  it("refuses families that have no file service at all", () => {
    // iCloud Drive has no third-party API; IMAP is a mail protocol.
    expect(filesTargetForFamily("apple")).toBeNull();
    expect(filesTargetForFamily("imap")).toBeNull();
    expect(filesTargetForFamily("zoho")).toBeNull();
  });
});

describe("the calendar case, which fails silently (S0a)", () => {
  /**
   * The quieter half of the same bug. `PimAccountsScreen` starts on
   * `useState(…)("google")`, so arriving from the MICROSOFT tile pre-selected
   * Google — plausible-looking, and connecting the wrong provider outright.
   */
  it("never pre-selects Google for a Microsoft account", () => {
    expect(calendarTargetForFamily("microsoft")).toEqual({ provider: "microsoft" });
  });

  it("keeps Google on Google", () => {
    expect(calendarTargetForFamily("google")).toEqual({ provider: "google" });
  });

  it("routes suites to CalDAV with their endpoint prefilled", () => {
    expect(calendarTargetForFamily("apple")).toEqual({
      provider: "caldav",
      caldavUrl: "https://caldav.icloud.com",
    });
    expect(calendarTargetForFamily("fastmail")?.caldavUrl).toBe("https://caldav.fastmail.com");
  });

  it("routes plain WebDAV to CalDAV without inventing a server address", () => {
    // A self-hosted server has no preset URL — the user types it.
    expect(calendarTargetForFamily("webdav")).toEqual({ provider: "caldav" });
  });

  it("refuses families without a calendar", () => {
    expect(calendarTargetForFamily("dropbox")).toBeNull();
    expect(calendarTargetForFamily("s3")).toBeNull();
    expect(calendarTargetForFamily("imap")).toBeNull();
    expect(calendarTargetForFamily("koofr")).toBeNull();
  });
});

describe("the mail case (S0a)", () => {
  it("sends Microsoft to Graph and everyone else to IMAP", () => {
    expect(mailTargetForFamily("microsoft")).toEqual({ backend: "microsoft" });
    expect(mailTargetForFamily("apple")).toEqual({ backend: "imap", presetId: "icloud" });
  });

  /**
   * Google mail is IMAP with an app password on purpose: Gmail's OAuth scopes
   * are "restricted" and would require a CASA security assessment.
   */
  it("keeps Google on IMAP with the Gmail preset", () => {
    expect(mailTargetForFamily("google")).toEqual({ backend: "imap", presetId: "gmail" });
  });

  it("leaves the generic IMAP family without a preset — the address picks it", () => {
    expect(mailTargetForFamily("imap")).toEqual({ backend: "imap" });
  });

  it("refuses families without mail", () => {
    expect(mailTargetForFamily("webdav")).toBeNull();
    expect(mailTargetForFamily("dropbox")).toBeNull();
    expect(mailTargetForFamily("pcloud")).toBeNull();
  });
});

describe("the mapping stays in step with the shared catalog", () => {
  /**
   * The guard against a second truth: every answer is derived from
   * FAMILY_SERVICES, so a family added to (or a service removed from) the
   * shared matrix cannot silently disagree with this file.
   */
  it.each(ALL_FAMILIES)("%s answers for exactly the services it carries", (family) => {
    const services = FAMILY_SERVICES[family];
    expect(filesTargetForFamily(family) !== null).toBe(services.includes("files"));
    expect(calendarTargetForFamily(family) !== null).toBe(services.includes("calendar"));
    expect(mailTargetForFamily(family) !== null).toBe(services.includes("mail"));
  });
});
