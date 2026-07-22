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

  it("provides mobile master/detail areas and QR fingerprint approval", () => {
    expect(mobile).toContain('["overview", "devices", "team", "slices", "recovery"]');
    expect(mobile).toContain("inspectMobileWorkspacePairing");
    expect(mobile).toContain("approveMobileWorkspacePairing");
    expect(mobile).toContain("pairPreview.fingerprint");
  });
});
