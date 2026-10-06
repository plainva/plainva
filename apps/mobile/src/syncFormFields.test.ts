import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The phone's form for a WebDAV or S3 sync target (Play feedback 2026-09-30:
 * neither could be set up on a phone with a Japanese keyboard). Not
 * reproduced on a device; these are the three defects the form itself had,
 * and each one alone is enough to make a setup fail:
 *
 *  - its address and key fields were plain text fields, so the keyboard
 *    capitalised, corrected and - set to Japanese - typed full-width forms;
 *  - what was typed went to the server as typed;
 *  - it had no path-style switch, which the desktop's form has had from the
 *    start, so a store that answers only on the bucket's own host could not
 *    be set up on the phone at all.
 */
const SRC = dirname(fileURLToPath(import.meta.url));
const form = readFileSync(join(SRC, "AddVaultScreen.tsx"), "utf8");
const desktop = readFileSync(join(SRC, "..", "..", "desktop", "src", "components", "settings", "CloudAccountsWizard.tsx"), "utf8");

/** The `<TextInput … />` whose change handler sets `field`. */
const input = (field: string) => {
  const at = form.indexOf(field);
  expect(at, field).toBeGreaterThan(0);
  const start = form.lastIndexOf("<TextInput", at);
  return form.slice(start, form.indexOf("/>", at));
};

describe("the phone's sync target form", () => {
  it("declares its address fields as addresses and asks for the URL keyboard", () => {
    for (const field of ["setWebdav({ ...webdav, url:", "setS3({ ...s3, endpoint:"]) {
      expect(input(field)).toContain('purpose="address"');
      expect(input(field)).toContain('inputMode="url"');
    }
    for (const field of ["setS3({ ...s3, region:", "setS3({ ...s3, bucket:"]) expect(input(field)).toContain('purpose="address"');
    expect(input("setS3({ ...s3, accessKeyId:")).toContain('purpose="secret"');
    // A user name is not a word either.
    expect(input("setWebdav({ ...webdav, user:")).toContain('autoCapitalize="none"');
  });

  it("reads addresses and key ids as a machine does before connecting - and never the passwords", () => {
    expect(form).toContain("url: foldMachineText(webdav.url)");
    for (const field of ["endpoint", "bucket", "accessKeyId"]) expect(form).toContain(`${field}: foldMachineText(s3.${field})`);
    expect(form).not.toMatch(/foldMachineText\([^)]*(pass|secretAccessKey)/);
  });

  it("offers the path-style switch the desktop's form offers", () => {
    expect(desktop).toContain('t("settings.s3PathStyle")');
    expect(form).toContain('title={t("settings.s3PathStyle")}');
    expect(form).toContain("setS3({ ...s3, forcePathStyle: on })");
    // On by default, as on the desktop and in the sync target itself.
    expect(form).toMatch(/forcePathStyle: true,/);
  });

  it("the desktop's wizard reads the same fields the same way", () => {
    for (const field of ["endpoint", "bucket", "accessKeyId"]) expect(desktop).toContain(`${field}: foldMachineText(s3.${field})`);
    expect(desktop).toContain("foldMachineText(wd.base)");
  });
});
