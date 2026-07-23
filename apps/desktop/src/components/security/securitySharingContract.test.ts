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

  it("moves the second-level area navigation into the settings left column (IA v2, P1)", () => {
    // The overview (first level) keeps the hero, summary cards and area detail.
    for (const className of ["pv-security-hero", "pv-security-summary-grid", "pv-security-summary-card", "pv-security-detail"]) expect(page).toContain(className);
    // The old in-content admin rail / internal drill-in state is gone — the
    // settings modal now owns the second-level navigation.
    expect(page).not.toContain("pv-security-admin");
    expect(page).not.toContain("pv-security-nav");
    expect(page).not.toContain("pv-security-tabs");
    expect(page).not.toContain('role="tablist"');
    expect(page).not.toContain("adminTab");
    // The active area is driven by the prop from the settings modal.
    expect(page).toContain("securityArea");
    expect(page).toContain("onOpenSecurityArea");
    expect(page).toContain('area === "members"');
    expect(page).toContain('area === "devices"');
    // Second level: SecurityNav replaces the settings left column (SettingsNav).
    const modal = readFileSync(new URL("../SettingsModal.tsx", import.meta.url), "utf8");
    expect(modal).toContain("SecurityNav");
    expect(modal).toContain("inSecurityLevel2");
    const nav = readFileSync(new URL("../settings/SecurityNav.tsx", import.meta.url), "utf8");
    expect(nav).toContain("SECURITY_AREA_GROUPS");
    expect(nav).toContain("workspaceSecurity.overview");
    // Member rotation depth (future vs full) still routes through the gateway.
    expect(page).toContain('revokeWorkspaceMember(member.memberId, "Removed in Security Center", "future")');
    expect(page).toContain('revokeWorkspaceMember(member.memberId, "Removed in Security Center", "full")');
    // Every picker is the themed Select primitive — no OS-rendered native <select>.
    expect(dialog).not.toContain("<select");
    expect(dialog).toContain("roleOptions(t)");
    expect(dialog).toContain("providerOptions()");
  });

  it("overview shows entry cards + encryption disconnect; recovery is a split area; add-device does not create a member (P2/P3)", () => {
    // Two named entry cards replace the three navigating summary cards.
    expect(page).toContain("workspaceSecurity.manageAccess");
    expect(page).toContain("workspaceSecurity.manageSharing");
    // The device-local disconnect stays on the overview (relabelled, danger-soft).
    expect(page).toContain("workspaceSecurity.cloudDisconnect");
    // Recovery is its own second-level area, split into status vs workflow.
    expect(page).toContain('area === "recovery"');
    expect(page).toContain("workspaceSecurity.recoveryStatus");
    expect(page).toContain("workspaceSecurity.recoveryWorkflow");
    // "Add another device" reuses the invitation bound to the OWN member id and
    // never creates a new member.
    expect(page).toContain("workspaceSecurity.addDevice");
    expect(page).toContain("self: true");
    expect(page).toContain("memberId: governance.memberId");
    // "Show invitation" is available on the own member row too (self flag).
    expect(page).toContain("self: member.memberId === governance.memberId");
    // Inviting a NEW person opens the code dialog automatically (E5).
    expect(page).toContain("const submitInvite = async");
    expect(page).toContain("setInviteFor({ memberId, displayName: form.name");
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

  it("offers a desktop join flow and a copyable invitation artifact (package C1/C3/C4)", () => {
    // The page detects a joinable remote workspace and opens the join dialog.
    expect(page).toContain("detectJoinableWorkspace");
    expect(page).toContain("WorkspaceJoinDialog");
    // The invitation artifact is a copyable invite code + full member ID.
    expect(page).toContain("encodeWorkspaceInvite");
    expect(page).toContain('t("workspaceSecurity.memberIdFull"');
    // The join dialog states the three-step invite -> pair -> active model.
    const join = readFileSync(new URL("./WorkspaceJoinDialog.tsx", import.meta.url), "utf8");
    expect(join).toContain("beginWorkspaceJoin");
    expect(join).toContain("pollWorkspaceJoin");
    expect(join).toContain("pv-security-model");
  });

  it("offers a confirmed workspace decommission + orphan recovery (Stilllegen P4)", () => {
    expect(page).toContain("decommissionWorkspace");
    expect(page).toContain('data-testid="workspace-decommission"');
    expect(page).toContain('t("workspaceSecurity.orphanRecovery"');
    // The decommission goes through the danger confirm, never silently.
    expect(page).toContain('kind: "danger"');
  });

  it("provides mobile master/detail areas and QR fingerprint approval", () => {
    expect(mobile).toContain('["overview", "devices", "team", "slices", "recovery"]');
    expect(mobile).toContain("inspectMobileWorkspacePairing");
    expect(mobile).toContain("approveMobileWorkspacePairing");
    expect(mobile).toContain("pairPreview.fingerprint");
    // P4: groups and publications are visible read-only on mobile (managed on desktop).
    expect(mobile).toContain("runtime.policy.payload.groups.map");
    expect(mobile).toContain("slice.publication");
    expect(mobile).toContain("workspaceSecurity.mobileManageOnDesktop");
  });

  it("renders real QR codes for the invitation and the mobile pairing request (P6)", () => {
    // Desktop invitation modal shows the code AND a scannable QR of the same code.
    expect(page).toContain("QrImage");
    expect(page).toContain("<QrImage value={inviteCode}");
    expect(page).toContain("workspaceSecurity.inviteQrCaption");
    // Mobile: scan an invitation into the code field, and show the pairing
    // request as a QR the approver can scan. Both scans use the shared decoder
    // (native BarcodeDetector + jsQR fallback), so no native barcode plugin.
    expect(mobile).toContain("decodeQrFromDataUrl");
    expect(mobile).toContain("const scanInvite = async");
    expect(mobile).toContain("workspaceSecurity.scanInvite");
    expect(mobile).toContain("<QrImage value={request.token}");
    const scan = readFileSync(new URL("../../../../mobile/src/services/qrScan.ts", import.meta.url), "utf8");
    expect(scan).toContain('import jsQR from "jsqr"');
    expect(scan).toContain("BarcodeDetector");
  });

  it("mobile joins an encrypted workspace by pasting the invitation code, not a raw member id", () => {
    // The join flow decodes the same PVINVITE1 code the desktop shows — the old
    // "type a member id" field (which surfaced an id no desktop screen exposes)
    // is gone.
    expect(mobile).toContain("decodeWorkspaceInvite");
    expect(mobile).toContain("inviteCode");
    expect(mobile).not.toContain("setMemberId");
    expect(mobile).not.toContain('t("workspaceSecurity.memberId"');
  });
});
