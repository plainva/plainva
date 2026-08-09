import { classifyFolderRole, pickInboxFolder } from "./mailOut";

/**
 * Reporting spam, and taking it back (S12).
 *
 * Two things happen, and only one of them is guaranteed to mean anything to the
 * server: the message MOVES into the junk folder, and — where the server accepts
 * custom keywords — it is marked `$Junk`. Plenty of servers store the keyword
 * and train nothing from it, and plenty of others reject it outright. So the
 * keyword is best-effort and never allowed to cost the move, and the interface
 * says so instead of implying the move trains a filter.
 *
 * Everything here is pure or driven through the injected `JunkOps`, so both
 * shells run the same decisions.
 */

/** Which way the action points, decided by the folder currently open. */
export type JunkDirection = "report" | "notJunk";

export interface JunkPlan {
  direction: JunkDirection;
  /** Where the messages go. Null when the mailbox does not exist yet — for
   * "report" that is the moment to offer creating one. */
  target: string | null;
}

export interface MailboxLike {
  name: string;
  role?: string;
  delimiter?: string;
}

/** The junk mailbox of an account: a stated role first, then the name. Mirrors
 * `pickTrashFolder` — a backend that knows its own special-use folders (Graph
 * localizes their names) must not be second-guessed by a name list. */
export function pickJunkFolder(boxes: readonly MailboxLike[]): string | null {
  const byRole = boxes.find((b) => b.role === "junk");
  if (byRole) return byRole.name;
  const delimiter = boxes.find((b) => b.delimiter)?.delimiter;
  return boxes.find((b) => classifyFolderRole(b.name, delimiter) === "junk")?.name ?? null;
}

/** Whether the open mailbox IS the junk folder — the one bit that flips the
 * button from "Spam" to "Kein Spam". */
export function isJunkFolder(mailbox: string, boxes: readonly MailboxLike[]): boolean {
  const box = boxes.find((b) => b.name === mailbox);
  if (box?.role) return box.role === "junk";
  const delimiter = boxes.find((b) => b.delimiter)?.delimiter;
  return classifyFolderRole(mailbox, delimiter) === "junk";
}

/**
 * What the button does in the mailbox that is open.
 *
 * In the junk folder it points back to the inbox — "not spam" without a place
 * to put the message would be a button that only removes a flag, which is not
 * what anyone means by it.
 */
export function planJunkAction(mailbox: string, boxes: readonly MailboxLike[]): JunkPlan {
  if (isJunkFolder(mailbox, boxes)) {
    return { direction: "notJunk", target: pickInboxFolder(boxes) };
  }
  return { direction: "report", target: pickJunkFolder(boxes) };
}

export interface JunkItem {
  mailbox: string;
  uid: string;
}

export interface JunkOps {
  /** Sets or clears `$Junk`. Optional: a backend without custom keywords
   * (Microsoft Graph) leaves it out, and the move is then the whole signal. */
  setJunk?: (item: JunkItem, junk: boolean) => Promise<void>;
  move: (item: JunkItem, target: string) => Promise<void>;
}

export interface JunkResult {
  moved: number;
  /** How many messages actually carry the keyword now. Zero with a non-zero
   * `moved` is the ordinary case on servers that refuse custom keywords — the
   * caller says "moved" then, not "trained". */
  flagged: number;
}

/**
 * Flags first, then moves — and the order is not cosmetic. After the move the
 * message lives under a NEW uid in the target mailbox, and the old one is gone,
 * so there is nothing left to mark. Marking first also means a server that
 * rejects the keyword costs nothing but a caught error.
 *
 * A failing move is the real failure and propagates; a failing keyword is not.
 */
export async function applyJunk(
  items: readonly JunkItem[],
  target: string,
  junk: boolean,
  ops: JunkOps
): Promise<JunkResult> {
  let moved = 0;
  let flagged = 0;
  for (const item of items) {
    if (ops.setJunk) {
      try {
        await ops.setJunk(item, junk);
        flagged++;
      } catch {
        // The server does not take custom keywords. The move still carries the
        // message where it belongs, and the message to the person stays honest.
      }
    }
    await ops.move(item, target);
    moved++;
  }
  return { moved, flagged };
}
