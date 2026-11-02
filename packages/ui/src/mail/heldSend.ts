import { toast } from "../services/toastStore";

/**
 * A message the mail server refused, kept until it is open again — the part of
 * "send" both shells were missing.
 *
 * "Undo send" hands a message over eight seconds after its composer has closed.
 * A refusal at that point — a size the provider does not take, a recipient it
 * rejects, no connection — used to end as one line of error text, and the
 * message was gone: its text, its recipients, megabytes of attachments. Both
 * shells had the gap, so the rule lives here and both read it:
 *
 *  - a refused message is HELD, with everything it was sent with;
 *  - a notice says why and offers the way back. It stands for exactly as long
 *    as the message is held and cannot be waved off (`toast.owed`): closing a
 *    notice must not be what loses a message;
 *  - the message is let go of when a composer HAS it again (`claim`), not when
 *    the way back was merely asked for. An attempt that did not get there — a
 *    window that never came up, a writer who kept the draft that was in the
 *    way — leaves it held, and the notice with it;
 *  - ONE notice stands for all held messages (Sammelplan § 3.95 Nr. 14): with
 *    two or more it says how many, with the reason of the latest, and its
 *    action brings the latest back; once that one is claimed the notice speaks
 *    of the rest. A notice per message stacked up over the phone's bottom bar
 *    and the reader's actions.
 *
 * Held in memory, for as long as the app runs. An outbox that survives a
 * restart is a different piece of work.
 */

export interface HeldSendsOptions<T> {
  /**
   * Brings a held message back in front of its writer: a compose window on the
   * desktop, a pushed compose screen on the phone. Settles when the attempt is
   * over, whichever way it went — the message stays held until `claim`.
   */
  open: (id: number, payload: T) => Promise<void> | void;
  /**
   * The notice's words: why the message was not sent, and the action's name.
   * `count` is how many messages are held — above one the words say so;
   * `reason` is then the latest one's.
   */
  text: (reason: string, count: number) => { message: string; action: string };
  /**
   * After an attempt, how long the composer has to claim the message before
   * the action answers again. Without it a second click in that moment would
   * bring the same message up twice.
   */
  settleMs?: number;
}

interface Held<T> {
  payload: T;
  reason: string;
  opening: boolean;
}

const SETTLE_MS = 2000;

export class HeldSends<T> {
  private readonly held = new Map<number, Held<T>>();
  private nextId = 1;
  /** The one notice for every held message, while there is one. */
  private noticeId: number | null = null;

  constructor(private readonly options: HeldSendsOptions<T>) {}

  /** Keeps a refused message and says so. Returns the id it is held under. */
  hold(payload: T, reason: string): number {
    const id = this.nextId++;
    this.held.set(id, { payload, reason, opening: false });
    this.say();
    return id;
  }

  /** Puts up the notice for what is held now, in place of the one before. */
  private say(): void {
    if (this.noticeId !== null) toast.dismiss(this.noticeId);
    this.noticeId = null;
    const latest = [...this.held.keys()].pop();
    if (latest === undefined) return;
    const { message, action } = this.options.text(this.held.get(latest)!.reason, this.held.size);
    this.noticeId = toast.owed(message, { label: action, run: () => void this.reopen(latest) });
  }

  /** The message held under an id. A read: asking twice is harmless. */
  read(id: number | undefined): T | undefined {
    return id === undefined ? undefined : this.held.get(id)?.payload;
  }

  /** A composer has the message again — from here on it is that composer's. */
  claim(id: number | undefined): void {
    if (id === undefined) return;
    if (!this.held.has(id)) return;
    this.held.delete(id);
    this.say();
  }

  /** How many messages are held; one notice speaks for all of them. */
  get size(): number {
    return this.held.size;
  }

  private async reopen(id: number): Promise<void> {
    const entry = this.held.get(id);
    if (!entry || entry.opening) return;
    entry.opening = true;
    try {
      await this.options.open(id, entry.payload);
      await new Promise<void>((resolve) => setTimeout(resolve, this.options.settleMs ?? SETTLE_MS));
    } catch {
      // The way back failed and said so itself. The message stays held.
    } finally {
      entry.opening = false;
    }
  }
}
