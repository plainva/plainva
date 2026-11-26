import { useEffect, useRef, useState } from "react";
import { setNoteLinksVaultLoading, toast } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { loadBootModules } from "../services/bootModules";
import { getMobileVault, type MobileVault } from "../services/vaultService";
import { getActiveVaultEntry } from "../services/vaultRegistry";
import { bindConflictStore } from "../services/conflictState";
// The sync and the calendars start after the first picture and load then (performance plan L5); what the boot asks
// of a running calendar is the runtime's, which stays light.
import { isPimRuntimeReady, leavePimVault } from "../services/pim/pimRuntime";
import { prefetchDeferredParts } from "../lib/deferredParts";
const pimServiceModule = () => import("../services/pim/pimService");
import { startCloudAccountsReconcile } from "../services/cloudAccountsStore";
import { resumePimOAuthResult } from "../services/pim/pimOAuth";
import { startMobileMail, stopMobileMail } from "../services/mail/mailRuntime";
import { healMailAccounts } from "@plainva/ui/mail";
import { staggerAfterFirstPaint, type BootStagger } from "../services/bootStagger";
import { settleVaultEndpointConfirmations } from "../services/endpointConfirmationSettle";

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
    // The open vault's cards follow its calendars and mailboxes (§ 3.105).
    let stopReconcile: (() => void) | null = null;
    // The services of the open vault that have not started yet.
    let stagger: BootStagger | null = null;
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
        // F57: the one-time switch-over takes what already worked here as
        // confirmed; every send path waits for it, so it starts first.
        void settleVaultEndpointConfirmations(v).catch((e) => console.error("[boot] confirming the addresses in use failed", e));
        // Binds the mailboxes to this vault and takes the mail sign-in: no
        // database work, and a sign-in may come back at any moment.
        startMobileMail(v);
        // The rest works on the vault's one database connection: started after
        // the first picture, a short gap apart, and all at once at the first
        // touch (bootStagger.ts, performance plan L4).
        stagger?.cancel();
        stagger = null;
        // The sync and the calendars come from chunks of their own (performance plan L5): both are loaded first, so
        // the steps below run in the order and with the gaps they always had.
        // A load that fails is said as a sync error and tried again (`bootModules.ts`), never left as a silent sync.
        const staggered = loadBootModules({
          load: () => Promise.all([import("../services/syncService"), pimServiceModule()]),
          current,
          onFailure: (e) => {
            console.error("[boot] the sync's and the calendars' modules did not load", e);
            toast.error(`${i18n.t("mobile.syncError")}: ${e instanceof Error ? e.message : String(e)}`);
          },
        });
        void staggered.then((loaded) => {
        if (!loaded || !current()) return;
        const [{ startSyncIfConfigured }, { startPim }] = loaded;
        stagger?.cancel();
        stagger = staggerAfterFirstPaint([
          () => { if (current()) void startSyncIfConfigured(v).catch((e) => console.error("[boot] sync start failed", e)); },
          () => {
            if (!current()) return;
            const pim = startPim(v);
            void (first ? pim.then(resumePimOAuthResult) : pim).catch((e) => console.error("[boot] pim start failed", e));
          },
          () => {
            if (!current()) return;
            stopReconcile?.();
            stopReconcile = startCloudAccountsReconcile(v.vaultId, isPimRuntimeReady);
          },
          // One mailbox stored several times under one id folds back into one
          // row (finding 2026-11-06, M2; the desktop does the same on vault open).
          () => { if (current()) void healMailAccounts(v.vaultId).catch(() => undefined); },
          // The screens likely to open soon load while the app idles, so their first use does not wait (performance plan L5).
          () => { if (current()) prefetchDeferredParts(); },
        ]);
        });
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
      stagger?.cancel();
      stagger = null;
      stopReconcile?.();
      stopReconcile = null;
      leavePimVault();
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
      // What the boot still holds back starts first: the restart below is of a running calendar.
      stagger?.now();
      void getMobileVault().then((v) => {
        // Queued behind a sign-in that is being stored (pimService).
        void pimServiceModule().then(({ restartPimAfterImport }) => restartPimAfterImport(v)).catch((e) => console.error("[import] pim restart failed", e));
        stopMobileMail();
        startMobileMail(v);
        handlersRef.current.onAccountsImported();
      }).catch(() => {});
    };
    window.addEventListener("m-vault-switched", onSwitched);
    window.addEventListener("m-accounts-imported", onAccountsImported);
    return () => {
      alive = false;
      stagger?.cancel();
      stopReconcile?.();
      window.removeEventListener("m-vault-switched", onSwitched);
      window.removeEventListener("m-accounts-imported", onAccountsImported);
    };
  }, []);

  // A note link that arrived waits while the vault boots; its minute runs
  // once the boot answered, ready or failed (F2).
  useEffect(() => setNoteLinksVaultLoading(boot.kind === "opening"), [boot.kind]);
  return { vault, boot };
}
