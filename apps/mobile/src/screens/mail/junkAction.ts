import { applyJunk, createMailbox, moveMessage, planJunkAction, setMessageJunk, type JunkItem, type MailAccountConfig, type MailboxInfo } from "@plainva/ui/mail";

/**
 * Reporting spam on the phone (S12).
 *
 * The decisions live in the shared core (`planJunkAction`, `applyJunk`); this is
 * only the phone's plumbing plus the two answers the screen needs: whether a
 * folder had to be created, and whether the keyword actually stuck. Both go into
 * the toast, so the phone says the same honest thing the desktop does.
 */

export type JunkOutcome =
  | { kind: "done"; direction: "report" | "notJunk"; folder: string; moved: number; flagged: number }
  /** No junk folder, and the caller has not offered to create one yet. */
  | { kind: "needsFolder" }
  | { kind: "noTarget" };

export interface JunkDeps {
  vault: string;
  account: MailAccountConfig;
  folders: readonly MailboxInfo[];
  items: readonly JunkItem[];
  /** Asks whether Plainva may create a junk folder. Absent = do not offer. */
  confirmCreate?: () => Promise<boolean>;
}

const JUNK_FOLDER_NAME = "Junk";

export async function runJunkAction(deps: JunkDeps): Promise<JunkOutcome> {
  const { vault, account, folders, items } = deps;
  if (items.length === 0) return { kind: "noTarget" };

  const plan = planJunkAction(items[0].mailbox, folders);
  let target = plan.target;

  if (plan.direction === "report" && !target) {
    if (!deps.confirmCreate || !(await deps.confirmCreate())) return { kind: "needsFolder" };
    // Refuses rather than inventing a name the server may not accept — a
    // backend without folder creation (Graph) always has a junk folder anyway.
    if (!(await createMailbox(vault, account, JUNK_FOLDER_NAME))) return { kind: "noTarget" };
    target = JUNK_FOLDER_NAME;
  }
  if (!target || target === items[0].mailbox) return { kind: "noTarget" };

  const report = plan.direction === "report";
  const result = await applyJunk(items, target, report, {
    setJunk: (item, junk) => setMessageJunk(vault, account, item.mailbox, item.uid, junk),
    move: (item, to) => moveMessage(vault, account, item.mailbox, item.uid, to),
  });
  return { kind: "done", direction: plan.direction, folder: target, ...result };
}
