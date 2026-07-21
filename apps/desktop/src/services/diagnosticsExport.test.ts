import { beforeEach, describe, expect, it } from "vitest";
import { clearDiagnosticsForTests, formatDiagnosticsExport, logDiagnostic, redactDiagnosticText } from "@plainva/ui";

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

  it("stores only redacted errors in the exported report", () => {
    logDiagnostic("sync", "request failed: access_token=live-token");
    const report = formatDiagnosticsExport({ appVersion: "test", tauriVersion: "test", os: "test", language: "en" });
    expect(report).toContain("access_token=[REDACTED]");
    expect(report).not.toContain("live-token");
  });
});
