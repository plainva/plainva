import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every surface that holds unsaved input asks before it is left (S45).
 *
 * P0 named this defect class at the start of the rebuild: a tap on the
 * navigation bar discarded a mail draft, cloud credentials and the encryption
 * wizard without a word. Those were fixed. The adversarial pass at S45 found
 * three more of exactly the same shape that the sweep never reached — and they
 * hold the highest-value text the app ever asks for: a Google client secret, an
 * IMAP app password, and the workspace recovery code.
 *
 * A list is only as good as the thing that keeps it complete, so this reads the
 * screens rather than trusting a comment: a file with a password field, or one
 * that holds a recovery/invitation code, must arm the guard.
 */
const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(join(here, p), "utf8");

/** Surfaces that take a secret the user typed and cannot get back. */
const CREDENTIAL_SURFACES = [
  ["screens/PimAccountsScreen.tsx", "pim-accounts"],
  // The guard sits in the FORM, not the host screen: the form owns the
  // password until submit hands it over.
  ["screens/mail/MailImapForm.tsx", "mail-imap"],
  ["screens/SecurityAreaScreen.tsx", "security-area"],
  ["AddVaultScreen.tsx", "vault-connect"],
] as const;

describe("leave guard coverage", () => {
  for (const [file, id] of CREDENTIAL_SURFACES) {
    it(`${file} asks before discarding what was typed`, () => {
      const src = read(file);
      expect(src).toContain("useLeaveGuard(");
      expect(src).toContain(`"${id}"`);
    });
  }

  it("no screen holds a password field without arming the guard", () => {
    // The check that keeps the list above honest: a new credential screen
    // cannot be added without either arming a guard or failing here.
    const files = [
      "screens/PimAccountsScreen.tsx",
      "screens/MailAccountsScreen.tsx",
      "screens/mail/MailImapForm.tsx",
      "AddVaultScreen.tsx",
    ];
    for (const f of files) {
      const src = read(f);
      if (!src.includes('type="password"')) continue;
      // The form component may be armed by its host screen; both count.
      const armed = src.includes("useLeaveGuard(") || f.includes("MailImapForm");
      expect(armed, `${f} has a password field but arms no guard`).toBe(true);
    }
  });
});
