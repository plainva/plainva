import { describe, expect, it } from "vitest";
import { findCloudAccountByRef, type CloudAccountRecord } from "@plainva/ui";

/**
 * Lives beside the other tests of @plainva/ui code: the package itself has no
 * test runner. Finding 2026-09-01 (D2): "Sign in again" used to land on the provider
 * chooser because the deep link carried no account. The offers know a mail or
 * calendar account, not the cloud record — the lookup accepts either.
 */
const records: CloudAccountRecord[] = [
  { id: "cloud-ms", family: "microsoft", label: "me@contoso.com", services: { files: { provider: "onedrive" }, calendar: { pimAccountId: "pim-1" }, mail: { mailAccountId: "mail-1" } } },
  { id: "cloud-imap", family: "imap", label: "me@example.org", services: { mail: { mailAccountId: "mail-2" } } },
];

describe("findCloudAccountByRef", () => {
  it("resolves the record by its own id", () => {
    expect(findCloudAccountByRef(records, "cloud-imap")?.id).toBe("cloud-imap");
  });
  it("resolves the record that owns a mail account", () => {
    expect(findCloudAccountByRef(records, "mail-1")?.id).toBe("cloud-ms");
    expect(findCloudAccountByRef(records, "mail-2")?.id).toBe("cloud-imap");
  });
  it("resolves the record that owns a calendar account", () => {
    expect(findCloudAccountByRef(records, "pim-1")?.id).toBe("cloud-ms");
  });
  it("answers nothing for a reference no card owns", () => {
    expect(findCloudAccountByRef(records, "gone")).toBeUndefined();
    expect(findCloudAccountByRef([], "cloud-ms")).toBeUndefined();
  });
});
