import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The import wizard's contract on the phone (S41, extended in P7).
 *
 * The five steps and every number they show come from the shared core, so
 * what has to hold here is the wiring the phone owns: that the run is
 * cancellable, that attachments can actually be read, that a database is
 * written by the canonical serializer, and that the report says how to undo.
 * Each of those is one hook — and a missing hook fails silently, which is
 * exactly why they are pinned.
 */
const here = dirname(fileURLToPath(import.meta.url));
const wizard = readFileSync(join(here, "ImportWizardScreen.tsx"), "utf8");
const routes = readFileSync(join(here, "..", "routes.tsx"), "utf8");
const nav = readFileSync(join(here, "..", "navigation.ts"), "utf8");

describe("mobile import wizard", () => {
  it("walks the same five steps as the desktop", () => {
    expect(wizard).toContain('type Step = "select" | "analyzing" | "preview" | "importing" | "report"');
  });

  it("can be stopped, and stopping is not a failure", () => {
    // The adapters stop between entries and still return a report; without a
    // signal a large import would be a one-way street.
    expect(wizard).toContain("new AbortController()");
    expect(wizard).toContain("controller?.abort()");
    expect(wizard).toContain("signal");
  });

  it("supplies the hooks without which content is silently lost", () => {
    // Attachments: the importers can SEE them and still not carry them over.
    expect(wizard).toContain("readSourceBytes");
    expect(wizard).toContain("archiveByteReader");
    // Databases: falls back to raw JSON and marks them degraded when absent.
    expect(wizard).toContain("serializeBase: serializeBaseConfig");
    // Vault-bound strings, so the report reads like the rest of the app.
    expect(wizard).toContain("buildImportLabels");
    // Entries the unpacker refused belong in the report, not just the preview.
    expect(wizard).toContain("archiveSkipped");
  });

  it("writes through the adapter chain, so imported notes reach the cloud", () => {
    // S3: `vault.adapter` is the RAW sandbox adapter. Importing through it
    // bypassed the sync queue — on a connected vault the imported notes simply
    // stayed on the phone, with no error and nothing on screen to notice. It
    // also skipped the snapshot and the conflict check every other mobile
    // write goes through. `vault.files` is that chain.
    //
    // P7 added exactly one exception, and it is written as one: an import into
    // a brand-new vault writes into a container that has no queue and no
    // history yet, because it did not exist a moment ago. The open vault is
    // still reached through the chain.
    expect(wizard).toContain("into ? into.adapter : vault.files");
    expect(wizard).not.toContain("vaultAdapter: vault.adapter");
  });

  it("names the undo while the report is still on screen", () => {
    // The folder — or, since P7, the vault — IS the undo; a report that does
    // not say so leaves the user hunting for a way back.
    expect(wizard).toMatch(/created \? t\("import\.undoVaultMobile"\) : t\("import\.undoFolder"/);
  });

  it("guards a running import against a stray back gesture", () => {
    expect(wizard).toContain('useLeaveGuard("import", step === "importing"');
    // The nav layer must also treat it as an input surface, or the bar would
    // stay tappable and drop the run without asking.
    expect(nav).toContain('"importwizard"');
    expect(nav).toMatch(/INPUT_KINDS[^;]*importwizard/s);
  });

  it("is reachable — a wizard nobody can open is not a feature", () => {
    expect(routes).toContain("importwizard:");
    expect(routes).toContain("onImport=");
  });

  it("asks an API source for a credential instead of a file (P7)", () => {
    // The phone used to filter these out entirely, which cost the only path
    // that brings Notion databases over as real .base files with rows and
    // relations. What a source needs is read off the adapter — never from a
    // list of ids here, or the next API source is handed a file picker it
    // cannot satisfy.
    expect(wizard).not.toContain('(s.inputKind ?? "files") === "files"');
    expect(wizard).toContain('(source?.inputKind ?? "files") === "api"');
    expect(wizard).toContain("source?.credentials");
    expect(wizard).toContain("`${credentials.guideKey}.notStored`");
  });

  it("never stores the credential — anywhere", () => {
    // The screen promises in ten languages that the token is gone after the
    // run (import.notionToken.notStored). Keeping it on one shell would make
    // that sentence a lie on the other, so: state only, cleared in `finally`,
    // and none of the three places a secret could otherwise end up.
    expect(wizard).toContain('setToken("")');
    // The four ways a secret could be persisted on this shell, named as CALLS:
    // an earlier version of this check matched the word "profile" and so
    // measured its own prose instead of the code.
    for (const persist of ["writeSecret(", "Preferences.set(", "setMobileSettings(", "localStorage"]) {
      expect(wizard).not.toContain(persist);
    }
    // And not into the vault: an import writes files, the token is not one.
    expect(wizard).not.toMatch(/writeTextFile\([^)]*token/i);
  });

  it("registers the API host before the first request", () => {
    // The native bridge refuses any origin nobody allowed (hardening P4.3),
    // and a refused first request looks exactly like a bad token. The host is
    // declared by the adapter, not spelled out here.
    expect(wizard).toContain("credentials?.apiOrigin");
    expect(wizard).toContain("allowHttpOrigin");
    // And the run needs the bridge itself: a WebView fetch to another origin
    // dies on CORS.
    expect(wizard).toContain("httpFetch: webdavFetch");
  });

  it("lets the import choose its target, and names the right undo for it", () => {
    // Writing only into a subfolder cost the case import exists for: arriving
    // from another app with nothing here yet.
    expect(wizard).toContain('type Target = "subfolder" | "newVault"');
    expect(wizard).toContain("createImportVault");
    // Two different undos, because a new vault is not a folder.
    expect(wizard).toContain('t("import.undoVaultMobile")');
    expect(wizard).toContain('t("import.undoFolder"');
  });

  it("creates the new vault when the run starts, not when the target is picked", () => {
    // An abandoned preview must not leave an empty vault in the user's list.
    const runBody = wizard.slice(wizard.indexOf("const run = async ()"), wizard.indexOf("/** Closing after"));
    expect(runBody).toContain("createImportVault");
    const selectStep = wizard.slice(wizard.indexOf('{step === "select" &&'), wizard.indexOf('{step === "analyzing" &&'));
    expect(selectStep).not.toContain("createImportVault");
  });
});
