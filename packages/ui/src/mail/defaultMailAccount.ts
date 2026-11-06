/**
 * The default mailbox of a vault (finding 2026-11-06, M1; decision E1: it
 * travels with the vault, like the default calendar).
 *
 * Every place that had to choose a mailbox without being told one took the
 * first of the list - and the list is stored in the order of connecting, so a
 * mailbox connected later could never be where Mail opens or where a new
 * message starts. One rule now, for every such place in both shells:
 *
 *   1. a mailbox the situation names wins - the draft's own, the one a reply's
 *      message is in, the one whose address a note names, the one open in the
 *      list (`hint`);
 *   2. otherwise the default mailbox;
 *   3. otherwise - no default, or it is gone, or its mail is switched off for
 *      the vault (callers pass the list with only the switched-on mailboxes) -
 *      the first one.
 *
 * Each shell stores the DEVICE-LOCAL id (keychain slots hang off it); the
 * settings profile carries the logical one (`defaultMailAccountForProfile`).
 */
export function pickDefaultMailAccount<T extends { id: string }>(
  list: readonly T[],
  defaultId: string | null | undefined,
  hint?: string | null,
): T | null {
  if (hint) {
    const named = list.find((entry) => entry.id === hint);
    if (named) return named;
  }
  if (defaultId) {
    const chosen = list.find((entry) => entry.id === defaultId);
    if (chosen) return chosen;
  }
  return list[0] ?? null;
}

/** Whether `id` is the mailbox `pickDefaultMailAccount` falls to without a hint. */
export function isDefaultMailAccount(list: readonly { id: string }[], defaultId: string | null | undefined, id: string): boolean {
  return pickDefaultMailAccount(list, defaultId)?.id === id;
}
