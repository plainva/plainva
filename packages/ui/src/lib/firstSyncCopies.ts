import { toast } from "../services/toastStore";

/**
 * The conflict copies a vault's first sync kept, said in one line with a way
 * to see them (review 2026-10-27): connected to a folder that already holds
 * notes, the sync keeps both versions of every file the two sides hold
 * differently - and that used to happen without a word. Both shells say it
 * the same way; `show` opens the first copy where the shell shows copies.
 */
export function sayFirstSyncConflictCopies(
  copies: readonly string[],
  t: (key: string, options?: Record<string, unknown>) => string,
  show: (path: string) => void,
): void {
  if (copies.length === 0) return;
  const names = copies.slice(0, 2).join(", ") + (copies.length > 2 ? ` +${copies.length - 2}` : "");
  toast.info(t("sync.firstSyncConflictCopies", { names }), { label: t("common.show"), run: () => show(copies[0]) });
}
