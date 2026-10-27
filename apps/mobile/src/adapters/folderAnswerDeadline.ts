import type { VaultFolderNative } from "../platform/vaultFolder";

/**
 * A folder that stops answering (issue 143).
 *
 * Every call into a picked folder goes through the platform: Android's Storage
 * Access Framework asks the app that provides the folder, iOS a security-scoped
 * bookmark. Neither puts a time limit on a call, and a provider that hangs — a
 * third-party app mirroring a large vault, a folder on a card that went to
 * sleep — left the call open for good. The first scan of a new folder vault ran
 * before the app drew anything, so one such call was a blank screen forever.
 *
 * Here every call that only LOOKS — resolving the grant, listing a folder,
 * asking for one entry, reading a file — gets a deadline. One that passes it
 * fails with {@link FolderNoAnswerError}, which names the call and the path,
 * and the callers treat it like any other failure to read: the walk names the
 * folder and goes on (issue 125), the index leaves the file out and says so.
 *
 * A call that CHANGES the folder gets none. A write that is given up on may
 * still land later, and a write that reports failure while it lands is worse
 * than one that takes its time: the chains above would keep the old text as
 * the truth, or write it a second time.
 *
 * A provider that hangs once usually hangs for every call behind it — on
 * Android the calls of one plugin wait in one queue. Waiting out every deadline
 * of a scan would take hours, so after the first call that ran out the folder
 * counts as stalled: the next call still goes out to see whether it answers
 * again, and every call while that one is out fails at once. Any answer, even
 * the late one of the call that ran out, ends the stall.
 */

/** How long a call that only looks may take, by kind. */
export interface FolderDeadlines {
  /** Resolving the grant, listing a folder, asking for one entry. */
  lookMs: number;
  /** Reading a file — a provider may have to fetch it first. */
  readMs: number;
}

/**
 * Generous on purpose: a provider that lists a folder of ten thousand entries,
 * or fetches a file from its cloud on first use, takes seconds, not minutes.
 * A call still open after this is not slow, it is stuck.
 */
export const DEFAULT_FOLDER_DEADLINES: FolderDeadlines = { lookMs: 30_000, readMs: 60_000 };

export class FolderNoAnswerError extends Error {
  constructor(
    readonly call: string,
    readonly path: string,
    /** True when the call was not sent: the folder was stalled already. */
    readonly refused: boolean,
  ) {
    super(refused
      ? `the folder is not answering; ${call} "${path}" was not tried`
      : `the folder did not answer ${call} "${path}" in time`);
    this.name = "FolderNoAnswerError";
  }
}

export function isFolderNoAnswer(error: unknown): error is FolderNoAnswerError {
  return error instanceof FolderNoAnswerError;
}

export interface FolderDeadlineOptions {
  deadlines?: Partial<FolderDeadlines>;
  /** Told once per stall, with the call that ran out — the diagnostics line. */
  onStalled?(call: string, path: string, afterMs: number): void;
  /** Told when the folder answers again, with how many calls failed at once meanwhile. */
  onRecovered?(refused: number): void;
  /**
   * The vault closes: every look still open fails now, and every later one at
   * once. Closing waits for the scan, and the scan would otherwise wait out
   * the deadline of the call it hangs on.
   */
  signal?: AbortSignal;
}

/** The plugin, with a deadline on every call that only looks. */
export function withFolderDeadlines(plugin: VaultFolderNative, options: FolderDeadlineOptions = {}): VaultFolderNative {
  const deadlines = { ...DEFAULT_FOLDER_DEADLINES, ...options.deadlines };
  let stalled = false;
  let probeOut = false;
  let refused = 0;

  const answered = () => {
    if (!stalled) return;
    stalled = false;
    probeOut = false;
    const count = refused;
    refused = 0;
    options.onRecovered?.(count);
  };

  const closing = new Set<() => void>();
  options.signal?.addEventListener("abort", () => { for (const fail of [...closing]) fail(); }, { once: true });

  const look = <T,>(call: string, path: string, ms: number, run: () => Promise<T>): Promise<T> => {
    if (options.signal?.aborted) return Promise.reject(new FolderNoAnswerError(call, path, true));
    if (stalled && probeOut) {
      refused++;
      return Promise.reject(new FolderNoAnswerError(call, path, true));
    }
    if (stalled) probeOut = true;
    const pending = run();
    // Any answer — in time or late, a result or an error — means the folder
    // talks again. A late one is otherwise dropped: its caller has moved on.
    pending.then(answered, answered);
    return new Promise<T>((resolve, reject) => {
      let open = true;
      const close = () => {
        if (!open) return;
        open = false;
        clearTimeout(timer);
        closing.delete(close);
        reject(new FolderNoAnswerError(call, path, true));
      };
      closing.add(close);
      const timer = setTimeout(() => {
        if (!open) return;
        open = false;
        closing.delete(close);
        if (!stalled) options.onStalled?.(call, path, ms);
        stalled = true;
        // The probe ran out as well: the next call goes out as a probe again.
        probeOut = false;
        reject(new FolderNoAnswerError(call, path, false));
      }, ms);
      pending.then(
        (value) => { if (!open) return; open = false; clearTimeout(timer); closing.delete(close); resolve(value); },
        (error: unknown) => { if (!open) return; open = false; clearTimeout(timer); closing.delete(close); reject(error); },
      );
    });
  };

  return {
    pickFolder: () => plugin.pickFolder(),
    release: (opts) => plugin.release(opts),
    resolve: (opts) => look("resolve", "", deadlines.lookMs, () => plugin.resolve(opts)),
    list: (opts) => look("list", opts.path, deadlines.lookMs, () => plugin.list(opts)),
    stat: (opts) => look("stat", opts.path, deadlines.lookMs, () => plugin.stat(opts)),
    read: (opts) => look("read", opts.path, deadlines.readMs, () => plugin.read(opts)),
    write: (opts) => plugin.write(opts),
    delete: (opts) => plugin.delete(opts),
    rename: (opts) => plugin.rename(opts),
    mkdir: (opts) => plugin.mkdir(opts),
  };
}
