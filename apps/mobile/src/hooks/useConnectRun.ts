import { useEffect } from "react";
import { serviceConnectionMessage, toast } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { CONNECT_RUN_EVENT, advanceOnAccountsChanged, clearConnectQueue, loadConnectQueue } from "../services/connectQueue";
import { enterFlowVault, releaseFlowVault } from "../services/flowVault";
import { getActiveVaultEntry, getVaultEntry } from "../services/vaultRegistry";
import { navTop, pushEntry, type NavState } from "../navigation";
import { screenForService } from "../routes";

/** One run at a time, so one run can wait for its vault. */
const RUN_FLOW = "connect-run";
/** Runs whose summary was put on screen in this lifetime of the app. */
const summaryShown = new Set<string>();

/** A run whose vault was deleted is over — the same as giving it up (`ConnectRunBanner`). */
async function endRun(run: string): Promise<void> {
  if ((await loadConnectQueue())?.id === run) await clearConnectQueue();
}

/** Progress follows an exact saved result, including after process restart. */
export function useConnectRun(setNav: (fn: (state: NavState) => NavState) => void): void {
  useEffect(() => {
    let running = false, again = false, alive = true;
    const advance = async () => {
      if (running) { again = true; return; }
      running = true;
      try {
        do {
          again = false;
          const q = await loadConnectQueue();
          // A run that is over, or that waits for another vault by now, takes
          // the offer of its old destination with it (`flowVault.ts`).
          releaseFlowVault(RUN_FLOW, q?.context.vaultId);
          if (!q || !alive) continue;
          const run = q.id, target = q.context.vaultId;
          if ((await getActiveVaultEntry()).id !== target) {
            // Deleted while the run went on: there is nowhere to go on to.
            if ((await getVaultEntry(target).catch(() => undefined)) === null) { await endRun(run); continue; }
            // Copying committed before activation was interrupted. Resume only
            // this prepared destination, never an unrelated screen's vault —
            // and only while its activation is outstanding: once the run has
            // gone on there, a vault the person opens is theirs.
            if (q.pending[0] !== "files" || q.preparedVaultId !== target || q.outcomes.files?.state !== "connected") continue;
            // And not over unsaved work in the vault on screen: the switch is
            // offered then, and the run goes on once its vault is the active
            // one. A transfer that is activating this vault right now is
            // waited for the same way.
            if (!(await enterFlowVault(target, RUN_FLOW, {
              resume: advance,
              waits: async () => { const now = await loadConnectQueue(); return now?.id === run && now.context.vaultId === target && now.pending[0] === "files"; },
              gone: () => endRun(run),
            }))) continue;
          }
          const service = q.pending[0];
          if (!service) {
            // Every step done or skipped - the last one skipped leaves no
            // account change to advance on: the summary, once per run.
            if (!summaryShown.has(run)) {
              summaryShown.add(run);
              setNav(st => navTop(st)?.kind === "cloudaccounts" ? st : pushEntry(st, { kind: "cloudaccounts", path: "" }));
            }
            continue;
          }
          const result = await advanceOnAccountsChanged(service);
          if (!alive) continue;
          const entry = result.advanced && !result.next ? { kind: "cloudaccounts" as const, path: "" } : { kind: screenForService(result.advanced ? result.next! : service), path: "", family: q.family };
          setNav(st => {
            const top = navTop(st);
            return top?.kind === entry.kind && top.family === ("family" in entry ? entry.family : undefined) ? st : pushEntry(st, entry);
          });
        } while (again && alive);
      } catch (error) { toast.error(serviceConnectionMessage(error, i18n.t)); }
      finally { running = false; }
    };
    const onChanged = () => { void advance(); };
    // A vault deleted under a run ends it at once, not on its next sign of
    // life. Only that: the list also changes when a vault is renamed or
    // paused, and that is no occasion to put the run's screen on top.
    const onVaultsChanged = () => {
      void (async () => {
        const q = await loadConnectQueue();
        if (q && (await getVaultEntry(q.context.vaultId).catch(() => undefined)) === null) await endRun(q.id);
      })().catch((error: unknown) => toast.error(serviceConnectionMessage(error, i18n.t)));
    };
    void advance();
    window.addEventListener(CONNECT_RUN_EVENT, onChanged);
    window.addEventListener("m-vault-switched", onChanged);
    window.addEventListener("m-vaults-changed", onVaultsChanged);
    return () => {
      alive = false;
      window.removeEventListener(CONNECT_RUN_EVENT, onChanged);
      window.removeEventListener("m-vault-switched", onChanged);
      window.removeEventListener("m-vaults-changed", onVaultsChanged);
    };
  }, [setNav]);
}
