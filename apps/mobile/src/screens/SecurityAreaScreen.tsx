import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { Check, Cloud, Copy, QrCode, RefreshCw, ShieldCheck, ShieldOff, Smartphone, Upload } from "lucide-react";
import { QrScanner } from "../components/QrScanner";
import { PublishSliceSheet, type PublishSliceValues } from "../components/PublishSliceSheet";
import { PublicationRecipientsSheet } from "../components/PublicationRecipientsSheet";
import { WithdrawPublicationSheet } from "../components/WithdrawPublicationSheet";
import { FolderPickerSheet } from "../components/FolderPickerSheet";
import { QuarantineList } from "../components/QuarantineList";
import type { WorkspaceLocalForkRecord, WorkspaceQuarantineRecord } from "@plainva/core";
import { useLongPress } from "../lib/useLongPress";
import { Banner, Button, errorText, GroupCard, ICON, IconButton, publicationStatusText, QrImage, Row, RowList, SectionLabel, Segmented, SettingField, TextInput, toast } from "@plainva/ui";
import { decodeWorkspaceInvite, listBrokenWorkspaceSlices, loadWorkspaceSliceObjects, type PersonalWorkspaceRuntime, type PublicationRecipient, type WorkspaceObjectStore, type WorkspacePublicationRecord, type WorkspaceRole } from "@plainva/core";
import { useTranslation } from "react-i18next";
import type { MobileVault } from "../services/vaultService";
import { reloadActiveMobileVault } from "../services/vaultService";
import { getMobileRemoteWorkspaceInfo, getMobileWorkspaceObjectStore, getStoredProvider, quarantineSync, stopSyncAndDrain } from "../services/syncService";
import { activateMobileWorkspaceRecovery, approveMobileWorkspacePairing, assignMobileWorkspaceRole, createMobilePublication, mobilePublicationRecipients, invitePublicationRecipientFromMobile, revokePublicationRecipientFromMobile, createMobileWorkspaceGroup, createMobileWorkspaceSlice, listMobilePublications, mobilePublicationPendingCounts, withdrawMobilePublication, previewMobilePublication, previewMobileWorkspaceSlice, decommissionMobileWorkspace, refreshMobileWorkspaceSliceCounts, prepareMobileWorkspaceOwnerTransfer, activateMobileWorkspaceOwnerTransfer, revokeMobileWorkspaceDevice, revokeMobileWorkspaceMember, getMobileWorkspaceRekey, inviteMobileWorkspaceMember, beginMobileWorkspacePairing, completeMobileWorkspacePairing, getMobileWorkspaceStatus, updateMobileQuarantine, exportMobileQuarantineDiagnostics, inspectMobileWorkspacePairing, lockMobileWorkspace, recoverMobileWorkspace, rotateMobileWorkspaceRecovery, unlockMobileWorkspace, type MobileWorkspaceStatus } from "../services/mobileWorkspaceSecurity";
import { getActiveVaultEntry } from "../services/vaultRegistry";
import { AppBar } from "../components/AppBar";
import { useLeaveGuard } from "../hooks/useLeaveGuard";
import { mConfirm, mPrompt, mSelect } from "../services/mobileDialogs";

/** File chooser with an app-styled trigger (Punkt 16.8 / F5): the raw
 *  <input type=file> shows browser chrome in the OS language; the button here
 *  is app-language and shows the chosen filename. The OS picker dialog itself
 *  stays native (unavoidable for file selection). */
function FilePickButton({ chooseLabel, fileName, disabled, onPick }: {
  chooseLabel: string;
  fileName: string | null;
  disabled?: boolean;
  onPick: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return <>
    <Button variant="ghost" className="m-filepick" disabled={disabled} onClick={() => ref.current?.click()}>
      <Upload size={ICON.ui} /> {fileName ?? chooseLabel}
    </Button>
    <input ref={ref} accept=".pvrecovery" type="file" hidden onChange={onPick} />
  </>;
}

/**
 * What this vault's sync connection actually is — the screen must never claim
 * encryption that is not there (maintainer 2026-07-25). Mirrors the desktop's
 * `detectJoinableWorkspace` gate: a remote `.pvws/genesis.pvgen` makes a
 * connection an encrypted workspace, everything else is a plain cloud vault.
 */
const ROLE_OPTIONS: WorkspaceRole[] = ["Reader", "Commenter", "Contributor", "Editor", "Admin"];

type ConnectionState =
  | { kind: "checking" }
  /** No provider at all — encryption has no remote to protect. */
  | { kind: "local" }
  /** Cloud connected, remote carries NO workspace: encryption is possible. */
  | { kind: "plain" }
  /** Cloud connected and encrypted: this device can join. */
  | { kind: "encrypted"; workspaceId: string; fingerprint: string }
  /** Probe failed (offline / expired sign-in) — stay honest, offer a recheck. */
  | { kind: "unknown" };

export function SecurityAreaScreen({ vault, onBack, onConnectCloud, onSetupWorkspace }: {
  vault: MobileVault;
  onBack: () => void;
  onConnectCloud?: () => void;
  /** Opens the setup wizard, which is its own destination since S37. */
  onSetupWorkspace: () => void;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<MobileWorkspaceStatus | null>(null);
  const [inviteCode, setInviteCode] = useState("");
  const [deviceName, setDeviceName] = useState(() => navigator.platform || "Mobile");
  const [request, setRequest] = useState<{ token: string; shortCode: string; fingerprint: string; expiresAt: string } | null>(null);
  /* A pairing request dies at a fixed time; scheduled, not polled, so the screen
   * stops claiming to wait the moment the request is worthless (P5, B10). */
  const [requestExpired, setRequestExpired] = useState(false);
  const [recoveryBytes, setRecoveryBytes] = useState<Uint8Array | null>(null);
  const [recoveryFileName, setRecoveryFileName] = useState<string | null>(null);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [renewedRecoveryCode, setRenewedRecoveryCode] = useState<string | null>(null);
  // A single action runs at a time; the id drives a per-button spinner (F1) so
  // long pairing/recovery steps show progress instead of only a disabled state.
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const busy = busyAction !== null;
  const [quarantine, setQuarantine] = useState<WorkspaceQuarantineRecord[]>([]);
  const [localForks, setLocalForks] = useState<WorkspaceLocalForkRecord[]>([]);
  const [rekey, setRekey] = useState<{ phase: string; completed: number; total: number; lastError: string | null } | null>(null);
  const [area, setArea] = useState<"overview" | "devices" | "team" | "slices" | "recovery">("overview");

  // The recovery code is the single highest-stakes text the app ever asks for:
  // it is the only way back into a workspace whose devices are all gone. It is
  // typed here under a live navigation bar, and a tap on the bar clears the
  // overlay. The sibling wizard was promoted to its own destination for exactly
  // this reason; this screen was left behind (S45).
  useLeaveGuard(
    "security-area",
    !!(recoveryCode || inviteCode),
    t("mobile.leaveCredentials"),
  );
  const [pairPreview, setPairPreview] = useState<{ token: string; deviceName: string; platform: string; memberId: string; fingerprint: string; expiresAt: string } | null>(null);
  const [scan, setScan] = useState<"invite" | "approve" | null>(null);
  /* Managing shares from here (S38 / E8). Each form is one field plus a role,
     because that is what the operation needs — the desktop's wider dialogs
     exist for slice kinds this screen deliberately does not offer. */
  const [memberName, setMemberName] = useState("");
  const [memberRole, setMemberRole] = useState<WorkspaceRole>("Reader");
  const [groupName, setGroupName] = useState("");
  const [sliceName, setSliceName] = useState("");
  const [sliceFolder, setSliceFolder] = useState("");
  const [sliceFolderPick, setSliceFolderPick] = useState(false);
  const [slicePreview, setSlicePreview] = useState<{ objectId: string; path: string }[] | null>(null);
  /* The list comes from the state store, NOT from `policy.slices[].publication`
     (M3): that block is the claim somebody ticked, this is the publication that
     actually exists - own keys, own folder, own record. */
  const [publications, setPublications] = useState<WorkspacePublicationRecord[]>([]);
  const [publishFor, setPublishFor] = useState<{ sliceId: string; name: string } | null>(null);
  /* Derived, never stored (M5): how far a publication has drifted from its
     slice is a statement about the vault as it is right now, and a stored copy
     would go stale the moment somebody edits a covered note. */
  const [pending, setPending] = useState<Record<string, number>>({});
  const [withdrawFor, setWithdrawFor] = useState<WorkspacePublicationRecord | null>(null);
  const [recipientsFor, setRecipientsFor] = useState<
    { record: WorkspacePublicationRecord; recipients: PublicationRecipient[]; locked: boolean } | null
  >(null);
  const [recipientsBusy, setRecipientsBusy] = useState(false);
  /* Hold OR tap opens the same sheet: the row has nothing else to do, so a
     hold-only affordance would be a gesture nobody discovers. The sheet is
     what makes this safe, not the length of the press (SC3). */
  const withdrawPress = useLongPress<WorkspacePublicationRecord>((record) => setWithdrawFor(record));

  const [connection, setConnection] = useState<ConnectionState>({ kind: "checking" });

  /** The vault as a slice rule sees it — shared with the desktop so both count the same. */
  const sliceObjects = useCallback(
    async () => (vault.workspaceState ? loadWorkspaceSliceObjects(await vault.workspaceState.listObjects(), vault.db) : []),
    [vault.workspaceState, vault.db]
  );

  const refresh = useCallback(async () => {
    setStatus(await getMobileWorkspaceStatus(vault.vaultId));
    setQuarantine(vault.workspaceState ? await vault.workspaceState.listQuarantine() : []);
    setLocalForks(vault.workspaceState ? await vault.workspaceState.listLocalForks() : []);
    setRekey(await getMobileWorkspaceRekey(vault.workspaceState));
    const records = vault.workspaceState ? await listMobilePublications(vault.workspaceState) : [];
    setPublications(records);
    // Bring the object counts in line before anyone reads them (finding 2026-08-25).
    const store = await getMobileWorkspaceObjectStore(vault.vaultId);
    const rt = vault.workspaceRuntime;
    if (store && rt) await refreshMobileWorkspaceSliceCounts({ vaultId: vault.vaultId, store, runtime: rt, objects: await sliceObjects() }).catch(() => false);
    /* AFTER the materialization refresh, not before: coverage is read from the
       slice`s materialized ids, so a count taken first would describe the
       previous rule. */
    setPending(rt && vault.workspaceState && records.length > 0
      ? await mobilePublicationPendingCounts({ state: vault.workspaceState, runtime: rt })
      : {});
  }, [vault.vaultId, vault.workspaceState, vault.workspaceRuntime, sliceObjects]);
  useEffect(() => { void refresh(); }, [refresh]);
  /** One quarantine action at a time, with the spinner id and a refresh after (finding 2026-09-03). */
  const runQuarantine = async <T,>(id: string, action: () => Promise<T>): Promise<T | null> => {
    setBusyAction(id);
    try { return await action(); }
    catch (error) { toast.error(errorText(error)); return null; }
    finally { setBusyAction(null); await refresh(); }
  };
  // `mobileWorkspaceSecurity` dispatches this on every status write and said
  // "the screens listen for this" — nothing did (finding 2026-09-03, K8). The
  // route pop after the wizard covered activation; a lock, an unlock or a
  // failed sweep while this screen stays mounted did not.
  useEffect(() => {
    const onChanged = () => { void refresh(); };
    window.addEventListener("m-workspace-security-changed", onChanged);
    return () => window.removeEventListener("m-workspace-security-changed", onChanged);
  }, [refresh]);

  useEffect(() => {
    const deadline = request ? Date.parse(request.expiresAt) : Number.NaN;
    if (!Number.isFinite(deadline)) { setRequestExpired(false); return; }
    const remaining = deadline - Date.now();
    if (remaining <= 0) { setRequestExpired(true); return; }
    setRequestExpired(false);
    const timer = setTimeout(() => setRequestExpired(true), remaining);
    return () => clearTimeout(timer);
  }, [request]);

  /** One remote probe decides what this screen may claim. */
  const probeConnection = useCallback(async () => {
    setConnection({ kind: "checking" });
    const provider = await getStoredProvider(vault.vaultId);
    if (!provider) { setConnection({ kind: "local" }); return; }
    try {
      const info = await getMobileRemoteWorkspaceInfo(vault.vaultId);
      setConnection(info ? { kind: "encrypted", ...info } : { kind: "plain" });
    } catch {
      setConnection({ kind: "unknown" });
    }
  }, [vault.vaultId]);
  useEffect(() => { void probeConnection(); }, [probeConnection]);

  const startPairing = async () => {
    setBusyAction("pair");
    try {
      const info = await getMobileRemoteWorkspaceInfo(vault.vaultId);
      if (!info) throw new Error(t("workspaceSecurity.noRemoteWorkspace", { defaultValue: "No encrypted workspace was found on this connection." }));
      // Paste the invitation code an admin created on their device (Security &
      // Sharing → Members → Show invitation) — it carries the member id reserved
      // for this device, so nobody has to find/type a raw member id.
      let invite;
      try { invite = decodeWorkspaceInvite(inviteCode); }
      catch { throw new Error(t("workspaceSecurity.inviteInvalid", { defaultValue: "That is not a valid invitation code. Copy it from Security & Sharing on the inviting device." })); }
      if (invite.workspaceId !== info.workspaceId || invite.fingerprint !== info.fingerprint) {
        throw new Error(t("workspaceSecurity.inviteMismatch", { defaultValue: "This invitation is for a different workspace than the one synced here." }));
      }
      const created = await beginMobileWorkspacePairing({ vaultId: vault.vaultId, store: await getMobileWorkspaceObjectStore(vault.vaultId), workspaceId: info.workspaceId, fingerprint: info.fingerprint, memberId: invite.memberId, deviceName: deviceName.trim() });
      setRequest(created); await refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusyAction(null); }
  };

  const complete = async () => {
    setBusyAction("complete");
    try {
      const runtime = await completeMobileWorkspacePairing(vault.vaultId, await getMobileWorkspaceObjectStore(vault.vaultId));
      if (!runtime) { toast.info(t("workspaceSecurity.waitingApproval", { defaultValue: "Approval has not arrived yet." })); return; }
      toast.success(t("workspaceSecurity.paired", { defaultValue: "Device paired" }));
      await reloadActiveMobileVault();
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusyAction(null); }
  };

  const approveFromScan = async (value: string) => {
    setScan(null);
    setBusyAction("approveScan");
    try {
      if (!vault.workspaceRuntime) throw new Error(t("workspaceSecurity.unlockToApprove", { defaultValue: "Unlock an existing workspace device to approve this request." }));
      setPairPreview(await inspectMobileWorkspacePairing(await getMobileWorkspaceObjectStore(vault.vaultId), vault.workspaceRuntime, value));
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusyAction(null); }
  };

  const chooseRecovery = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    setRecoveryFileName(file.name);
    setRecoveryBytes(new Uint8Array(await file.arrayBuffer()));
  };

  const recover = async () => {
    if (!recoveryBytes) return;
    setBusyAction("recover");
    try {
      await recoverMobileWorkspace({ vaultId: vault.vaultId, store: await getMobileWorkspaceObjectStore(vault.vaultId), bytes: recoveryBytes, code: recoveryCode, deviceName });
      toast.success(t("workspaceSecurity.recovered", { defaultValue: "Workspace access restored" }));
      await reloadActiveMobileVault();
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusyAction(null); }
  };

  const renewRecovery = async () => {
    if (!recoveryBytes || !vault.workspaceRuntime) return;
    // S20: this used to run on the tap. Renewing INVALIDATES the recovery file
    // the user is holding — and if the share sheet is then dismissed, they are
    // left with no working recovery at all. The one question that exists to be
    // asked is asked before the old key stops working, not after.
    const ok = await mConfirm({
      title: t("workspaceSecurity.renewConfirmTitle", { defaultValue: "Wiederherstellung erneuern?" }),
      message: t("workspaceSecurity.renewConfirmBody", {
        defaultValue:
          "Die Datei und der Code, die Du jetzt hast, funktionieren danach nicht mehr. Speichere die neue Datei und den neuen Code, bevor Du die alten wegwirfst.",
      }),
      confirmLabel: t("workspaceSecurity.renew", { defaultValue: "Renew" }),
      danger: true,
    });
    if (!ok) return;
    setBusyAction("renew");
    try {
      const store = await getMobileWorkspaceObjectStore(vault.vaultId);
      const renewed = await rotateMobileWorkspaceRecovery({ store, runtime: vault.workspaceRuntime, bytes: recoveryBytes, code: recoveryCode });
      const file = new File([renewed.bytes.buffer as ArrayBuffer], "Plainva-Recovery-Renewed.pvrecovery", { type: "application/octet-stream" });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: "Plainva Recovery" });
      else {
        const url = URL.createObjectURL(file); const link = document.createElement("a"); link.href = url; link.download = file.name; link.click(); URL.revokeObjectURL(url);
      }
      await activateMobileWorkspaceRecovery({ store, runtime: vault.workspaceRuntime, activation: renewed.activation });
      setRenewedRecoveryCode(renewed.recoveryCode);
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusyAction(null); }
  };

  const approveScanned = async () => {
    if (!pairPreview || !vault.workspaceRuntime) return;
    setBusyAction("approve");
    try {
      await approveMobileWorkspacePairing(vault.vaultId, await getMobileWorkspaceObjectStore(vault.vaultId), vault.workspaceRuntime, pairPreview.token);
      setPairPreview(null);
      toast.success(t("workspaceSecurity.deviceApproved", { defaultValue: "Device approved" }));
      await reloadActiveMobileVault();
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusyAction(null); }
  };

  const unlock = async () => {
    setBusyAction("unlock");
    try {
      const unlocked = await unlockMobileWorkspace(vault.vaultId);
      if (!unlocked) throw new Error(t("workspaceSecurity.unlockFailed"));
      await reloadActiveMobileVault();
      await refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusyAction(null); }
  };

  const lock = async () => {
    setBusyAction("lock");
    try { await lockMobileWorkspace(vault.vaultId); await refresh(); }
    catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusyAction(null); }
  };

  /* One helper for all three: they differ only in which core call they make,
     and every one of them needs the same store + runtime + refresh. */
  const runGovernance = async (id: string, run: (store: WorkspaceObjectStore, rt: PersonalWorkspaceRuntime) => Promise<unknown>, done: string) => {
    const rt = vault.workspaceRuntime;
    if (!rt) return;
    setBusyAction(id);
    try {
      await run(await getMobileWorkspaceObjectStore(vault.vaultId), rt);
      toast.success(done);
      await refresh();
    } catch (error) {
      console.error("[SecurityAreaScreen] governance failed", error);
      toast.error(t("workspaceSecurity.setupFailed"));
    } finally { setBusyAction(null); }
  };

  const inviteMember = () => void runGovernance("invite", (store, rt) =>
    inviteMobileWorkspaceMember({ vaultId: vault.vaultId, store, runtime: rt, displayName: memberName.trim(), role: memberRole })
      .then(() => setMemberName("")), t("workspaceSecurity.memberInvited"));

  const addGroup = () => void runGovernance("group", (store, rt) =>
    createMobileWorkspaceGroup({ vaultId: vault.vaultId, store, runtime: rt, name: groupName.trim(), memberIds: [], role: "Reader" })
      .then(() => setGroupName("")), t("workspaceSecurity.groupCreated"));

  const addSlice = () => void runGovernance("slice", (store, rt) =>
    sliceObjects().then((objects) => createMobileWorkspaceSlice({ vaultId: vault.vaultId, store, runtime: rt, name: sliceName.trim(), folder: sliceFolder.trim(), objects }))
      .then(() => { setSliceName(""); setSliceFolder(""); setSlicePreview(null); }), t("workspaceSecurity.sliceCreated"));

  /* Two doors into the same sheet (SC2): from a slice row, and from the
     publications section. Only-at-creation would force deleting a slice to
     publish it later - and a deleted slice takes its access rules with it. */
  const startPublish = async (slice?: { sliceId: string; name: string }) => {
    if (slice) { setPublishFor(slice); return; }
    const rt = vault.workspaceRuntime;
    if (!rt) return;
    const open = rt.policy.payload.slices.filter(
      (entry) => !publications.some((record) => record.sliceId === entry.sliceId),
    );
    if (open.length === 0) { toast.error(t("workspaceSecurity.publishNoSlice", { defaultValue: "Every Vault Slice is already published." })); return; }
    // One candidate needs no question.
    if (open.length === 1) { setPublishFor({ sliceId: open[0].sliceId, name: open[0].name }); return; }
    const picked = await mSelect({
      title: t("workspaceSecurity.publishSlice", { defaultValue: "Publish a Vault Slice" }),
      options: open.map((entry) => ({ value: entry.sliceId, label: entry.name })),
      value: open[0].sliceId,
    });
    const chosen = open.find((entry) => entry.sliceId === picked);
    if (chosen) setPublishFor({ sliceId: chosen.sliceId, name: chosen.name });
  };

  /* What the published copy would contain, asked from inside the sheet (M4).
     The coverage comes from the slice's `materializedObjectIds` - the same list
     `isScopeMatch` authorises against - so the preview cannot describe a set the
     publication would not actually carry. */
  const previewPublish = async (mode: "exact" | "sanitized") => {
    const rt = vault.workspaceRuntime;
    const state = vault.workspaceState;
    if (!rt || !state || !publishFor) throw new Error("workspace unavailable");
    const slice = rt.policy.payload.slices.find((entry) => entry.sliceId === publishFor.sliceId);
    return previewMobilePublication({
      state,
      vault: vault.files,
      objectIds: slice?.materializedObjectIds ?? [],
      mode,
    });
  };

  /* Deliberately NOT through runGovernance: that helper swallows the failure
     into a toast, which would close the sheet and lose what was typed. The
     sheet promises the opposite - the error surfaces there and the values
     stay. So this rethrows and only clears on success. */
  const submitPublish = async (values: PublishSliceValues) => {
    const rt = vault.workspaceRuntime;
    const state = vault.workspaceState;
    if (!rt || !state || !publishFor) return;
    await createMobilePublication({
      vaultId: vault.vaultId,
      store: await getMobileWorkspaceObjectStore(vault.vaultId),
      runtime: rt,
      state,
      sliceId: publishFor.sliceId,
      name: values.name,
      mode: values.mode,
      access: values.access,
      provider: values.provider,
    });
    setPublishFor(null);
    toast.success(t("workspaceSecurity.publicationCreated"));
    // The desktop pokes the sync worker here; the phone has no handle on one,
    // so the refresh below supplies the same effect.
    await refresh();
  };

  /**
   * Withdraws a publication (M5) — the mobile half of the desktop`s
   * `removePublication`, on the same core teardown.
   *
   * A partial run is reported rather than swallowed: the service keeps the
   * manifest it reached, so the publication still exists here and the next
   * attempt finishes it. Saying "withdrawn" over a half-retracted folder would
   * be the one lie this screen cannot afford.
   */
  const withdrawPublication = async (record: WorkspacePublicationRecord) => {
    const rt = vault.workspaceRuntime;
    const state = vault.workspaceState;
    const store = await getMobileWorkspaceObjectStore(vault.vaultId);
    if (!rt || !state || !store) return;
    const result = await withdrawMobilePublication({
      vaultId: vault.vaultId,
      store,
      state,
      runtime: rt,
      publicationId: record.publicationId,
    });
    setWithdrawFor(null);
    if (result.error) toast.error(errorText(result.error));
    else toast.success(t("workspaceSecurity.publicationWithdrawn", { defaultValue: "Publication withdrawn" }));
    await refresh();
  };

  /**
   * Who may read this publication (M5).
   *
   * The list comes from the publication's own policy, so a device without its
   * key cannot answer the question at all — that is `locked`, not an error, and
   * the sheet says so rather than a toast that vanishes.
   */
  const openRecipients = async (record: WorkspacePublicationRecord) => {
    const view = await mobilePublicationRecipients(vault.vaultId, record.publicationId);
    setRecipientsFor({ record, ...view });
  };

  const inviteRecipient = async (record: WorkspacePublicationRecord, displayName: string) => {
    const rt = vault.workspaceRuntime;
    const state = vault.workspaceState;
    const store = await getMobileWorkspaceObjectStore(vault.vaultId);
    if (!rt || !state || !store) throw new Error("workspace-unavailable");
    setRecipientsBusy(true);
    try {
      const result = await invitePublicationRecipientFromMobile({
        vaultId: vault.vaultId,
        store,
        state,
        runtime: rt,
        publicationId: record.publicationId,
        displayName,
      });
      await openRecipients(record);
      toast.success(t("workspaceSecurity.publicationRecipientAdded", { defaultValue: "Recipient invited" }));
      return result;
    } finally {
      setRecipientsBusy(false);
    }
  };

  const revokeRecipient = async (record: WorkspacePublicationRecord, memberId: string) => {
    const rt = vault.workspaceRuntime;
    const state = vault.workspaceState;
    const store = await getMobileWorkspaceObjectStore(vault.vaultId);
    if (!rt || !state || !store) throw new Error("workspace-unavailable");
    setRecipientsBusy(true);
    try {
      await revokePublicationRecipientFromMobile({
        vaultId: vault.vaultId,
        store,
        state,
        runtime: rt,
        publicationId: record.publicationId,
        memberId,
        // Same wording as the desktop: the policy history should read the
        // same whichever shell wrote the entry.
        reason: "publication recipient withdrawn",
      });
      await openRecipients(record);
      toast.success(t("workspaceSecurity.recipientRevoked", { defaultValue: "Access withdrawn" }));
    } finally {
      setRecipientsBusy(false);
    }
  };

  /**
   * What the folder would hand out, asked before it is signed (P6).
   *
   * The same preview the desktop has had. It reads the local encrypted object
   * index, so it costs no network and can be asked as often as the folder is
   * corrected; every edit drops the answer, because a count that outlives the
   * rule it was computed for is worse than no count.
   */
  const previewSlice = () => {
    setBusyAction("slicePreview");
    void sliceObjects()
      .then((objects) => setSlicePreview(previewMobileWorkspaceSlice({ name: sliceName.trim(), folder: sliceFolder.trim(), objects })))
      .catch((error: unknown) => { console.error("[SecurityAreaScreen] slice preview failed", error); toast.error(t("workspaceSecurity.setupFailed")); })
      .finally(() => setBusyAction(null));
  };

  /**
   * Taking access away (S11, C14). Two questions, not one: "future only" ends
   * access to new keys now and is quick; "full rekey" also rewrites everything
   * already encrypted and is long. Neither can take back plaintext the other
   * side already downloaded — the question says that, because it is the part
   * people assume wrongly.
   *
   * The rewrite itself belongs to the worker, which RESUMES it after a restart.
   * That is why the screen only starts it and then reads the number: a phone
   * loses focus mid-job as a matter of course.
   */
  const revoke = async (subject: { kind: "device" | "member"; id: string; name: string }, mode: "future" | "full") => {
    const rt = vault.workspaceRuntime;
    if (!rt || !vault.workspaceState) return;
    const ok = await mConfirm({
      title: t(subject.kind === "device" ? "workspaceSecurity.revokeDevice" : "workspaceSecurity.revokeMember"),
      message: t(mode === "full" ? "workspaceSecurity.revokeFullQuestion" : "workspaceSecurity.revokeFutureQuestion"),
      confirmLabel: t(mode === "full" ? "workspaceSecurity.fullRekey" : "workspaceSecurity.futureOnly"),
      danger: true,
    });
    if (!ok) return;
    setBusyAction(`revoke:${subject.id}`);
    try {
      const store = await getMobileWorkspaceObjectStore(vault.vaultId);
      const common = { vaultId: vault.vaultId, store, runtime: rt, state: vault.workspaceState, reason: "Removed on mobile", mode };
      if (subject.kind === "device") await revokeMobileWorkspaceDevice({ ...common, deviceId: subject.id });
      else await revokeMobileWorkspaceMember({ ...common, memberId: subject.id });
      toast.success(t(subject.kind === "device" ? "workspaceSecurity.deviceRevoked" : "workspaceSecurity.memberRevoked"));
      await refresh();
    } catch (error) {
      console.error("[SecurityAreaScreen] revoke failed", error);
      toast.error(`${t("workspaceSecurity.setupFailed")} ${errorText(error)}`);
    } finally { setBusyAction(null); }
  };

  /**
   * Handing the workspace to someone else (S10, C14).
   *
   * Two phases on purpose, and the order is the whole safety: ownership and the
   * RECOVERY set move together, so the new owner has to be holding a working
   * recovery file and code BEFORE this device stops being owner. Otherwise a
   * workspace whose only owner later loses their devices can never be
   * recovered — by anyone.
   *
   * It therefore needs the CURRENT recovery file and code, which are the two
   * fields already on this screen for renewing. The question is asked before
   * anything is published, because after activation this device is an Admin and
   * cannot take the workspace back.
   */
  const transferOwnership = async (memberId: string, displayName: string) => {
    const rt = vault.workspaceRuntime;
    if (!rt || !recoveryBytes || !recoveryCode.trim()) {
      toast.error(t("workspaceSecurity.ownerTransferRequirements"));
      return;
    }
    const ok = await mConfirm({
      title: t("workspaceSecurity.transferOwner"),
      message: `${t("workspaceSecurity.ownerTransferWarning")} ${t("workspaceSecurity.ownerTransferTarget", { name: displayName })}`,
      confirmLabel: t("workspaceSecurity.transferOwner"),
      danger: true,
    });
    if (!ok) return;
    setBusyAction(`owner:${memberId}`);
    try {
      const store = await getMobileWorkspaceObjectStore(vault.vaultId);
      const prepared = await prepareMobileWorkspaceOwnerTransfer({ store, runtime: rt, targetMemberId: memberId, bytes: recoveryBytes, code: recoveryCode });
      // Get the replacement package out of the app BEFORE the switch. Same
      // share-then-activate order as renewing, for the same reason.
      const file = new File([prepared.bytes.buffer as ArrayBuffer], "Plainva-Recovery-New-Owner.pvrecovery", { type: "application/octet-stream" });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: "Plainva Recovery" });
      else {
        const url = URL.createObjectURL(file); const link = document.createElement("a"); link.href = url; link.download = file.name; link.click(); URL.revokeObjectURL(url);
      }
      await activateMobileWorkspaceOwnerTransfer({ vaultId: vault.vaultId, store, runtime: rt, activation: prepared.activation });
      setRenewedRecoveryCode(prepared.recoveryCode);
      toast.success(t("workspaceSecurity.ownerTransferDone"));
      await refresh();
    } catch (error) {
      console.error("[SecurityAreaScreen] owner transfer failed", error);
      toast.error(`${t("workspaceSecurity.setupFailed")} ${errorText(error)}`);
    } finally { setBusyAction(null); }
  };

  /**
   * Decommission (S9, C14). The desktop asks once; here the confirmation is
   * typing the vault's name. The phone is the device you tap on while walking,
   * this row sits two taps from "unlock", and the thing it removes — the device
   * key — is the one part that cannot be re-derived. A name has to be read off
   * the screen and typed, which a mis-tap cannot do.
   *
   * The sentence about the cloud copy stands IN the dialog rather than under
   * the row: it is the part that surprises people afterwards, and after the tap
   * it is too late to read it.
   */
  const decommission = async () => {
    const entry = await getActiveVaultEntry().catch(() => null);
    const name = entry?.name?.trim() || vault.vaultId;
    const answer = await mPrompt({
      title: t("workspaceSecurity.decommissionTitle"),
      // One paragraph on purpose: the dialog renders the message as a single
      // `<p>`, so a newline here would collapse and only look like a mistake in
      // the source. The ask is the last sentence, right above the field.
      message: `${t("workspaceSecurity.decommissionConfirm")} ${t("workspaceSecurity.decommissionTypeName", { name })}`,
      placeholder: name,
    });
    if (answer.cancelled || answer.value.trim() !== name) {
      if (!answer.cancelled) toast.error(t("workspaceSecurity.decommissionNameMismatch"));
      return;
    }
    setBusyAction("decommission");
    try {
      await decommissionMobileWorkspace({ vaultId: vault.vaultId, state: vault.workspaceState, stopSync: stopSyncAndDrain });
      toast.info(t("workspaceSecurity.decommissionDone"));
      await reloadActiveMobileVault();
    } catch (error) {
      console.error("[SecurityAreaScreen] workspace decommission failed", error);
      toast.error(`${t("workspaceSecurity.decommissionFailed")} ${errorText(error)}`);
    } finally { setBusyAction(null); }
  };

  const runtime = status?.phase === "locked" ? null : vault.workspaceRuntime;
  const brokenSlices = runtime ? listBrokenWorkspaceSlices(runtime.policy.payload) : [];
  /** Status row text for a device that has NOT joined a workspace. */
  const connectionLabel = () =>
    connection.kind === "checking" ? t("workspaceSecurity.stateChecking", { defaultValue: "Checking this connection …" })
      : connection.kind === "local" ? t("workspaceSecurity.stateLocalTitle", { defaultValue: "On this device only" })
        : connection.kind === "plain" ? t("workspaceSecurity.statePlainTitle", { defaultValue: "This connection is not encrypted" })
          : connection.kind === "unknown" ? t("workspaceSecurity.stateUnknownTitle", { defaultValue: "Encryption status unknown" })
            : t("workspaceSecurity.notConfigured");
  const ConnectionIcon = connection.kind === "local" ? Smartphone : connection.kind === "plain" ? ShieldOff : ShieldCheck;

  return <div className="m-page">
    <AppBar onBack={onBack} title={t("settings.sectionSecurity")} />
    <div className="m-settings">
      {/* Honesty gate (H6): the "experimental, not independently reviewed" caveat
          used to live only in the desktop What's-New text and the handbook — not
          on the screen where a device actually joins a workspace. */}
      <Banner kind="warning" rounded>{t("workspaceSecurity.experimentalNotice")}</Banner>
      {/* The state card below IS the status for a device that has not joined a
          plain/local vault — only the joined and joinable cases add this row.
          Unlocking belongs to the status, not to an area, so it sits with it and
          above the area switch (N3.2). */}
      {(status || connection.kind === "encrypted") && <>
        <SectionLabel>{t("workspaceSecurity.currentStatus")}</SectionLabel>
        <GroupCard>
          <RowList>
            {(status || connection.kind === "encrypted") && <Row
              icon={status ? <ShieldCheck className="m-accent" size={ICON.ui} /> : <ConnectionIcon size={ICON.ui} />}
              title={status ? `${status.phase} · ${status.deviceName}` : t("workspaceSecurity.notConfigured")}
            />}
            {status?.phase === "locked" && <Row
              disabled={busy}
              icon={busyAction === "unlock" ? <span className="m-actionspin" aria-hidden /> : <ShieldCheck className="m-accent" size={ICON.ui} />}
              onClick={() => void unlock()}
              title={t("workspaceSecurity.unlock")}
            />}
            {/* A running rewrite belongs to the status, not to an area: it keeps
                going while you are elsewhere, and it survives leaving the app.
                Shown only while there is one — "no active rekey" is not news. */}
            {rekey && rekey.phase !== "complete" && <Row
              icon={<RefreshCw className="m-accent" size={ICON.ui} />}
              subtitle={rekey.lastError ?? undefined}
              title={`${t("workspaceSecurity.rekey", { defaultValue: "Rekey" })} · ${rekey.completed}/${rekey.total}`}
            />}
          </RowList>
        </GroupCard>
      </>}
      {runtime && (
        <Segmented
          ariaLabel={t("settings.sectionSecurity")}
          className="m-security-tabs"
          options={(["overview", "devices", "team", "slices", "recovery"] as const).map((value) => ({
            value,
            label: t(`workspaceSecurity.mobile.${value}`, { defaultValue: value[0].toUpperCase() + value.slice(1) }),
          }))}
          value={area}
          onChange={(v) => setArea(v as typeof area)}
        />
      )}
      {runtime ? <>
        {(area === "overview" || area === "devices") && <>
        <SectionLabel end={runtime.policy.payload.devices.length}>{t("workspaceSecurity.devicesCard")}</SectionLabel>
        <GroupCard>
          <RowList>
            {runtime.policy.payload.devices.map((device) => <Row
              key={device.deviceId}
              subtitle={`${device.platform} · ${device.state}`}
              title={device.displayName}
              // The device you are holding is deliberately not removable here:
              // it would lock this phone out with only the recovery package left.
              end={device.state === "active" && device.deviceId !== runtime.device.publicIdentity.deviceId ? <span className="m-revoke">
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => void revoke({ kind: "device", id: device.deviceId, name: device.displayName }, "future")}>{t("workspaceSecurity.futureOnly")}</Button>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => void revoke({ kind: "device", id: device.deviceId, name: device.displayName }, "full")}><span className="m-danger">{t("workspaceSecurity.fullRekey")}</span></Button>
              </span> : undefined}
            />)}
            <Row
              disabled={busy}
              icon={<QrCode className="m-accent" size={ICON.ui} />}
              onClick={() => setScan("approve")}
              title={t("workspaceSecurity.scanQr", { defaultValue: "Scan and approve a device" })}
            />
          </RowList>
        </GroupCard>
        {pairPreview && <div className="m-security-approval">
          <GroupCard><RowList><Row subtitle={`${pairPreview.platform} · ${pairPreview.memberId}`} title={<strong>{pairPreview.deviceName}</strong>} /></RowList></GroupCard>
          <div className="m-codefield"><span className="m-codefield-label">{t("workspaceSecurity.pairingVerifyLabel", { defaultValue: "Confirm this matches the other device's screen" })}</span><code className="m-code">{pairPreview.fingerprint}</code></div>
          <GroupCard><RowList><Row
            disabled={busy}
            icon={busyAction === "approve" ? <span className="m-actionspin" aria-hidden /> : <ShieldCheck className="m-accent" size={ICON.ui} />}
            onClick={() => void approveScanned()}
            title={t("workspaceSecurity.approve", { defaultValue: "Approve after fingerprint check" })}
          /></RowList></GroupCard>
        </div>}
        </>}
        {(area === "overview" || area === "team" || area === "slices") && <>
        <SectionLabel>{t("workspaceSecurity.teamsCard")}</SectionLabel>
        <GroupCard>
          <RowList>
            <Row title={`${runtime.policy.payload.members.filter((member) => member.state === "active").length} ${t("workspaceSecurity.members")} · ${runtime.policy.payload.groups.length} ${t("workspaceSecurity.groups")} · ${runtime.policy.payload.slices.length} ${t("workspaceSecurity.slices")}`} />
            {area === "team" && runtime.policy.payload.members.map((member) => <Row
              key={member.memberId}
              subtitle={`${member.state} · ${member.memberId.slice(0, 12)}`}
              title={member.displayName}
              // Only an active member who is not already the owner can take it
              // over; the recovery fields below decide whether the action is
              // reachable at all, and the row says so rather than failing later.
              end={member.state === "active" && member.memberId !== runtime.ownerMemberId ? <span className="m-revoke">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy || !recoveryBytes || !recoveryCode.trim()}
                  onClick={() => void transferOwnership(member.memberId, member.displayName)}
                >{busyAction === `owner:${member.memberId}` ? <span className="m-actionspin" aria-hidden /> : null}{t("workspaceSecurity.transferOwner")}</Button>
                {member.memberId !== runtime.memberId && <>
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => void revoke({ kind: "member", id: member.memberId, name: member.displayName }, "future")}>{t("workspaceSecurity.futureOnly")}</Button>
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => void revoke({ kind: "member", id: member.memberId, name: member.displayName }, "full")}><span className="m-danger">{t("workspaceSecurity.fullRekey")}</span></Button>
                </>}
              </span> : undefined}
            />)}
          </RowList>
        </GroupCard>
        {area === "team" && <>
          {/* Inviting creates the member and its personal key group; the DEVICE
              is paired afterwards, which is what the toast says. */}
          <GroupCard><RowList>
            <SettingField label={t("workspaceSecurity.name")}><TextInput value={memberName} onChange={(event) => setMemberName(event.target.value)} /></SettingField>
            <SettingField label={t("workspaceSecurity.role")}><Segmented
                options={ROLE_OPTIONS.map((role) => ({ value: role, label: role }))}
                value={memberRole}
                onChange={(value) => setMemberRole(value as WorkspaceRole)}
              /></SettingField>
          </RowList></GroupCard>
          <Button variant="tonal" disabled={busy || !memberName.trim()} onClick={inviteMember}>
            {busyAction === "invite" ? <span className="m-actionspin" aria-hidden /> : null}{t("workspaceSecurity.invite")}
          </Button>
          <SectionLabel end={runtime.policy.payload.groups.length}>{t("workspaceSecurity.groups")}</SectionLabel>
          {/* A group's role is the one thing about it that changes over time, so
              it is editable in place rather than behind a dialog. The role shown
              is the workspace-wide assignment; a narrower scope stays desktop. */}
          <GroupCard><RowList>{runtime.policy.payload.groups.map((group) => {
            const current = runtime.policy.payload.assignments.find(
              (a) => a.subjectKind === "group" && a.subjectId === group.groupId && a.scopeKind === "workspace",
            )?.role;
            return <Row
              key={group.groupId}
              subtitle={`${group.memberIds?.length ?? 0} ${t("workspaceSecurity.members")}`}
              title={group.name}
              end={<Segmented
                options={ROLE_OPTIONS.map((role) => ({ value: role, label: role }))}
                value={current ?? "Reader"}
                onChange={(value) => void runGovernance("role", (store, rt) =>
                  assignMobileWorkspaceRole({ vaultId: vault.vaultId, store, runtime: rt, subjectKind: "group", subjectId: group.groupId, role: value as WorkspaceRole }),
                  t("workspaceSecurity.groupCreated"))}
              />}
            />;
          })}</RowList></GroupCard>
          {/* A new group starts empty: adding members to it needs a picker over
              the member list, and an empty group with a role is the shape people
              fill in afterwards on either device. */}
          <GroupCard><RowList>
            <SettingField label={t("workspaceSecurity.name")}><TextInput value={groupName} onChange={(event) => setGroupName(event.target.value)} /></SettingField>
          </RowList></GroupCard>
          <Button variant="tonal" disabled={busy || !groupName.trim()} onClick={addGroup}>
            {busyAction === "group" ? <span className="m-actionspin" aria-hidden /> : null}{t("workspaceSecurity.addGroup")}
          </Button>
        </>}
        {area === "slices" && <>
          {/* A slice whose definition cannot be read grants nothing (fail-closed, P3) — so it
              says so, instead of showing "0 objects" as if it were merely empty. */}
          <GroupCard><RowList>{runtime.policy.payload.slices.map((slice) => {
            const broken = brokenSlices.find((entry) => entry.sliceId === slice.sliceId);
            const published = publications.some((record) => record.sliceId === slice.sliceId);
            return <Row
                     key={slice.sliceId}
                     subtitle={broken ? t("workspaceSecurity.sliceBroken") : `${slice.kind} · ${slice.materializedObjectIds.length}`}
                     title={slice.name}
                     end={broken || published ? undefined : <IconButton
                                                              label={t("workspaceSecurity.publishSlice", { defaultValue: "Publish a Vault Slice" })}
                                                              onClick={() => void startPublish({ sliceId: slice.sliceId, name: slice.name })}
                                                            ><Upload size={ICON.ui} /></IconButton>}
                   />;
          })}</RowList></GroupCard>
          {/* Folder slices only here (S38): a selection slice needs a multi-select
              over objects and a dynamic one the query builder — neither surface
              exists on the phone, and a half-built one would be worse than the
              desktop link this replaces. */}
          <GroupCard><RowList>
            <SettingField label={t("workspaceSecurity.name")}><TextInput value={sliceName} onChange={(event) => { setSliceName(event.target.value); setSlicePreview(null); }} /></SettingField>
            <SettingField label={t("database.folder")}>
              <TextInput value={sliceFolder} aria-label={t("database.folder")} onChange={(event) => { setSliceFolder(event.target.value); setSlicePreview(null); }} />
              {/* Picked from the vault, not typed (finding 2026-09-03) - the
                  same sheet "Move to…" uses; the field stays for who types. */}
              <Button variant="ghost" onClick={() => setSliceFolderPick(true)}>{t("settings.browseFolders")}</Button>
            </SettingField>
          </RowList></GroupCard>
          <Banner kind="info" rounded>{t("workspaceSecurity.slicePreview")}</Banner>
          {slicePreview && (
            <GroupCard><RowList>
              <Row title={t("workspaceSecurity.previewCount", { count: slicePreview.length })} />
              {slicePreview.slice(0, 20).map((entry) => <Row key={entry.objectId} title={entry.path} />)}
            </RowList></GroupCard>
          )}
          <Button variant="ghost" disabled={busy || !sliceFolder.trim()} onClick={previewSlice}>
            {busyAction === "slicePreview" ? <span className="m-actionspin" aria-hidden /> : null}{t("workspaceSecurity.preview")}
          </Button>
          <Button variant="tonal" disabled={busy || !sliceName.trim() || !sliceFolder.trim()} onClick={addSlice}>
            {busyAction === "slice" ? <span className="m-actionspin" aria-hidden /> : null}{t("workspaceSecurity.addSlice")}
          </Button>
          <SectionLabel end={publications.length || undefined}>{t("workspaceSecurity.publications")}</SectionLabel>
          {/* Publishing happens here now (M3). The list is the state store's,
              not `policy.slices[].publication`: that block is what somebody
              asked for, and a screen built on it lists a publication the moment
              the box was ticked - including where the workspace behind it was
              never created. */}
          {/* The state belongs in the ROW, not behind a tap (M5): how many
              objects it carries and whether the last refresh got through. A
              publication you cannot see is one you do not trust. The status
              string is the desktop`s, shared - a second copy is how two
              shells come to describe the same folder differently. */}
          {publications.length > 0 && <GroupCard><RowList>{publications.map((record) => <Row
                                                                                          key={record.publicationId}
                                                                                          subtitle={[
                                                                                            t(`workspaceSecurity.publicationModeName.${record.config.mode}`, { defaultValue: record.config.mode }),
                                                                                            t(`workspaceSecurity.publicationAccessName.${record.config.access}`, { defaultValue: record.config.access }),
                                                                                            t("workspaceSecurity.publicationObjects", { count: record.manifest.objects.length }),
                                                                                            publicationStatusText({ lastError: record.lastError, pending: pending[record.publicationId] ?? 0 }, t),
                                                                                          ].join(" · ")}
                                                                                          title={record.config.name}
                                                                                          onClick={() => { if (withdrawPress.clicked()) void openRecipients(record).catch((e: unknown) => toast.error(errorText(e))); }}
                                                                                          onPointerCancel={withdrawPress.clear}
                                                                                          onPointerDown={() => withdrawPress.start(record)}
                                                                                          onPointerLeave={withdrawPress.clear}
                                                                                          onPointerUp={withdrawPress.clear}
                                                                                        />)}</RowList></GroupCard>}
          <p className="m-hint">{t("workspaceSecurity.publicationChoiceHint")}</p>
          <Button variant="tonal" disabled={busy || runtime.policy.payload.slices.length === 0} onClick={() => void startPublish()}>
            {t("workspaceSecurity.publishSlice", { defaultValue: "Publish a Vault Slice" })}
          </Button>
        </>}
        </>}
        {(area === "overview" || area === "recovery") && <>
        <SectionLabel>{t("workspaceSecurity.rotateRecovery", { defaultValue: "Renew recovery" })}</SectionLabel>
        <GroupCard><RowList>
          <SettingField label={t("workspaceSecurity.recoveryFile", { defaultValue: "Current recovery file" })}><FilePickButton chooseLabel={t("workspaceSecurity.chooseFile", { defaultValue: "Choose file" })} fileName={recoveryFileName} disabled={busy} onPick={(event) => void chooseRecovery(event)} /></SettingField>
          <SettingField label={t("workspaceSecurity.recoveryCode")}><TextInput value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value)} /></SettingField>
        </RowList></GroupCard>
        <GroupCard>
          <RowList>
            <Row
              disabled={busy || !recoveryBytes || !recoveryCode}
              icon={busyAction === "renew" ? <span className="m-actionspin" aria-hidden /> : <ShieldCheck className="m-accent" size={ICON.ui} />}
              onClick={() => void renewRecovery()}
              title={t("workspaceSecurity.renew", { defaultValue: "Renew" })}
            />
            {renewedRecoveryCode && <Row
              end={<IconButton
                label={t("common.copy", { defaultValue: "Copy" })}
                onClick={() => void navigator.clipboard.writeText(renewedRecoveryCode)}
              ><Copy size={ICON.ui} /></IconButton>}
              subtitle={t("workspaceSecurity.storeCodeSeparately", { defaultValue: "Store this new code separately from the renewed file." })}
              title={<strong>{renewedRecoveryCode}</strong>}
            />}
            <Row
              disabled={busy}
              icon={busyAction === "lock" ? <span className="m-actionspin" aria-hidden /> : <ShieldCheck className="m-accent" size={ICON.ui} />}
              onClick={() => void lock()}
              title={t("workspaceSecurity.lock")}
            />
          </RowList>
        </GroupCard>
        </>}
        {area === "overview" && <>
        {/* The one destructive action on this screen stands alone at the end,
            under its own heading — not as a fourth row among "renew" and "lock",
            which are the two things people come here to do. */}
        <SectionLabel className="m-danger">{t("mobile.vaultGroupDanger")}</SectionLabel>
        <GroupCard tone="danger">
          <RowList>
            <Row
              disabled={busy}
              icon={busyAction === "decommission" ? <span className="m-actionspin" aria-hidden /> : <ShieldOff className="m-danger" size={ICON.ui} />}
              onClick={() => void decommission()}
              title={<span className="m-danger">{t("workspaceSecurity.decommission")}</span>}
            />
          </RowList>
        </GroupCard>
        </>}
      </> : status?.phase === "locked" ? null : connection.kind === "encrypted" ? <>
        {/* On-ramp (F2, Punkt 12): make the "connect → join here" order obvious,
            and state that creating a new workspace is a desktop action (E4).
            Only reachable once the remote probe FOUND an encrypted workspace —
            otherwise the branch below explains the real state instead. */}
        <div className="m-onramp">
          <div className="m-onramp-status">
            <ShieldCheck size={ICON.head} style={{ flexShrink: 0 }} />
            <div><p>{t("workspaceSecurity.onRampTitle", { defaultValue: "This vault is end-to-end encrypted" })}</p><p className="m-onramp-sub">{t("workspaceSecurity.onRampBody", { defaultValue: "Your notes stay locked on this device until it joins the workspace." })}</p></div>
          </div>
          <ol className="m-onramp-steps">
            <li className="done"><span className="m-step-num"><Check size={ICON.meta} /></span><div><p>{t("workspaceSecurity.onRampStep1", { defaultValue: "Cloud connected" })}</p></div></li>
            <li className="now"><span className="m-step-num">2</span><div><p>{t("workspaceSecurity.onRampStep2", { defaultValue: "Join this workspace" })}</p><p className="m-step-sub">{t("workspaceSecurity.onRampStep2Body", { defaultValue: "Pair with a device that is already in, or restore from your recovery file." })}</p></div></li>
          </ol>
        </div>

        <SectionLabel>{t("workspaceSecurity.joinTitle", { defaultValue: "Join this workspace" })}</SectionLabel>
        <p className="m-hint">{t("workspaceSecurity.joinHelp", { defaultValue: "On the inviting device open Security & Sharing, go to the team's members, choose \"Show invitation\" and copy the code. Paste it here." })}</p>
        {/* Opening a publication is the same door (Stufe B, S7).

            A publication is a workspace of its own - own genesis, own keys, own
            folder - so a recipient joins it with the code below and nothing
            else. The mechanism was already here; what was missing is that this
            screen only described joining a TEAM, and a recipient who was handed
            a code for one shared folder had no reason to believe it belonged in
            this field. The phone is the likelier place to be a recipient, so it
            is the place that has to say it. Creating one happens under Vault
            Slices on this same screen (M3). */}
        <p className="m-hint">{t("workspaceSecurity.joinPublicationHint", { defaultValue: "A code for a shared publication works here too: connect this vault to the folder you were given, then paste the code. You only see what was published - not the rest of that vault." })}</p>
        <GroupCard><RowList>
          <SettingField label={t("workspaceSecurity.inviteCode", { defaultValue: "Invitation code" })}><TextInput value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} /></SettingField>
          <SettingField label={t("workspaceSecurity.deviceName")}><TextInput value={deviceName} onChange={(event) => setDeviceName(event.target.value)} /></SettingField>
        </RowList></GroupCard>
        {/* Both actions read the two fields above, so they stand together under
            them rather than one between the fields they belong to. */}
        <GroupCard>
          <RowList>
            <Row
              disabled={busy}
              icon={<QrCode className="m-accent" size={ICON.ui} />}
              onClick={() => setScan("invite")}
              title={t("workspaceSecurity.scanInvite", { defaultValue: "Scan invitation" })}
            />
            <Row
              disabled={busy || !inviteCode.trim()}
              icon={busyAction === "pair" ? <span className="m-actionspin" aria-hidden /> : <QrCode className="m-accent" size={ICON.ui} />}
              onClick={() => void startPairing()}
              title={t("workspaceSecurity.requestJoin", { defaultValue: "Request to join" })}
            />
          </RowList>
        </GroupCard>

        {request && <div className="m-pairing">
          <div className="m-pairing-qr">
            <QrImage value={request.token} size={232} label={t("workspaceSecurity.pairingQrCaption", { defaultValue: "Pairing request code" })} />
            <p className="m-onramp-sub">{t("workspaceSecurity.pairingScanCaption", { defaultValue: "On a device that is already in, open Security & Sharing and scan this to approve." })}</p>
          </div>
          <div className="m-codefield">
            <span className="m-codefield-label">{t("workspaceSecurity.pairingCodeLabel", { defaultValue: "Pairing code" })}</span>
            <div className="m-codefield-row">
              <code className="m-code">{request.shortCode}</code>
              <IconButton
                label={t("common.copy", { defaultValue: "Copy" })}
                onClick={() => void navigator.clipboard.writeText(request.shortCode)}
              ><Copy size={ICON.head} /></IconButton>
            </div>
          </div>
          <p className="m-hint">{t("workspaceSecurity.pairingShareExplain", { defaultValue: "Send this code to the approver. Once they confirm it, this device joins and unlocks." })}</p>
          <div className="m-codefield"><span className="m-codefield-label">{t("workspaceSecurity.joinExpires")}</span><code className="m-code">{new Date(request.expiresAt).toLocaleString()}</code></div>
          {requestExpired && <Banner kind="warning" rounded>{t("workspaceSecurity.joinExpired")}</Banner>}
          <div className="m-codefield"><span className="m-codefield-label">{t("workspaceSecurity.pairingVerifyLabel", { defaultValue: "Confirm this matches the other device's screen" })}</span><code className="m-code">{request.fingerprint}</code></div>
          <GroupCard><RowList><Row
            disabled={busy}
            icon={busyAction === "complete" ? <span className="m-actionspin" aria-hidden /> : <RefreshCw className="m-accent" size={ICON.ui} />}
            onClick={() => void complete()}
            title={t("workspaceSecurity.checkApproval", { defaultValue: "Check approval" })}
          /></RowList></GroupCard>
        </div>}

        <SectionLabel>{t("workspaceSecurity.restore", { defaultValue: "Recovery" })}</SectionLabel>
        <GroupCard><RowList>
          <SettingField label={t("workspaceSecurity.recoveryFile", { defaultValue: "Recovery file" })}><FilePickButton chooseLabel={t("workspaceSecurity.chooseFile", { defaultValue: "Choose file" })} fileName={recoveryFileName} disabled={busy} onPick={(event) => void chooseRecovery(event)} /></SettingField>
          <SettingField label={t("workspaceSecurity.recoveryCode")}><TextInput value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value)} /></SettingField>
        </RowList></GroupCard>
        <GroupCard><RowList><Row
          disabled={busy || !recoveryBytes || !recoveryCode}
          icon={busyAction === "recover" ? <span className="m-actionspin" aria-hidden /> : <ShieldCheck className="m-accent" size={ICON.ui} />}
          onClick={() => void recover()}
          title={t("workspaceSecurity.restore", { defaultValue: "Restore access" })}
        /></RowList></GroupCard>
      </> : <>
        {/* No encrypted workspace on this vault: say what IS true and what is
            possible — never the on-ramp's "this vault is end-to-end encrypted"
            (maintainer 2026-07-25). Joining/recovery need a remote workspace, so
            both forms stay hidden here; the recheck picks up a workspace that
            was just created elsewhere. A plain cloud connection can be encrypted
            from here since 2026-07-25 (setup used to be desktop-only); since S37
            the setup itself is its own destination rather than a state of this
            screen — a wizard holding an in-memory key must not sit under a bar
            that discards it on a tap. */}
        <div className="m-onramp">
          <div className="m-onramp-status m-onramp-status--neutral">
            <ConnectionIcon size={ICON.head} style={{ flexShrink: 0 }} />
            <div>
              <p>{connectionLabel()}</p>
              <p className="m-onramp-sub">{
                connection.kind === "local" ? t("workspaceSecurity.stateLocalBody", { defaultValue: "Encryption protects notes on their way into the cloud. This vault has no cloud connection, so there is nothing to encrypt — the notes stay in the app's private storage on this device." })
                  : connection.kind === "plain" ? t("workspaceSecurity.statePlainBody", { defaultValue: "Your notes sync to the cloud as ordinary Markdown files. Encryption is possible for this connection." })
                    : connection.kind === "unknown" ? t("workspaceSecurity.stateUnknownBody", { defaultValue: "Could not check this connection (offline, or the sign-in expired). The encryption status stays unknown until the next check." })
                      : t("workspaceSecurity.stateCheckingBody", { defaultValue: "Looking for an encrypted workspace on this cloud connection." })
              }</p>
            </div>
          </div>
          {connection.kind === "plain" && <Button
                                            variant="primary"
                                            className="m-onramp-action"
                                            disabled={busy}
                                            onClick={onSetupWorkspace}
                                          ><ShieldCheck size={ICON.ui} /> {t("workspaceSecurity.setup")}</Button>}
          {connection.kind === "local" && onConnectCloud && <Button
                                                              variant="primary"
                                                              className="m-onramp-action"
                                                              onClick={onConnectCloud}
                                                            ><Cloud size={ICON.ui} /> {t("mobile.vaultAdd")}</Button>}
          {(connection.kind === "plain" || connection.kind === "unknown") && <Button
                                                                               variant="ghost"
                                                                               className="m-onramp-action"
                                                                               onClick={() => void probeConnection()}
                                                                             ><RefreshCw size={ICON.ui} /> {t("workspaceSecurity.recheck", { defaultValue: "Check again" })}</Button>}
        </div>
      </>}
      {/* Groups with actions, the desktop card's twin (finding 2026-09-03);
          this used to be a read-only list of English sentences. */}
      <QuarantineList
        quarantine={quarantine}
        localForks={localForks}
        busy={busy}
        onRetry={(ids) => runQuarantine("quarantineRetry", () => updateMobileQuarantine(vault, quarantineSync(), ids, "retry"))}
        onIgnore={async (ids) => { await runQuarantine("quarantineIgnore", () => updateMobileQuarantine(vault, quarantineSync(), ids, "ignore")); }}
        onRepaired={async (ids) => { await runQuarantine("quarantineRepaired", () => updateMobileQuarantine(vault, quarantineSync(), ids, "repaired")); }}
        onExportDiagnostics={(ids) => exportMobileQuarantineDiagnostics(vault, quarantineSync(), ids)}
      />
      {publishFor && <PublishSliceSheet
                       sliceName={publishFor.name}
                       onClose={() => setPublishFor(null)}
                       onPreview={previewPublish}
                       onSubmit={submitPublish}
                     />}
      {recipientsFor && <PublicationRecipientsSheet
                          busy={recipientsBusy}
                          locked={recipientsFor.locked}
                          record={recipientsFor.record}
                          recipients={recipientsFor.recipients}
                          onClose={() => setRecipientsFor(null)}
                          onInvite={(displayName) => inviteRecipient(recipientsFor.record, displayName)}
                          onRevoke={(memberId) => revokeRecipient(recipientsFor.record, memberId)}
                        />}
      {withdrawFor && <WithdrawPublicationSheet
                        record={withdrawFor}
                        onClose={() => setWithdrawFor(null)}
                        onWithdraw={() => withdrawPublication(withdrawFor)}
                      />}
      {sliceFolderPick && <FolderPickerSheet vault={vault} title={t("settings.browseFolders")} onPick={(path) => { setSliceFolder(path); setSlicePreview(null); setSliceFolderPick(false); }} onClose={() => setSliceFolderPick(false)} />}
      {scan === "invite" && <QrScanner onDecode={(value) => { setInviteCode(value); setScan(null); }} onClose={() => setScan(null)} />}
      {scan === "approve" && <QrScanner onDecode={(value) => void approveFromScan(value)} onClose={() => setScan(null)} />}
    </div>
  </div>;
}
