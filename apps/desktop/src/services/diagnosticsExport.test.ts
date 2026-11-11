import { beforeEach, describe, expect, it } from "vitest";
import { clearDiagnosticsForTests, formatDiagnosticsExport, logDiagnostic, logIndexDiagnostics, redactDiagnosticText } from "@plainva/ui";
import type { IDatabaseAdapter } from "@plainva/core";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../test-sourceTree";
import { conflictDiagnostic } from "@plainva/core";

describe("diagnostics export redaction", () => {
  beforeEach(() => clearDiagnosticsForTests());

  it("redacts URL userinfo, authorization headers, JSON and query secrets", () => {
    const raw = 'https://user:super-secret@example.com Authorization: Bearer abc.def {"refresh_token":"rotate-me"} password=hunter2&ok=1';
    const safe = redactDiagnosticText(raw);
    expect(safe).not.toContain("super-secret");
    expect(safe).not.toContain("abc.def");
    expect(safe).not.toContain("rotate-me");
    expect(safe).not.toContain("hunter2");
    expect(safe.match(/\[REDACTED\]/g)?.length).toBe(4);
  });

  it("writes fixed English headings whatever the app language (#105)", async () => {
    const empty = formatDiagnosticsExport({ appVersion: "test", tauriVersion: "test", os: "test", language: "de" });
    expect(empty).toContain("# Plainva diagnostics export");
    expect(empty).toContain("- Language: de");
    expect(empty).toMatch(/^- Exported: \d{4}-\d{2}-\d{2}T/m);
    expect(empty).toContain("Note: contains NO note content; error messages may contain vault-relative file paths.");
    expect(empty).toContain("## Events (newest last)");
    expect(empty).toContain("(no errors recorded in this session)");

    logDiagnostic("sync", "request failed");
    const diagnostic = await conflictDiagnostic({ path: "a.md", adapter: "external-folder", writer: "editor-save",
      disk: "x", base: null, baseSource: "none", expectedLocalHash: null, wasWrittenByUs: false });
    const full = formatDiagnosticsExport({ appVersion: "test", tauriVersion: "test", os: "test", language: "ja", conflicts: [diagnostic] });
    expect(full).toContain("## Local conflict diagnostics (no file names or note content)");
    expect(full).not.toContain("(no errors recorded in this session)");
    // No German left in the fixed text.
    for (const german of ["Diagnose", "Sprache", "Exportiert", "Hinweis", "Ereignisse", "Konflikt", "keine"]) {
      expect(`${empty}\n${full}`).not.toContain(german);
    }
  });

  it("stores only redacted errors in the exported report", () => {
    logDiagnostic("sync", "request failed: access_token=live-token");
    const report = formatDiagnosticsExport({ appVersion: "test", tauriVersion: "test", os: "test", language: "en" });
    expect(report).toContain("access_token=[REDACTED]");
    expect(report).not.toContain("live-token");
  });

  it("exports only the allowed conflict facts even if a stored record has extra fields", async () => {
    const diagnostic = await conflictDiagnostic({ path: "private-note.md", adapter: "external-folder", writer: "editor-save",
      disk: "secret contents", base: null, baseSource: "none", expectedLocalHash: null, wasWrittenByUs: false });
    const report = formatDiagnosticsExport({ appVersion: "test", tauriVersion: "test", os: "test", language: "en",
      conflicts: [{ ...diagnostic, ...{ path: "private-note.md", content: "secret contents" } }] });
    expect(report).toContain(diagnostic.pathHash);
    expect(report).toContain("editor-save");
    expect(report).not.toContain("private-note.md");
    expect(report).not.toContain("secret contents");
  });

  it("T13 security gate: redacts OAuth client registrations and generic token fields", () => {
    const raw = 'clientId="desktop-client-marker" client_secret=client-secret-marker token=grant-marker';
    const safe = redactDiagnosticText(raw);
    expect(safe).not.toContain("desktop-client-marker");
    expect(safe).not.toContain("client-secret-marker");
    expect(safe).not.toContain("grant-marker");
  });

  // A numbering of the index's full-text rows that failed (index format 9) is
  // recorded in the database as a kind and a count. Both shells hand it to the
  // export right after opening the database; nothing of the vault goes with it.
  it("carries the index's own diagnostics: a kind and a count, no path, no text", async () => {
    const db = {
      query: async () => [
        { key: "index-diagnostic:fts-numbering", value: JSON.stringify({ count: 2, at: "2026-11-11T08:00:00.000Z" }) },
        { key: "index-diagnostic:empty", value: "{}" },
      ],
    } as unknown as IDatabaseAdapter;
    await logIndexDiagnostics(db);
    const report = formatDiagnosticsExport({ appVersion: "test", tauriVersion: "test", os: "test", language: "en" });
    expect(report).toContain("fts-numbering: the full-text index was built anew after a failed numbering (2×)");
    expect(report).not.toContain("index-diagnostic:empty");
    expect(report).not.toMatch(/\.md/);
  });

  it("is read by both shells right after the vault's database is opened", () => {
    for (const file of ["apps/desktop/src/contexts/VaultContext.tsx", "apps/mobile/src/services/vaultService.ts"]) {
      const source = readFileSync(join(REPO, file), "utf8");
      const schema = source.search(/await (?:perfMeasure\("vault open: database schema", \(\) => )?initializeSchema\((?:dbAdapter|db)\)\)?;/);
      expect(schema, file).toBeGreaterThan(-1);
      expect(source.indexOf("await logIndexDiagnostics(", schema), file).toBeGreaterThan(schema);
    }
  });
});
