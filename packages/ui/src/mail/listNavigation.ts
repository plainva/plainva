/**
 * Keyboard navigation over the message list (2026-09-04).
 *
 * Pure: what the visible rows are, which one a key moves to, and what a key
 * means. The list itself renders three kinds of row — a message, a folded
 * conversation, a message inside an unfolded conversation — and the arrow
 * keys walk them in the order they are on screen. No DOM, no framework; the
 * shell keeps the focused id and calls its own open/select/trash paths.
 */

export type MailNavRow =
  | {
      kind: "message";
      /** The message's list id — what `openMessage` takes. */
      id: string;
      /** Where it lives; a conversation spans folders. */
      mailbox?: string;
      /** The conversation it belongs to, when the list shows conversations. */
      threadKey?: string;
    }
  | {
      kind: "thread";
      /** `threadNavId(key)` — a header has no message id of its own. */
      id: string;
      threadKey: string;
      open: boolean;
    };

/** A conversation header's navigation id: never collides with a message id. */
export const threadNavId = (threadKey: string): string => `thread:${threadKey}`;

interface NavThreadRow {
  thread: { key: string; messages: readonly { id: string; mailbox?: string }[] };
  latest: { id: string; mailbox?: string };
  count: number;
}

/** The rows of the conversation view as they are on screen: a one-message
 * thread IS its message; an unfolded thread lists its messages under it. */
export function threadedMailRows(rows: readonly NavThreadRow[], openThreads: ReadonlySet<string>): MailNavRow[] {
  const out: MailNavRow[] = [];
  for (const row of rows) {
    if (row.count === 1) {
      out.push({ kind: "message", id: row.latest.id, mailbox: row.latest.mailbox, threadKey: row.thread.key });
      continue;
    }
    const open = openThreads.has(row.thread.key);
    out.push({ kind: "thread", id: threadNavId(row.thread.key), threadKey: row.thread.key, open });
    if (open) for (const m of row.thread.messages) out.push({ kind: "message", id: m.id, mailbox: m.mailbox, threadKey: row.thread.key });
  }
  return out;
}

/** The rows of the flat list. */
export function flatMailRows(envelopes: readonly { id: string }[]): MailNavRow[] {
  return envelopes.map((e) => ({ kind: "message", id: e.id }));
}

export type MailNavMove = "next" | "prev" | "first" | "last";

/**
 * Where a move lands. Clamped at both ends (no wrap-around: the end of the
 * list is a fact worth feeling). Without a current row, "next" enters at the
 * top and "prev" at the bottom.
 */
export function stepMailRow(rows: readonly MailNavRow[], currentId: string | null, move: MailNavMove): MailNavRow | null {
  if (rows.length === 0) return null;
  if (move === "first") return rows[0];
  if (move === "last") return rows[rows.length - 1];
  const i = currentId === null ? -1 : rows.findIndex((r) => r.id === currentId);
  if (i < 0) return move === "next" ? rows[0] : rows[rows.length - 1];
  const j = move === "next" ? Math.min(rows.length - 1, i + 1) : Math.max(0, i - 1);
  return rows[j];
}

export type MailListKeyAction =
  | { type: "move"; move: MailNavMove; extend: boolean }
  | { type: "thread"; open: boolean }
  | { type: "open" }
  | { type: "trash" };

/** What a key means on the list; null means "not ours" and the event bubbles on. */
export function mailListKeyAction(key: string, shift: boolean): MailListKeyAction | null {
  switch (key) {
    case "ArrowDown": return { type: "move", move: "next", extend: shift };
    case "ArrowUp": return { type: "move", move: "prev", extend: shift };
    case "Home": return { type: "move", move: "first", extend: shift };
    case "End": return { type: "move", move: "last", extend: shift };
    case "ArrowRight": return { type: "thread", open: true };
    case "ArrowLeft": return { type: "thread", open: false };
    case "Enter": return { type: "open" };
    case "Delete": return { type: "trash" };
    default: return null;
  }
}
