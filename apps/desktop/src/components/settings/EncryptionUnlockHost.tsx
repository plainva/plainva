import React, { useEffect, useRef, useState } from "react";
import { useVault } from "../../contexts/VaultContext";
import { EncryptionSetupModal } from "./EncryptionSetupModal";
import { hasLocalKeyfile, loadCachedMasterKey } from "../../services/encryptionSession";

/**
 * Global unlock prompt (settings-sync plan §3.4). When the sync worker detects an
 * ENCRYPTED connection while this device is LOCKED, its guard pulls the public
 * keyfile and fires `plainva-encryption-locked`. This host then pops the passphrase
 * modal directly, so a second device does not have to be unlocked by hunting
 * through the sync settings. Dismissing it stops the prompt until the vault is
 * reopened (the guard keeps firing every cycle while locked). A successful unlock
 * reopens the vault (the modal fires `plainva-encryption-changed`), the key gets
 * cached, and the guard stops firing.
 */
export const EncryptionUnlockHost: React.FC = () => {
  const { vaultPath, backupAdapter } = useVault();
  const [open, setOpen] = useState(false);
  const dismissedFor = useRef<string | null>(null);

  // A new vault clears any earlier dismissal.
  useEffect(() => {
    dismissedFor.current = null;
    setOpen(false);
  }, [vaultPath]);

  useEffect(() => {
    if (!vaultPath || !backupAdapter) return;
    const onLocked = (e: Event) => {
      const detail = (e as CustomEvent).detail as { vaultPath?: string } | undefined;
      if (detail?.vaultPath && detail.vaultPath !== vaultPath) return;
      if (dismissedFor.current === vaultPath) return;
      // Only prompt when genuinely locked: a keyfile is present (pulled by the
      // guard) but no master key is cached on this device.
      void Promise.all([hasLocalKeyfile(backupAdapter), loadCachedMasterKey(vaultPath)]).then(([kf, mk]) => {
        if (kf && !mk) setOpen(true);
      });
    };
    window.addEventListener("plainva-encryption-locked", onLocked);
    return () => window.removeEventListener("plainva-encryption-locked", onLocked);
  }, [vaultPath, backupAdapter]);

  if (!open || !vaultPath || !backupAdapter) return null;
  return (
    <EncryptionSetupModal
      vaultPath={vaultPath}
      raw={backupAdapter}
      mode="unlock"
      onDone={() => setOpen(false)}
      onCancel={() => {
        dismissedFor.current = vaultPath;
        setOpen(false);
      }}
    />
  );
};
