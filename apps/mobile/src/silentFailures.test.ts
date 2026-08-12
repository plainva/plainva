import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Four silent failures (S20).
 *
 * Each of these did exactly what it was told and said nothing about it. The
 * shape they share is a branch that returns — an `if` guard, a missing
 * `.catch`, a condition on the wrong thing — where the user is left believing
 * the action landed.
 *
 * The assertions read the SOURCE on purpose. Three of the four are about a
 * question being asked, a promise being caught, or a branch not being taken;
 * a test with mocks would assert against its own mocks and stay green while
 * the branch quietly returns in the app.
 */

const SRC = fileURLToPath(new URL(".", import.meta.url));
const LOCALES = join(SRC, "..", "..", "..", "packages", "ui", "src", "locales");
const read = (...p: string[]) => readFileSync(join(SRC, ...p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("renewing recovery asks before it invalidates", () => {
  const text = strip(read("screens", "SecurityAreaScreen.tsx"));

  it("asks, and stops when the answer is no", () => {
    // The tap used to rotate straight away. Renewing makes the recovery file
    // the user is holding worthless — if the share sheet is then dismissed,
    // they have no working recovery at all.
    const body = text.slice(text.indexOf("const renewRecovery"), text.indexOf("setBusyAction(\"renew\")"));
    expect(body, "renewRecovery must ask before it rotates").toMatch(/await mConfirm\(/);
    expect(body, "a declined question must stop the rotation").toMatch(/if \(!ok\) return;/);
  });

  it("the question names the consequence, in every language", () => {
    for (const lang of LANGS) {
      const d = dict(lang);
      expect(d.workspaceSecurity?.renewConfirmTitle, `${lang} lacks the question`).toBeTruthy();
      expect(d.workspaceSecurity?.renewConfirmBody, `${lang} lacks the consequence`).toBeTruthy();
    }
  });
});

describe("the composer without a mailbox says so", () => {
  const text = strip(read("screens", "MailComposeScreen.tsx"));

  it("shows the empty state instead of a form that cannot send", () => {
    // Reachable from a note ("send as mail") with no account at all: the form
    // rendered, and send() returned wordlessly on `if (!vaultId || !account)`.
    expect(text).toMatch(/accountsLoaded && accounts\.length === 0/);
    expect(text).toMatch(/mail\.noAccounts/);
    expect(text, "an empty state without a way out is a dead end").toMatch(/onOpenAccounts/);
  });

  it("waits for the account list before claiming there is none", () => {
    // Without the flag the empty state flashes on every open, because the
    // list arrives one tick later.
    expect(text).toMatch(/setAccountsLoaded\(true\)/);
  });

  it("is wired to the accounts screen", () => {
    expect(strip(read("routes.tsx"))).toMatch(/onOpenAccounts=\{\(\) => c\.push\(\{ kind: "mailaccounts"/);
  });
});

describe("a property change that fails, says it failed", () => {
  const text = strip(read("components", "NoteContextSheet.tsx"));

  it("catches the write", () => {
    const commit = text.slice(text.indexOf("commitCellValue(vault"), text.indexOf("rows={[]}"));
    expect(commit, "a bare .then() swallows the failure").toMatch(/\.catch\(/);
    expect(commit).toMatch(/mobile\.propertyWriteFailed/);
  });

  it("does not offer editing where the workspace forbids writing", () => {
    // Read-only and comment-only membership: the editor opened, the write
    // failed at the adapter, and the old value stayed on screen.
    expect(text).toMatch(/canWrite = true/);
    expect(text, "rows must be static without the write right").toMatch(/LOCKED\.has\(k\) \|\| !canWrite/);
    expect(text, "adding a property must be gated too").toMatch(/\{canWrite && \(/);
    const note = strip(read("screens", "NoteScreen.tsx"));
    expect(
      [...note.matchAll(/canWrite=\{workspaceCanWrite\}/g)].length,
      "both the sheet and the docked column must be told",
    ).toBe(2);
  });

  it("names the failure in every language", () => {
    for (const lang of LANGS) {
      const v = dict(lang).mobile?.propertyWriteFailed;
      expect(v, `${lang} lacks mobile.propertyWriteFailed`).toBeTruthy();
      expect(v, `${lang} must carry the reason`).toContain("{{message}}");
    }
  });
});

describe("saving with .eml saves the .eml", () => {
  const text = strip(read("screens", "MailMessageScreen.tsx"));

  it("decides on the raw copy, not on whether the note is new", () => {
    // `mode === "eml" && res.created` skipped the whole point of the action
    // the second time a message was captured — and the toast said only that
    // the note already existed.
    expect(text, "the .eml must not hang on res.created").not.toMatch(/mode === "eml" && res\.created/);
    expect(text).toMatch(/if \(mode === "eml"\) \{/);
    expect(text, "an already linked raw copy must not be written twice").toMatch(/\\.eml\\]\\]/);
  });

  it("says that the raw copy was added", () => {
    expect(text).toMatch(/mail\.emlAdded/);
    for (const lang of LANGS) {
      expect(dict(lang).mail?.emlAdded, `${lang} lacks mail.emlAdded`).toBeTruthy();
    }
  });
});

const LANGS = ["en", "de", "fr", "es", "it", "nl", "pl", "pt-BR", "ja", "zh-CN"] as const;

function dict(lang: string): {
  workspaceSecurity?: Record<string, string>;
  mobile?: Record<string, string>;
  mail?: Record<string, string>;
} {
  return JSON.parse(readFileSync(join(LOCALES, `${lang}.json`), "utf8")) as never;
}
