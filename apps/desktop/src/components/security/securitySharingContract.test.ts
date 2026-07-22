import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const desktop = readFileSync(new URL("./SecuritySharingPage.tsx", import.meta.url), "utf8");
const mobile = readFileSync(new URL("../../../../mobile/src/screens/SecurityAreaScreen.tsx", import.meta.url), "utf8");

describe("P8-P11 security-centre interaction contract", () => {
  it("keeps prerequisite actions actionable and routes them through the workspace gateway", () => {
    expect(desktop).not.toContain("disabled={!governance");
    expect(desktop).not.toContain("disabled={!hasSyncConnection");
    expect(desktop).toContain("const requireWorkspace = async");
    expect(desktop).toContain('plainva-open-sync-settings');
    expect(desktop).toContain("await openVault(selectedVault)");
  });

  it("implements the mockup dashboard, administration tabs and four-step slice wizard", () => {
    for (const className of ["pv-security-hero", "pv-security-summary-grid", "pv-security-summary-card", "pv-security-admin", "pv-security-tabs", "pv-security-slice-wizard", "pv-security-choice-grid"]) expect(desktop).toContain(className);
    expect(desktop).toContain('["members", "groups", "slices", "devices", "publications"]');
    expect(desktop).toContain('["details", "content", "permissions", "review"]');
    expect(desktop).toContain('revokeWorkspaceMember(member.memberId, "Removed in Security Center", "future")');
    expect(desktop).toContain('revokeWorkspaceMember(member.memberId, "Removed in Security Center", "full")');
  });

  it("makes recovery setup a self-explanatory numbered verification flow", () => {
    for (const className of ["pv-security-recovery-task", "pv-security-task-number", "pv-security-code-groups", "pv-security-code-group", "pv-security-challenge-grid", "pv-security-next"]) expect(desktop).toContain(className);
    expect(desktop).toContain("data-requested={requested}");
    expect(desktop).toContain('t("workspaceSecurity.recoveryTaskCheckDesc", { first: challenge[0] + 1, second: challenge[1] + 1 })');
    expect(desktop).toContain('event.target.value.replace(/[^a-z0-9]/gi, "").toUpperCase()');
    expect(desktop).toContain("disabled={busy || !saved || !challengeConfirmed}");
    expect(desktop).toContain('t("workspaceSecurity.recoveryNextSave")');
    expect(desktop).toContain('t("workspaceSecurity.recoveryReady")');
  });

  it("provides mobile master/detail areas and QR fingerprint approval", () => {
    expect(mobile).toContain('["overview", "devices", "team", "slices", "recovery"]');
    expect(mobile).toContain("inspectMobileWorkspacePairing");
    expect(mobile).toContain("approveMobileWorkspacePairing");
    expect(mobile).toContain("pairPreview.fingerprint");
  });
});
