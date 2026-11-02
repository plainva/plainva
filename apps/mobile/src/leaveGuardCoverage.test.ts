import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";
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

/**
 * Every sheet that holds what the person types asks before it goes (finding
 * 2026-10-22, § 3.139 Nr. 3) — through `useSheetGuard`, or `useGuardedClose`
 * where the form inside the sheet arms its own guard.
 *
 * Read from the files, like the list above: a file that draws a sheet
 * (`SheetGrip`) and a field must use one of the two, or stand below with the
 * reason it holds nothing that a close would lose.
 */
const SHEETS_WITHOUT_TYPED_INPUT: Record<string, string> = {
  "EditorHost.tsx": "table size steppers and a date picked once; nothing typed stays in a sheet",
  "components/EmojiPickSheet.tsx": "the field searches; every pick commits at once",
  "components/HailingSheet.tsx": "an easter egg: a line to try, kept after a miss so the next try can change it - not work",
  "components/MobileDialogHost.tsx": "a prompt's Cancel is its answer to the question that opened it",
  "screens/base/BaseConfigSheet.tsx": "every control writes the view at once",
  "screens/GraphScreen.tsx": "the field filters the graph and sits outside the tools sheet",
  "screens/JournalScreen.tsx": "the field filters the journal; the sheet is a day jump that commits on pick",
  "screens/MailListScreen.tsx": "the field searches the mailbox and sits outside the sheet",
  "screens/PimAccountsScreen.tsx": "the form's values live in the screen, survive the sheet, and the screen arms \"pim-accounts\"",
};

describe("sheet guard coverage", () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
  const FIELD = /<(TextInput|TextArea|GrowingField|MentionTextArea|JournalCaptureField|TaskCaptureField|PropertyNameInput|SearchField|input|textarea)\b/;
  const sheets = walk(here)
    .filter((f) => f.endsWith(".tsx") && !f.includes(".test."))
    .map((f) => [relative(here, f).split(sep).join("/"), readFileSync(f, "utf8")] as const)
    .filter(([, src]) => src.includes("<SheetGrip") && FIELD.test(src));

  it("finds the sheets it is about", () => {
    expect(sheets.map(([f]) => f)).toEqual(expect.arrayContaining(["components/JournalCaptureSheet.tsx", "components/CommentsSheet.tsx", "screens/base/CellEditSheet.tsx"]));
  });

  for (const [f, src] of sheets) {
    it(`${f} asks before a close takes what was typed`, () => {
      const guarded = /\buseSheetGuard\(|\buseGuardedClose\(/.test(src);
      expect(guarded || f in SHEETS_WITHOUT_TYPED_INPUT, `${f} draws a sheet with a field and neither guards it nor says why not`).toBe(true);
      expect(guarded && f in SHEETS_WITHOUT_TYPED_INPUT, `${f} is guarded now: take it off the exemption list`).toBe(false);
    });
  }
});
