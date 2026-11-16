import { useEffect, useState } from "react";
import { getTaskDatabasePath } from "../services/taskDatabase";

/**
 * The vault's standard task database as stored right now; `undefined` until
 * read. Read again whenever the settings say they saved (`plainva-features-
 * saved`): a database picked in the settings while the tasks view or an
 * account page is open must end the "create one" hint at once, or a click on
 * it made a second database over the one just chosen (review of issue 172).
 */
export function useTaskDatabaseSetting(vaultPath: string | null): string | null | undefined {
  const [state, setState] = useState<{ vault: string | null; path: string | null } | null>(null);
  useEffect(() => {
    if (!vaultPath) return;
    let alive = true;
    const read = () => {
      void getTaskDatabasePath(vaultPath).then((path) => {
        if (alive) setState({ vault: vaultPath, path });
      });
    };
    read();
    window.addEventListener("plainva-features-saved", read);
    return () => {
      alive = false;
      window.removeEventListener("plainva-features-saved", read);
    };
  }, [vaultPath]);
  return state && state.vault === vaultPath ? state.path : undefined;
}
