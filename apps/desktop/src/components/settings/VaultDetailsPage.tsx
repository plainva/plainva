import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { Button, SettingCard, SettingRow, SettingsPageHead, toast, vaultExportFileName, ZIP_EXCLUDED_DIR_NAMES } from "@plainva/ui";
import { appConfirm, appPrompt } from "../../services/appDialogs";
import { forgetVaultEverywhere } from "../../services/vaultForget";
import { renameVault, useVaultLabels, vaultFolderLabel } from "../../services/vaultNames";
import { isHeld, subscribeVaultRuntimes } from "../../services/vaultRuntimes";

/**
 * The vault itself (Sammelplan § 3.169 Nr. 3, the phone's `VaultDetailScreen`):
 * its name and where it lives, using it, renaming it, exporting it, the way to
 * its sync, and at the end deleting it.
 *
 * The phone had this page and the desktop did not — the rail named the vault
 * and offered to switch, nothing more. Reached from the vault's card in the
 * rail and from the settings search (`vaultDetails`, the page the phone's
 * search already knew). One product, two shells, the same four actions:
 *
 *  - Rename gives the vault a name of its own on this device
 *    (`services/vaultNames.ts`) — as on the phone, where it is a label of the
 *    vault list; the folder keeps its name.
 *  - Export writes the same ZIP the phone shares (the vault minus
 *    `ZIP_EXCLUDED_DIR_NAMES`, named by `vaultExportFileName`) to a file the
 *    person picks — the desktop's native zipper, the phone's share sheet.
 *  - Delete is the phone's for a folder it does not own: Plainva lets go of
 *    the vault — index, settings, window layout, credentials — and the folder
 *    with the notes stays where it is. The question says so in the phone's
 *    words. It is the start screen's "forget this vault"
 *    (`forgetVaultEverywhere`), not a second implementation of it.
 */
export interface VaultDetailsPageProps {
  vaultPath: string;
  /** The vault is the one open in this window. */
  isActiveVault: boolean;
  /** A file sync is configured for it: the sync page is one row away. */
  hasSync: boolean;
  onOpenSync: () => void;
  /** Opens this vault in the window ("Use this vault"). */
  onUse: () => void;
  /** Closes the vault in this window, before it is forgotten. */
  onCloseActive: () => void;
  removeRecentVault: (vaultPath: string) => Promise<void>;
  /** The vault is gone from Plainva: the settings show another one. */
  onDeleted: (vaultPath: string) => void;
}

/** Waits until no window holds the vault any more (or gives up after `ms`). */
function released(vaultPath: string, ms: number): Promise<void> {
  if (!isHeld(vaultPath)) return Promise.resolve();
  return new Promise((resolve) => {
    let stop = () => {};
    const timer = setTimeout(() => { stop(); resolve(); }, ms);
    stop = subscribeVaultRuntimes(() => {
      if (isHeld(vaultPath)) return;
      clearTimeout(timer);
      stop();
      resolve();
    });
  });
}

export const VaultDetailsPage: React.FC<VaultDetailsPageProps> = (p) => {
  const { t } = useTranslation();
  const label = useVaultLabels([p.vaultPath]);
  const name = label(p.vaultPath);
  const folder = vaultFolderLabel(p.vaultPath);
  const [busy, setBusy] = useState(false);

  const rename = async () => {
    const next = await appPrompt({
      title: t("mobile.vaultRename"),
      message: t("mobile.vaultRenamePrompt"),
      initial: name,
      placeholder: folder,
    });
    if (next === null) return;
    await renameVault(p.vaultPath, next).catch((e) => toast.error(String(e)));
  };

  const exportZip = async () => {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const dest = await save({
      title: t("mobile.vaultExport"),
      defaultPath: vaultExportFileName(name),
      filters: [{ name: "ZIP", extensions: ["zip"] }],
    });
    if (!dest) return;
    setBusy(true);
    try {
      const result = await invoke<{ zip_path: string; skipped: string[] }>("create_vault_zip", {
        vaultPath: p.vaultPath,
        destPath: dest,
        excludeDirNames: ZIP_EXCLUDED_DIR_NAMES,
      });
      if (result.skipped.length > 0) throw new Error(result.skipped.join(", "));
      toast.success(t("settings.vaultExportDone", { path: result.zip_path }));
    } catch (e) {
      console.error("[VaultDetails] export failed", e);
      toast.warning(t("mobile.vaultExportFailed"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const ok = await appConfirm({
      title: t("mobile.vaultDelete"),
      // A folder Plainva does not own: the connection goes, the files stay —
      // said in the phone's words for exactly that case.
      message: t("mobile.vaultExternalRemoveConfirm", { name, label: p.vaultPath }),
      kind: "danger",
      confirmLabel: t("common.delete"),
    });
    if (!ok) return;
    setBusy(true);
    try {
      // The index of an open vault cannot be deleted under it: this window
      // lets it go first, as the phone switches away before it deletes.
      if (p.isActiveVault) {
        p.onCloseActive();
        await released(p.vaultPath, 5000);
      }
      const result = await forgetVaultEverywhere(p.vaultPath, { deleteZipBackups: false }, p.removeRecentVault);
      if (result.ok) toast.info(t("splash.removeForgotten", { name }));
      else toast.warning(t("splash.removeForgetPartial", { name, what: result.errors.join(", ") }));
      p.onDeleted(p.vaultPath);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="settings-vault-details">
      <SettingsPageHead title={name} desc={p.vaultPath} />
      {!p.isActiveVault && (
        <SettingCard>
          <SettingRow label={t("mobile.vaultUse")}>
            <Button variant="primary" size="sm" disabled={busy} onClick={p.onUse} data-testid="vault-details-use">
              {t("mobile.vaultUse")}
            </Button>
          </SettingRow>
        </SettingCard>
      )}
      <SettingCard label={t("settings.sectionVault")} testId="vault-details-card">
        <SettingRow label={t("mobile.vaultRename")} desc={name === folder ? undefined : folder}>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void rename()} data-testid="vault-details-rename">
            {t("mobile.vaultRename")}
          </Button>
        </SettingRow>
        <SettingRow label={t("mobile.vaultExport")}>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void exportZip()} data-testid="vault-details-export">
            {t("mobile.vaultExport")}
          </Button>
        </SettingRow>
        {p.hasSync && (
          <SettingRow label={t("settings.syncSection")}>
            <Button variant="secondary" size="sm" onClick={p.onOpenSync} data-testid="vault-details-sync">
              {t("settings.syncSection")}
            </Button>
          </SettingRow>
        )}
      </SettingCard>
      {/* Everything that cannot be undone by pressing again, at the end and in
          the destructive colour, as on the phone. */}
      <SettingCard label={t("mobile.vaultGroupDanger")} testId="vault-details-danger">
        <SettingRow label={t("mobile.vaultDelete")}>
          <Button variant="danger" size="sm" disabled={busy} onClick={() => void remove()} data-testid="vault-details-delete">
            {t("mobile.vaultDelete")}
          </Button>
        </SettingRow>
      </SettingCard>
    </div>
  );
};
