import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The import wizard's contract on the phone (S41).
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

  it("names the undo while the report is still on screen", () => {
    // The folder IS the undo; a report that does not say so leaves the user
    // hunting for a way back.
    expect(wizard).toContain('t("import.undoFolder"');
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

  it("offers only sources that take files, never an API source", () => {
    // An API importer would be handed a file picker and an error nobody can
    // satisfy; the phone has no credential screen for them yet.
    expect(wizard).toContain('(s.inputKind ?? "files") === "files"');
  });
});
