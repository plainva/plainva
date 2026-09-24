import { useCallback, useEffect, useState } from "react";
import type { IDatabaseAdapter } from "@plainva/core";
import type { MailAccountConfig } from "./mailAccounts";
import {
  dismissMailOrphanNotice,
  findOrphanedMailAccounts,
  mailOrphanNoticeDismissed,
  removeOrphanedMailAccount,
} from "./orphanedMailAccounts";

export interface OrphanedMailNotice {
  /** The entries the strict rule found, in list order. */
  orphans: MailAccountConfig[];
  /** Whether the notice is up: there are orphans and they were not dismissed. */
  visible: boolean;
  /** "Later": hides the notice for exactly these entries. */
  later(): Promise<void>;
  /** Removes one entry after the shell's confirmation; "kept" = signed in since. */
  remove(account: MailAccountConfig): Promise<"removed" | "kept">;
}

/**
 * The state behind the one-time notice about incomplete mail accounts, shared
 * by the desktop's E-Mail page and the phone's mailbox screen (E4). Each shell
 * renders it with its own primitives and asks its own confirmation; what is
 * found, when the notice shows and what a removal touches is decided here.
 */
export function useOrphanedMailAccounts(
  vaultKey: string | null | undefined,
  db: IDatabaseAdapter | null | undefined,
  reloadToken?: unknown,
): OrphanedMailNotice {
  const [orphans, setOrphans] = useState<MailAccountConfig[]>([]);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    let alive = true;
    if (!vaultKey) {
      setOrphans([]);
      return;
    }
    void (async () => {
      const found = await findOrphanedMailAccounts(vaultKey, db).catch(() => [] as MailAccountConfig[]);
      const hidden = found.length === 0
        || await mailOrphanNoticeDismissed(vaultKey, found.map((a) => a.id)).catch(() => false);
      if (!alive) return;
      setOrphans(found);
      setDismissed(hidden);
    })();
    return () => {
      alive = false;
    };
  }, [vaultKey, db, reloadToken]);

  const later = useCallback(async () => {
    setDismissed(true);
    if (vaultKey) await dismissMailOrphanNotice(vaultKey, orphans.map((a) => a.id)).catch(() => undefined);
  }, [vaultKey, orphans]);

  const remove = useCallback(async (account: MailAccountConfig) => {
    if (!vaultKey) return "kept" as const;
    const result = await removeOrphanedMailAccount(vaultKey, account.id, db);
    // Either way the entry is no longer an orphan to offer.
    setOrphans((prev) => prev.filter((a) => a.id !== account.id));
    return result;
  }, [vaultKey, db]);

  return { orphans, visible: !dismissed && orphans.length > 0, later, remove };
}
