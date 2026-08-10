/**
 * "Undo send" (S23, plan P12).
 *
 * Nothing about this reaches the outside world. Once SMTP has taken a message
 * there is no taking it back, so what every client calls "undo send" is a DELAY
 * before handing it over — and the honest wording says so: the message has not
 * been sent yet, which is why it can still be stopped.
 *
 * Both shells share this timer so the window means the same thing on both, and
 * so that one rule governs the case that matters: what happens when the app
 * stops being able to wait. On the phone that is going to the background; on the
 * desktop it is closing the window. In both, the answer is SEND, not lose — a
 * message the user asked to send must not vanish because the app went away.
 */

/** How long the reader can still stop a message. */
export const UNDO_SEND_MS = 8000;

export interface PendingSend<T> {
  id: number;
  payload: T;
  /** When it will actually be handed to the transport, epoch ms. */
  dueAt: number;
}

export type SendOutcome = "sent" | "cancelled";

/**
 * A queue of one delayed send at a time per shell.
 *
 * Deliberately not a list: two messages waiting at once would need two toasts
 * and two timers, and the reader would have to remember which "undo" belongs to
 * which. Sending a second message flushes the first IMMEDIATELY — the earlier
 * one was clearly no longer the thing being reconsidered.
 */
export class UndoSendQueue<T> {
  private pending: PendingSend<T> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private nextId = 1;

  constructor(
    private readonly deliver: (payload: T) => Promise<void>,
    private readonly delayMs: number = UNDO_SEND_MS
  ) {}

  /** What is waiting, if anything. */
  current(): PendingSend<T> | null {
    return this.pending;
  }

  /**
   * Queues a message. Any earlier one is delivered first, not dropped.
   *
   * Returns the entry so the caller can show its own countdown.
   */
  enqueue(payload: T, now: number = Date.now()): PendingSend<T> {
    void this.flush();
    const entry: PendingSend<T> = { id: this.nextId++, payload, dueAt: now + this.delayMs };
    this.pending = entry;
    this.timer = setTimeout(() => {
      void this.flush();
    }, this.delayMs);
    return entry;
  }

  /**
   * Stops a waiting message.
   *
   * The id has to match: an "undo" that arrives after the window has closed and
   * a new message is already waiting must not cancel THAT one.
   */
  cancel(id: number): boolean {
    if (!this.pending || this.pending.id !== id) return false;
    this.clearTimer();
    this.pending = null;
    return true;
  }

  /**
   * Hands the waiting message over now — the answer to "the app is going away".
   *
   * Idempotent, because the phone can report backgrounding and the timer can
   * fire in the same breath, and the message must be sent exactly once.
   */
  async flush(): Promise<SendOutcome | null> {
    const entry = this.pending;
    if (!entry) return null;
    this.clearTimer();
    this.pending = null;
    await this.deliver(entry.payload);
    return "sent";
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

/** Seconds left, for a countdown a reader can trust. Never negative. */
export function secondsLeft(entry: PendingSend<unknown>, now: number = Date.now()): number {
  return Math.max(0, Math.ceil((entry.dueAt - now) / 1000));
}
