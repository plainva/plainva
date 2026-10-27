import { useEffect, useRef, useState } from "react";
import { getMobileVault, type MobileVault } from "../services/vaultService";
import { getActiveVaultEntry } from "../services/vaultRegistry";
import { bindConflictStore } from "../services/conflictState";
import { startSyncIfConfigured } from "../services/syncService";
import { restartPimAfterImport, startPim, stopPim } from "../services/pim/pimService";
import { resumePimOAuthResult } from "../services/pim/pimOAuth";
import { startMobileMail, stopMobileMail } from "../services/mail/mailRuntime";

/**
 * Where the boot of the active vault stands — what the shell shows while it
 * has no vault (issue 143). It used to show nothing at all: an empty container
 * while the vault opened, and the same empty container for good when the boot
 * failed or never answered.
 */
export type VaultBootState =
  | { kind: "opening"; vaultId: string | null; name: string }
  | { kind: "failed"; vaultId: string | null; name: string; error: unknown }
  | { kind: "ready" };

export interface VaultBootHandlers {
  /** The vault is open. `first` is the app's start, not a switch: the session comes back only then. */
  onOpened(vault: MobileVault, first: boolean): void;
  /** Another vault is about to boot: what belonged to the last one goes. */
  onSwitching(): void;
  /** Accounts arrived through the settings sync and the runtimes restarted: the screens read again. */
  onAccountsImported(): void;
}

/**
 * The life of the active vault in the shell: its boot on start and after every
 * switch, the services that run on it, and what the shell can say about a boot
 * that has not answered. Moved out of App.tsx with issue 143 — the boot gained
 * a failure branch and a state, and the shell is at its line budget.
 *
 * Each boot gets a number. A boot that was left behind (a switch away from a
 * vault that did not open, `retireBoot` in vaultService) may still answer
 * later; its answer is dropped, so it cannot put the vault the person left
 * back on screen.
 */
export function useVaultBoot(handlers: VaultBootHandlers): { vault: MobileVault | null; boot: VaultBootState } {
  const [vault, setVault] = useState<MobileVault | null>(null);
  const [boot, setBoot] = useState<VaultBootState>({ kind: "opening", vaultId: null, name: "" });
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    let generation = 0;
    let alive = true;
    const run = (first: boolean) => {
      const mine = ++generation;
      const current = () => alive && mine === generation;
      setBoot({ kind: "opening", vaultId: null, name: "" });
      void getActiveVaultEntry().then((entry) => {
        if (current()) setBoot((b) => (b.kind === "opening" ? { kind: "opening", vaultId: entry.id, name: entry.name } : b));
      }).catch(() => {});
      getMobileVault().then((v) => {
        if (!current()) return;
        setVault(v);
        setBoot({ kind: "ready" });
        bindConflictStore(v.vaultId); // unresolved conflicts survive the restart (P1)
        handlersRef.current.onOpened(v, first);
        void startSyncIfConfigured(v).catch((e) => console.error("[boot] sync start failed", e));
        const pim = startPim(v);
        void (first ? pim.then(resumePimOAuthResult) : pim).catch((e) => console.error("[boot] pim start failed", e));
        startMobileMail(v);
      }, (error: unknown) => {
        if (!current()) return;
        console.error("[boot] the vault did not open", error);
        void getActiveVaultEntry()
          .then((entry) => ({ vaultId: entry.id, name: entry.name }), () => ({ vaultId: null, name: "" }))
          .then((who) => { if (current()) setBoot({ kind: "failed", ...who, error }); });
      });
    };
    run(true);
    // Vault switch (M3.5 isolation): drop all stacks (and any overlay), then
    // reboot the vault and restart sync for the newly active container.
    const onSwitched = () => {
      stopPim();
      stopMobileMail();
      setVault(null);
      handlersRef.current.onSwitching();
      run(false);
    };
    // Accounts arrived through the settings sync (plan P3). They were written
    // straight into the vault database, so the runtimes are still holding the
    // state from before — without this the imported calendar stays empty and
    // the mailbox invisible until the next app start.
    const onAccountsImported = () => {
      void getMobileVault().then((v) => {
        // Queued behind a sign-in that is being stored (pimService).
        void restartPimAfterImport(v).catch((e) => console.error("[import] pim restart failed", e));
        stopMobileMail();
        startMobileMail(v);
        handlersRef.current.onAccountsImported();
      }).catch(() => {});
    };
    window.addEventListener("m-vault-switched", onSwitched);
    window.addEventListener("m-accounts-imported", onAccountsImported);
    return () => {
      alive = false;
      window.removeEventListener("m-vault-switched", onSwitched);
      window.removeEventListener("m-accounts-imported", onAccountsImported);
    };
  }, []);

  return { vault, boot };
}
