import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("./SecuritySharingPage.tsx", import.meta.url), "utf8");
const dialog = readFileSync(new URL("./WorkspaceGovernanceDialog.tsx", import.meta.url), "utf8");
const wizard = readFileSync(new URL("./WorkspaceSetupWizard.tsx", import.meta.url), "utf8");
const panels = readFileSync(new URL("./securityPanels.tsx", import.meta.url), "utf8");
// The security centre was split into a page + governance dialog + setup wizard
// (package B3); the assertions below target the file that owns each surface.
const mobile = readFileSync(new URL("../../../../mobile/src/screens/SecurityAreaScreen.tsx", import.meta.url), "utf8");

/**
 * These are SOURCE assertions, and the names say so.
 *
 * Every check below greps a component file for a call, a prop or a string.
 * That catches a surface being deleted, renamed or quietly unwired - it proves
 * nothing about what happens when a person clicks. The names used to read like
 * behaviour ("mobile joins an encrypted workspace..."), which invites the next
 * session to treat a green run as proof the flow works; it never was. What the
 * flows actually do is covered by `e2e/security.spec.ts`.
 */

describe("security centre: what the source still wires (source guard, not behaviour)", () => {
  it("source: prerequisite actions stay actionable and go through the workspace gateway", () => {
    expect(page).not.toContain("disabled={!governance");
    expect(page).not.toContain("disabled={!hasSyncConnection");
    expect(page).toContain("const requireWorkspace = async");
    expect(page).toContain('plainva-open-sync-settings');
    expect(page).toContain("await openVault(selectedVault)");
  });

  it("source: the second-level area navigation lives in the settings left column (IA v2, P1)", () => {
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
    // Since P5 it arrives as the mode a labelled choice produced, not as two
    // differently coloured buttons whose difference was explained afterwards.
    expect(page).toContain('revokeWorkspaceMember(subject.id, "Removed in Security Center", mode)');
    expect(page).toContain('revokeWorkspaceDevice(subject.id, "Removed in Security Center", mode)');
    expect(panels).toContain('setMode("future")');
    expect(panels).toContain('setMode("full")');
    // Every picker is the themed Select primitive — no OS-rendered native <select>.
    expect(dialog).not.toContain("<select");
    expect(dialog).toContain("roleOptions(t)");
    expect(dialog).toContain("providerOptions()");
  });

  it("source: overview keeps entry cards + encryption disconnect, recovery is a split area, add-device never creates a member (P2/P3)", () => {
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

  it("source: the slice wizard still has four steps and content-type cards", () => {
    for (const className of ["pv-security-slice-wizard", "pv-security-choice-grid"]) expect(dialog).toContain(className);
    expect(dialog).toContain('["details", "content", "permissions", "review"]');
  });

  it("source: the folder of a folder slice is picked from the vault on both shells (finding 2026-09-03)", () => {
    expect(dialog).toContain('data-testid="slice-folder-browse"');
    expect(dialog).toContain("<SyncFolderPickerModal");
    expect(dialog).toContain("listVaultFolders(vaultAdapter, path)");
    expect(mobile).toContain("<FolderPickerSheet");
    expect(mobile).toContain("setSliceFolder(path)");
  });

  it("source: the quarantine is groups with actions on both shells, through the shared service (finding 2026-09-03)", () => {
    expect(page).toContain("<QuarantineCard");
    expect(page).not.toContain("label={`${entry.artifactKind} · ${entry.status}`}");
    expect(mobile).toContain("<QuarantineList");
    expect(mobile).toContain("updateMobileQuarantine(vault, quarantineSync()");
    expect(mobile).toContain("exportMobileQuarantineDiagnostics(vault, quarantineSync()");
  });

  it("source: recovery setup still renders a numbered verification flow", () => {
    for (const className of ["pv-security-recovery-task", "pv-security-task-number", "pv-security-code-groups", "pv-security-code-group", "pv-security-challenge-grid", "pv-security-next"]) expect(wizard).toContain(className);
    expect(wizard).toContain("data-requested={requested}");
    expect(wizard).toContain('t("workspaceSecurity.recoveryTaskCheckDesc", { first: challenge[0] + 1, second: challenge[1] + 1 })');
    expect(wizard).toContain('event.target.value.replace(/[^a-z0-9]/gi, "").toUpperCase()');
    expect(wizard).toContain("disabled={busy || !saved || !challengeConfirmed}");
    expect(wizard).toContain('t("workspaceSecurity.recoveryNextSave")');
    expect(wizard).toContain('t("workspaceSecurity.recoveryReady")');
  });

  it("source: a desktop join flow and a copyable invitation artifact are wired (package C1/C3/C4)", () => {
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

  it("source: a waiting join renders its reason, its expiry and its fingerprint (P5, B10)", () => {
    const join = readFileSync(new URL("./WorkspaceJoinDialog.tsx", import.meta.url), "utf8");
    const pairing = readFileSync(new URL("../../services/workspaceSecurity/workspacePairing.ts", import.meta.url), "utf8");
    // A failing poll used to end in the console, so a broken connection looked
    // exactly like "nobody has approved yet".
    expect(join).toContain('t("workspaceSecurity.joinPollFailed"');
    // ... and a later success has to take the banner away again, or one dropped
    // request would leave a permanent error on a screen that is working.
    expect(join).toMatch(/if \(joined\)[\s\S]{0,200}?setError\(null\)/);
    // The deadline is read back out of the signed token that is already stored,
    // which is why a pending join from before this change also shows it.
    expect(pairing).toMatch(/function storedExpiry\([\s\S]{0,400}?allowExpired: true/);
    expect(pairing).toMatch(/hasPendingWorkspaceJoin[\s\S]{0,400}?expiresAt: storedExpiry\(pending\)/);
    // Expiry is scheduled, not polled: the screen stops claiming to wait at the
    // moment the request dies, not at the next re-render.
    expect(join).toContain("setTimeout(() => setExpired(true), remaining)");
    expect(join).toContain('t("workspaceSecurity.joinExpires")');
    expect(join).toContain('t("workspaceSecurity.joinExpired")');
    // Comparing a fingerprint is only worth something when both sides are told
    // to compare it - the approving side always was, the waiting side was not.
    expect(join).toContain('t("workspaceSecurity.joinCompareFingerprint")');
    expect(mobile).toContain('t("workspaceSecurity.pairingVerifyLabel"');
    // Same deadline on the phone, or the desktop is honest and the phone is not.
    expect(mobile).toContain('t("workspaceSecurity.joinExpires")');
    expect(mobile).toContain('t("workspaceSecurity.joinExpired")');
  });

  it("source: workspace decommission + orphan recovery are wired behind a confirmation (Stilllegen P4)", () => {
    expect(page).toContain("decommissionWorkspace");
    expect(page).toContain('data-testid="workspace-decommission"');
    expect(page).toContain('t("workspaceSecurity.orphanRecovery"');
    // The decommission goes through the danger confirm, never silently.
    expect(page).toContain('kind: "danger"');
  });

  it("source: the lift-encryption action re-uploads plaintext and leaves .pvws for manual deletion (E8)", () => {
    // A distinct overview action next to the device-local disconnect.
    expect(page).toContain("liftWorkspaceEncryption");
    expect(page).toContain('data-testid="workspace-lift-encryption"');
    expect(page).toContain("workspaceSecurity.liftEncryption");
    // It tears down like decommission but reopens with a NEW plaintext
    // connection so EVERY local file is re-uploaded (enqueueAllLocalFiles);
    // the immutable .pvws objects stay and are removed by the user.
    const ctx = readFileSync(new URL("../../contexts/VaultContext.tsx", import.meta.url), "utf8");
    expect(ctx).toContain("const liftWorkspaceEncryption");
    expect(ctx).toContain("loadVault(path, true)");
  });

  it("source: every workspace flow reloads the vault for real, not through openVault (finding 2026-09-03, K8)", () => {
    // `openVault(path)` on the path a window already shows is a no-op since the
    // multi-window split (it only chooses WHICH vault the window shows). The
    // seven flows that ended in it left the security status stale until the
    // next app start. They go through `reloadVault` / `loadVault` now, and the
    // status event the keychain dispatches has a listener that reads it back.
    const ctx = readFileSync(new URL("../../contexts/VaultContext.tsx", import.meta.url), "utf8");
    expect(ctx).toContain("const reloadVault = async");
    expect(ctx).not.toContain("await openVault(state.vaultPath)");
    expect(ctx).not.toContain("await openVault(path)");
    expect(ctx).not.toContain("await openVault(vaultPath)");
    expect(ctx).toContain('window.addEventListener("plainva-workspace-security-changed"');
    // The sweep's progress lives above the settings (store + overlay), and the
    // wizard hands the draft over instead of discarding it on unmount.
    expect(ctx).toContain("workspaceActivationStore.start(");
    expect(ctx).toContain("workspaceActivationStore.finish()");
    const wizard = readFileSync(new URL("./WorkspaceSetupWizard.tsx", import.meta.url), "utf8");
    expect(wizard).toContain("handedOver.current = true");
    expect(wizard).toContain("if (prepared && !handedOver.current) discardPreparedPersonalWorkspace");
    const app = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
    expect(app).toContain("<WorkspaceActivationOverlay />");
  });

  it("source: tearing down a workspace reads the publication ids BEFORE it drops them (finding 2026-08-30)", () => {
    const ctx = readFileSync(new URL("../../contexts/VaultContext.tsx", import.meta.url), "utf8");
    // Both ways out of an encrypted workspace go through the ONE helper. They
    // used to carry five identical steps side by side, which is how the
    // publication slots came to be missing from both at once.
    expect(ctx).toContain("const tearDownWorkspace");
    const teardown = ctx.slice(ctx.indexOf("const tearDownWorkspace"));
    const decommission = teardown.slice(teardown.indexOf("const decommissionWorkspace"));
    expect(decommission).toContain("await tearDownWorkspace(path)");
    expect(decommission.slice(decommission.indexOf("const liftWorkspaceEncryption"))).toContain(
      "await tearDownWorkspace(path)"
    );

    // The ordering is the whole point: a publication's credential slot is named
    // after an id that lives ONLY in `workspace_publication`, and
    // `clearWorkspaceState()` drops that table. Reversed, the slot survives as
    // a publisher admin key nobody can find again — a keychain cannot be
    // enumerated.
    const body = teardown.slice(0, teardown.indexOf("const decommissionWorkspace"));
    const read = body.indexOf("listPublications()");
    const clear = body.indexOf("clearWorkspaceState()");
    const wipe = body.indexOf("clearPublicationRuntimes(");
    expect(read).toBeGreaterThan(-1);
    expect(read).toBeLessThan(clear);
    expect(wipe).toBeGreaterThan(clear);
  });

  it("source: the mobile screen wires master/detail areas and QR fingerprint approval", () => {
    expect(mobile).toContain('["overview", "devices", "team", "slices", "recovery"]');
    expect(mobile).toContain("inspectMobileWorkspacePairing");
    expect(mobile).toContain("approveMobileWorkspacePairing");
    expect(mobile).toContain("pairPreview.fingerprint");
    expect(mobile).toContain("runtime.policy.payload.groups.map");
    // Since Stufe C the phone derives a slice's published state from the
    // publications it holds, rather than reading a field off the slice.
    expect(mobile).toContain("publications.some((record) => record.sliceId === slice.sliceId)");
    // Since S38 (decision E8) the phone MANAGES shares instead of listing them
    // and pointing at the desktop: inviting a member, creating a group and a
    // folder slice, and changing a group's role all happen here.
    expect(mobile).not.toContain("workspaceSecurity.mobileManageOnDesktop");
    expect(mobile).toContain("inviteMobileWorkspaceMember");
    expect(mobile).toContain("createMobileWorkspaceGroup");
    expect(mobile).toContain("createMobileWorkspaceSlice");
    expect(mobile).toContain("assignMobileWorkspaceRole");
  });

  it("source: rekey, ownership transfer and decommission appear on the desktop only (E8 / C14)", () => {
    // The boundary is deliberate, so it is asserted from BOTH sides: the
    // desktop owns these three, and the phone must not grow them quietly.
    expect(page).toContain("transferOwner");
    // The full-rotation depth is a desktop surface one file over since P5.
    expect(panels).toContain("fullRekey");
    for (const call of ["startWorkspaceRekey", "transferWorkspaceOwnership"]) {
      expect(mobile, call).not.toContain(call);
    }
  });

  it("source: invitation and mobile pairing request both use the shared QR component (P6)", () => {
    // Desktop invitation modal shows the code AND a scannable QR of the same code.
    expect(page).toContain("QrImage");
    expect(page).toContain("<QrImage value={inviteCode}");
    expect(page).toContain("workspaceSecurity.inviteQrCaption");
    // Mobile: scan an invitation into the code field, and show the pairing
    // request as a QR the approver can scan. Both scans use the shared decoder
    // (native BarcodeDetector + jsQR fallback), so no native barcode plugin.
    // Mobile scans invitations LIVE (camera preview, no photo capture) via the
    // shared QrScanner; both scans decode frames through decodeQrFromVideo
    // (native BarcodeDetector + jsQR fallback for iOS).
    expect(mobile).toContain("QrScanner");
    expect(mobile).toContain('setScan("invite")');
    expect(mobile).toContain("workspaceSecurity.scanInvite");
    expect(mobile).toContain("<QrImage value={request.token}");
    // The scanner itself is shared since 2026-08-20 (the desktop join dialog
    // renders it too), so the live-camera contract is checked THERE. The
    // mobile file is now a thin wrapper — what it still owes is Capacitor's
    // permission prompt, without which Android hands out no stream.
    const mobileScanner = readFileSync(new URL("../../../../mobile/src/components/QrScanner.tsx", import.meta.url), "utf8");
    expect(mobileScanner).toContain("Camera.requestPermissions");
    const scanner = readFileSync(new URL("../../../../../packages/ui/src/components/QrScanner.tsx", import.meta.url), "utf8");
    expect(scanner).toContain("navigator.mediaDevices.getUserMedia");
    expect(scanner).toContain("decodeQrFromVideo");
    // And the desktop reaches it — the gap this closed was retyping a code
    // off a phone standing right there.
    const join = readFileSync(new URL("./WorkspaceJoinDialog.tsx", import.meta.url), "utf8");
    expect(join).toContain("<QrScanner");
    expect(join).toContain("workspaceSecurity.scanInvite");
    const scan = readFileSync(new URL("../../../../../packages/ui/src/lib/qrScan.ts", import.meta.url), "utf8");
    expect(scan).toContain('import jsQR from "jsqr"');
    expect(scan).toContain("BarcodeDetector");
  });

  it("source: the mobile join field takes an invitation code, not a raw member id", () => {
    // The join flow decodes the same PVINVITE1 code the desktop shows — the old
    // "type a member id" field (which surfaced an id no desktop screen exposes)
    // is gone.
    expect(mobile).toContain("decodeWorkspaceInvite");
    expect(mobile).toContain("inviteCode");
    expect(mobile).not.toContain("setMemberId");
    expect(mobile).not.toContain('t("workspaceSecurity.memberId"');
  });
  it("source: publishing is armed on the desktop, reviewable before it happens, and honest about the phone", () => {
    // The four core primitives have callers, and since S7 the surface around
    // them is live. What this pins is the shape of the wiring, because each of
    // these was a way to get it wrong:
    //
    //  - a publication can be created from the wizard, where the slice is being
    //    defined, AND from the slice row afterwards - one is the natural moment,
    //    the other is how a slice published later gets there;
    //  - nothing is signed before step 4 shows what would actually leave the
    //    vault, because "sanitized" is a promise the publisher has no way to
    //    check by reading a dropdown;
    //  - the phone says what it cannot do instead of implying it can.
    expect(page).toContain("createSlicePublication");
    expect(page).toContain("invitePublicationRecipient");
    expect(page).toContain("listPublicationRecipients");
    // The advice a publisher acts on comes from core, through the shared mapper —
    // two shells must not tell someone two different things about one folder.
    expect(page).toContain("publishedSliceProviderInstructions");
    expect(page).toContain("publicationInstructionText");
    // The code that lets a recipient in is core's, rendered — not a second encoder.
    expect(page).toMatch(/invitePublicationRecipient[\s\S]{0,600}?setPublicationInvite/);
    expect(page).toContain("<QrImage");
    // Still true, and still load-bearing: the directory nothing writes to is not
    // rendered. Comments may name the path; what must not survive is printing it.
    const pageCode = page.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(pageCode).not.toContain(".pvws/publications/");
    // The wizard arms the publication. Both halves of the P1 disarming fell
    // together on purpose (Stufe B, finding D): a banner promising "publish it
    // later" above three live dropdowns would be the worse of the two states.
    expect(page).toContain("const openSliceWizard = (): void => {");
    expect(dialog).not.toContain("workspaceSecurity.publicationPreviewOnly");
    expect(dialog).not.toContain("workspaceSecurity.publicationInWizardHint");
    expect(dialog).not.toContain("<Select disabled");
    // Access level and provider only exist for a publication - an internal slice
    // has neither, and showing three dropdowns where two are meaningless was the
    // disarmed shape, not the armed one.
    expect(dialog).toContain('form.publicationMode !== "private" &&');
    // The projection preview is asked for on the way OUT of the decision step and
    // rendered in the review step, never on every dropdown change: it reads every
    // covered note, and that cost is why it is a step rather than a live field.
    expect(dialog).toMatch(/sliceStep === 3 && form\.publicationMode !== "private"[\s\S]{0,80}?onPublicationPreview\(\)/);
    expect(dialog).toContain("workspaceSecurity.projectionSanitizedHint");
    expect(page).toContain("previewSlicePublication");
    // Built from the objects the membership preview already resolved - both halves
    // of the review page have to describe the same set of notes.
    expect(page).toMatch(/previewSlicePublication\(\{ objectIds: \(slicePreview \?\? \[\]\)/);
    const context = readFileSync(new URL("../../contexts/VaultContext.tsx", import.meta.url), "utf8");
    // Same three filters as the refresh planner, from one exported place, so the
    // preview cannot promise a note the publish path would skip.
    expect(context).toContain("publishableObjects");
    expect(context).toContain("previewPublishedProjection");
    // Stufe C closed the asymmetry: the phone creates, refreshes, states and
    // withdraws a publication itself, so neither the "read-only preview" wording
    // nor the "this runs on the desktop" wording is true any more - and the
    // catalog entry that named the gap is DELETED rather than set to "yes",
    // which is how a closed gap leaves this file.
    expect(mobile).not.toContain("workspaceSecurity.publicationPreviewOnly");
    expect(mobile).not.toContain("workspaceSecurity.publicationDesktopOnly");
    expect(mobile).toContain("createMobilePublication");
    expect(mobile).toContain("withdrawMobilePublication");
    const parity = readFileSync(new URL("../../../../../packages/ui/src/lib/featureParity.ts", import.meta.url), "utf8");
    expect(parity).not.toContain('id: "workspace-publication-create"');
  });
});
