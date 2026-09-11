import { useEffect } from "react";
import { serviceConnectionMessage, toast } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { switchVault } from "../services/vaultService";
import { CONNECT_RUN_EVENT, advanceOnAccountsChanged, loadConnectQueue } from "../services/connectQueue";
import { getActiveVaultEntry } from "../services/vaultRegistry";
import { navTop, pushEntry, type NavState } from "../navigation";
import { screenForService } from "../routes";

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
          if (!q || !alive) continue;
          if ((await getActiveVaultEntry()).id !== q.context.vaultId) {
            // Copying committed before activation was interrupted. Resume only
            // this prepared destination, never an unrelated screen's vault.
            if (q.preparedVaultId === q.context.vaultId && q.outcomes.files?.state === "connected") await switchVault(q.context.vaultId);
            else continue;
          }
          const service = q.pending[0];
          if (!service) continue;
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
    void advance();
    window.addEventListener(CONNECT_RUN_EVENT, onChanged);
    window.addEventListener("m-vault-switched", onChanged);
    return () => { alive = false; window.removeEventListener(CONNECT_RUN_EVENT, onChanged); window.removeEventListener("m-vault-switched", onChanged); };
  }, [setNav]);
}
