import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { ChevronLeft, Copy, QrCode, RefreshCw, ShieldCheck } from "lucide-react";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { TextInput, toast } from "@plainva/ui";
import { useTranslation } from "react-i18next";
import type { MobileVault } from "../services/vaultService";
import { reloadActiveMobileVault } from "../services/vaultService";
import { getMobileRemoteWorkspaceInfo, getMobileWorkspaceObjectStore } from "../services/syncService";
import { activateMobileWorkspaceRecovery, beginMobileWorkspacePairing, completeMobileWorkspacePairing, getMobileWorkspaceStatus, lockMobileWorkspace, recoverMobileWorkspace, rotateMobileWorkspaceRecovery, type MobileWorkspaceStatus } from "../services/mobileWorkspaceSecurity";

type DetectorCtor = new (options: { formats: string[] }) => { detect(source: ImageBitmapSource): Promise<Array<{ rawValue: string }>> };

export function SecurityAreaScreen({ vault, onBack }: { vault: MobileVault; onBack: () => void }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<MobileWorkspaceStatus | null>(null);
  const [memberId, setMemberId] = useState("");
  const [deviceName, setDeviceName] = useState(() => navigator.platform || "Mobile");
  const [request, setRequest] = useState<{ token: string; shortCode: string; fingerprint: string } | null>(null);
  const [recoveryBytes, setRecoveryBytes] = useState<Uint8Array | null>(null);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [renewedRecoveryCode, setRenewedRecoveryCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [quarantine, setQuarantine] = useState<Array<{ quarantineId: string; artifactKind: string; reason: string; status: string }>>([]);

  const refresh = useCallback(async () => {
    setStatus(await getMobileWorkspaceStatus(vault.vaultId));
    setQuarantine(vault.workspaceState ? await vault.workspaceState.listQuarantine() : []);
  }, [vault.vaultId, vault.workspaceState]);
  useEffect(() => { void refresh(); }, [refresh]);

  const startPairing = async (token?: string) => {
    setBusy(true);
    try {
      if (token) { await navigator.clipboard.writeText(token); toast.info(t("workspaceSecurity.qrCopied", { defaultValue: "QR token copied" })); return; }
      const info = await getMobileRemoteWorkspaceInfo(vault.vaultId);
      if (!info) throw new Error(t("workspaceSecurity.noRemoteWorkspace", { defaultValue: "No encrypted workspace was found on this connection." }));
      if (!memberId.trim()) throw new Error(t("workspaceSecurity.memberIdRequired", { defaultValue: "Enter the member ID created by an administrator." }));
      const created = await beginMobileWorkspacePairing({ vaultId: vault.vaultId, store: await getMobileWorkspaceObjectStore(vault.vaultId), workspaceId: info.workspaceId, fingerprint: info.fingerprint, memberId: memberId.trim(), deviceName: deviceName.trim() });
      setRequest(created); await refresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  const complete = async () => {
    setBusy(true);
    try {
      const runtime = await completeMobileWorkspacePairing(vault.vaultId, await getMobileWorkspaceObjectStore(vault.vaultId));
      if (!runtime) { toast.info(t("workspaceSecurity.waitingApproval", { defaultValue: "Approval has not arrived yet." })); return; }
      toast.success(t("workspaceSecurity.paired", { defaultValue: "Device paired" }));
      await reloadActiveMobileVault();
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  const scanQr = async () => {
    setBusy(true);
    try {
      const Detector = (globalThis as typeof globalThis & { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
      if (!Detector) throw new Error(t("workspaceSecurity.qrUnsupported", { defaultValue: "QR recognition is unavailable on this device; use the manual code." }));
      const photo = await Camera.getPhoto({ resultType: CameraResultType.DataUrl, source: CameraSource.Camera, quality: 85 });
      const blob = await (await fetch(photo.dataUrl!)).blob();
      const image = await createImageBitmap(blob);
      const result = await new Detector({ formats: ["qr_code"] }).detect(image);
      const value = result[0]?.rawValue;
      if (!value) throw new Error(t("workspaceSecurity.qrNotFound", { defaultValue: "No QR code was recognized." }));
      await navigator.clipboard.writeText(value);
      toast.info(t("workspaceSecurity.qrCopied", { defaultValue: "Pairing token scanned and copied." }));
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  const chooseRecovery = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    setRecoveryBytes(new Uint8Array(await file.arrayBuffer()));
  };

  const recover = async () => {
    if (!recoveryBytes) return;
    setBusy(true);
    try {
      await recoverMobileWorkspace({ vaultId: vault.vaultId, store: await getMobileWorkspaceObjectStore(vault.vaultId), bytes: recoveryBytes, code: recoveryCode, deviceName });
      toast.success(t("workspaceSecurity.recovered", { defaultValue: "Workspace access restored" }));
      await reloadActiveMobileVault();
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  const renewRecovery = async () => {
    if (!recoveryBytes || !vault.workspaceRuntime) return;
    setBusy(true);
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
    finally { setBusy(false); }
  };

  const runtime = vault.workspaceRuntime;
  return <div className="m-page">
    <header className="m-header"><button aria-label="Back" className="m-iconbtn" onClick={onBack}><ChevronLeft size={20} /></button><h1>{t("settings.securitySharing")}</h1></header>
    <p className="m-sectionlabel">{t("workspaceSecurity.currentStatus")}</p>
    <div className="m-row m-row--static"><ShieldCheck className="m-accent" size={18} /><span>{status ? `${status.phase} · ${status.deviceName}` : t("workspaceSecurity.notConfigured")}</span></div>
    {runtime ? <>
      <p className="m-sectionlabel">{t("workspaceSecurity.devicesCard")}</p>
      {runtime.policy.payload.devices.map((device) => <div className="m-row m-row--static" key={device.deviceId}><span>{device.displayName}<small>{device.platform} · {device.state}</small></span></div>)}
      <p className="m-sectionlabel">{t("workspaceSecurity.teamsCard")}</p>
      <div className="m-row m-row--static"><span>{runtime.policy.payload.members.filter((member) => member.state === "active").length} {t("workspaceSecurity.members")} · {runtime.policy.payload.groups.length} {t("workspaceSecurity.groups")} · {runtime.policy.payload.slices.length} {t("workspaceSecurity.slices")}</span></div>
      <p className="m-sectionlabel">{t("workspaceSecurity.rotateRecovery", { defaultValue: "Renew recovery" })}</p>
      <label className="m-field"><span>{t("workspaceSecurity.recoveryFile", { defaultValue: "Current recovery file" })}</span><input accept=".pvrecovery" type="file" onChange={(event) => void chooseRecovery(event)} /></label>
      <label className="m-field"><span>{t("workspaceSecurity.recoveryCode")}</span><TextInput value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value)} /></label>
      <button className="m-row" disabled={busy || !recoveryBytes || !recoveryCode} onClick={() => void renewRecovery()}><ShieldCheck className="m-accent" size={18} /><span>{t("workspaceSecurity.renew", { defaultValue: "Renew" })}</span></button>
      {renewedRecoveryCode && <div className="m-row m-row--static"><span><strong>{renewedRecoveryCode}</strong><small>{t("workspaceSecurity.storeCodeSeparately", { defaultValue: "Store this new code separately from the renewed file." })}</small></span><button className="m-iconbtn" onClick={() => void navigator.clipboard.writeText(renewedRecoveryCode)}><Copy size={18} /></button></div>}
      <button className="m-row" disabled={busy} onClick={() => void lockMobileWorkspace(vault.vaultId).then(refresh)}><span>{t("workspaceSecurity.lock")}</span></button>
    </> : <>
      <p className="m-sectionlabel">{t("workspaceSecurity.pairDevice", { defaultValue: "Pair this device" })}</p>
      <label className="m-field"><span>{t("workspaceSecurity.memberId", { defaultValue: "Member ID" })}</span><TextInput value={memberId} onChange={(event) => setMemberId(event.target.value)} /></label>
      <label className="m-field"><span>{t("workspaceSecurity.deviceName")}</span><TextInput value={deviceName} onChange={(event) => setDeviceName(event.target.value)} /></label>
      <button className="m-row" disabled={busy} onClick={() => void startPairing()}><QrCode className="m-accent" size={18} /><span>{t("workspaceSecurity.createPairing", { defaultValue: "Create QR/manual request" })}</span></button>
      <button className="m-row" disabled={busy} onClick={() => void scanQr()}><QrCode className="m-accent" size={18} /><span>{t("workspaceSecurity.scanQr", { defaultValue: "Scan a pairing QR" })}</span></button>
      {request && <><div className="m-row m-row--static"><span><strong>{request.shortCode}</strong><small>{request.fingerprint}</small></span><button className="m-iconbtn" onClick={() => void navigator.clipboard.writeText(request.token)}><Copy size={18} /></button></div><button className="m-row" disabled={busy} onClick={() => void complete()}><RefreshCw className="m-accent" size={18} /><span>{t("workspaceSecurity.checkApproval", { defaultValue: "Check approval" })}</span></button></>}
      <p className="m-sectionlabel">{t("workspaceSecurity.restore", { defaultValue: "Recovery" })}</p>
      <label className="m-field"><span>{t("workspaceSecurity.recoveryFile", { defaultValue: "Recovery file" })}</span><input accept=".pvrecovery" type="file" onChange={(event) => void chooseRecovery(event)} /></label>
      <label className="m-field"><span>{t("workspaceSecurity.recoveryCode")}</span><TextInput value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value)} /></label>
      <button className="m-row" disabled={busy || !recoveryBytes || !recoveryCode} onClick={() => void recover()}><ShieldCheck className="m-accent" size={18} /><span>{t("workspaceSecurity.restore", { defaultValue: "Restore access" })}</span></button>
    </>}
    {quarantine.length > 0 && <><p className="m-sectionlabel">{t("workspaceSecurity.quarantine", { defaultValue: "Quarantine" })}</p>{quarantine.map((entry) => <div className="m-row m-row--static" key={entry.quarantineId}><span>{entry.artifactKind}<small>{entry.reason} · {entry.status}</small></span></div>)}</>}
  </div>;
}
