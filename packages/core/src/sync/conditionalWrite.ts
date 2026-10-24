import { RemoteChangedError, type ExpectedRemote, type RemoteStat } from "./ISyncTarget.js";

/** How many refusals against an unchanged remote — on one connection, not necessarily in a row — turn its conditions off. */
const MISREADS_BEFORE_FALLBACK = 3;

/**
 * The part of a conditional upload that is the same for every target
 * (Sammelplan § 3.103).
 *
 * A target sends the condition its service understands (an `If-Match`, a
 * `rev`, a "fail if it exists"). When the service refuses, one question
 * decides what the refusal meant: does the remote, asked for its metadata,
 * still hold what the upload expected? If it does not, another device wrote
 * in between — `RemoteChangedError`, and nothing was written. If it does, this
 * upload is written right after that question, without the condition: the
 * window of one request that Google Drive has always had (3b), never an
 * upload that waits forever.
 *
 * A service that keeps refusing a condition against an unchanged remote
 * (weak entity tags, a gateway that compares differently) does not evaluate
 * it as meant: after a few such refusals on the connection (each of them
 * written after its question all the same) the target stops sending it for this
 * connection and asks before each upload instead — one round trip instead of
 * two. A single odd refusal (a lock, a proxy) does not turn it off. Nor does a
 * refused "no file" where no file is (a folder at the path, a missing
 * parent): that is no evidence about the condition. A service that rejects
 * the condition itself (501) turns it off at once.
 */
export class ConditionalWrites {
  private misreads = 0;
  private unevaluated = false;

  constructor(private readonly provider: string) {}

  /** Should the next write carry the service's own condition? */
  get conditionsHold(): boolean { return !this.unevaluated; }

  /** Does `current` (null: no file) match what the upload expects? */
  static holds(expected: ExpectedRemote, current: RemoteStat | null): boolean {
    return expected.kind === "absent" ? current === null : current !== null && current.etag === expected.marker;
  }

  /**
   * The service refused the condition: throws `RemoteChangedError` when the
   * remote really moved; returns when it did not — the caller then writes
   * once more without the condition (the question just asked is the guard).
   */
  async refused(path: string, expected: ExpectedRemote, stat: () => Promise<RemoteStat | null>, answer: string): Promise<void> {
    if (!ConditionalWrites.holds(expected, await stat())) throw new RemoteChangedError(path, answer);
    if (expected.kind === "absent" || this.unevaluated) return;
    if (++this.misreads < MISREADS_BEFORE_FALLBACK) return;
    console.warn(`[${this.provider}] the server answered ${answer} to conditional uploads although it holds the expected version; asking before each upload from now on`);
    this.unevaluated = true;
  }

  /** Without the service's condition: ask right before writing. */
  async askFirst(path: string, expected: ExpectedRemote, stat: () => Promise<RemoteStat | null>): Promise<void> {
    if (!ConditionalWrites.holds(expected, await stat())) throw new RemoteChangedError(path, "found before the upload");
  }

  /** A service that rejects the condition itself (501 and the like): the same fallback, without asking. */
  notSupported(answer: string): void {
    if (!this.unevaluated) console.warn(`[${this.provider}] the server does not support conditional uploads (${answer}); asking before each upload from now on`);
    this.unevaluated = true;
  }
}
