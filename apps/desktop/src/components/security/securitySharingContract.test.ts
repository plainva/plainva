import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("./SecuritySharingPage.tsx", import.meta.url), "utf8");
const dialog = readFileSync(new URL("./WorkspaceGovernanceDialog.tsx", import.meta.url), "utf8");
const wizard = readFileSync(new URL("./WorkspaceSetupWizard.tsx", import.meta.url), "utf8");
// The security centre was split into a page + governance dialog + setup wizard
// (package B3); the assertions below target the file that owns each surface.
const mobile = readFileSync(new URL("../../../../mobile/src/screens/SecurityAreaScreen.tsx", import.meta.url), "utf8");

describe("P8-P11 security-centre interaction contract", () => {
  it("keeps prerequisite actions actionable and routes them through the workspace gateway", () => {
    expect(page).not.toContain("disabled={!governance");
    expect(page).not.toContain("disabled={!hasSyncConnection");
    expect(page).toContain("const requireWorkspace = async");
    expect(page).toContain('plainva-open-sync-settings');
    expect(page).toContain("await openVault(selectedVault)");
  });

  it("uses a master/detail administration surface, not a tablist (package B1/B2)", () => {
    for (const className of ["pv-security-hero", "pv-security-summary-grid", "pv-security-summary-card", "pv-security-admin", "pv-security-nav", "pv-security-detail"]) expect(page).toContain(className);
    // The old hand-built tablist is gone; each area renders its own detail.
    expect(page).not.toContain("pv-security-tabs");
    expect(page).not.toContain('role="tablist"');
    expect(page).toContain('["members", "groups", "slices", "devices", "publications"]');
    expect(page).toContain('revokeWorkspaceMember(member.memberId, "Removed in Security Center", "future")');
    expect(page).toContain('revokeWorkspaceMember(member.memberId, "Removed in Security Center", "full")');
    // Every picker is the themed Select primitive — no OS-rendered native <select>.
    expect(dialog).not.toContain("<select");
    expect(dialog).toContain("roleOptions(t)");
    expect(dialog).toContain("providerOptions()");
  });

  it("keeps the four-step slice wizard with content-type cards", () => {
    for (const className of ["pv-security-slice-wizard", "pv-security-choice-grid"]) expect(dialog).toContain(className);
    expect(dialog).toContain('["details", "content", "permissions", "review"]');
  });

  it("makes recovery setup a self-explanatory numbered verification flow", () => {
    for (const className of ["pv-security-recovery-task", "pv-security-task-number", "pv-security-code-groups", "pv-security-code-group", "pv-security-challenge-grid", "pv-security-next"]) expect(wizard).toContain(className);
    expect(wizard).toContain("data-requested={requested}");
    expect(wizard).toContain('t("workspaceSecurity.recoveryTaskCheckDesc", { first: challenge[0] + 1, second: challenge[1] + 1 })');
    expect(wizard).toContain('event.target.value.replace(/[^a-z0-9]/gi, "").toUpperCase()');
    expect(wizard).toContain("disabled={busy || !saved || !challengeConfirmed}");
    expect(wizard).toContain('t("workspaceSecurity.recoveryNextSave")');
    expect(wizard).toContain('t("workspaceSecurity.recoveryReady")');
  });

  it("provides mobile master/detail areas and QR fingerprint approval", () => {
    expect(mobile).toContain('["overview", "devices", "team", "slices", "recovery"]');
    expect(mobile).toContain("inspectMobileWorkspacePairing");
    expect(mobile).toContain("approveMobileWorkspacePairing");
    expect(mobile).toContain("pairPreview.fingerprint");
  });
});
