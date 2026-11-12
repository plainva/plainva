/**
 * Whether the index of a vault holds the whole vault (performance plan L3).
 *
 * Since the first index of a vault is built behind the open app, the index can
 * be partial while the app runs: notes not read yet have no rows, no links, no
 * tags. Whoever only SHOWS from the index says so (the strip on top of the
 * app). Whoever PLANS A WRITE from it — the links a rename rewrites, the
 * listing an overview writes, the notes find and replace changes, the members
 * a slice of a workspace gives access to, the reminders it keeps — must not
 * plan over half an index: the writes are real, the half is not visible in
 * them. Those planners ask here first (`requireWholeIndex`): they go on over a
 * whole index and are refused otherwise, with the reason. Background work that
 * can come back later waits instead (`untilWholeIndex`).
 *
 * A wait ends in "whole" or in a refusal — never in "go ahead" because a
 * build failed or the vault was closed.
 *
 * The state belongs to the window that runs the vault and is mirrored into
 * every other window that shows it; per vault, never "whichever vault".
 */
export type IndexWholenessState =
  | { kind: "whole" }
  /** The first index (or one owed a full scan) is being built: `done` of `total` files read, `total` 0 while walking. */
  | { kind: "building"; done: number; total: number }
  /** The last full scan of an index owed one did not go through; the next one that does makes it whole. */
  | { kind: "failed"; reason: string }
  /** The vault was closed while its index was not whole. */
  | { kind: "closed" };

export type IndexNotWholeState = Exclude<IndexWholenessState, { kind: "whole" }>;

export interface IndexWholeness {
  state(): IndexWholenessState;
  /** Resolves at the next change of `state()`, with the state it changed to (a closed vault leaves no entry to read afterwards). */
  changed(): Promise<IndexWholenessState>;
}

/** The index of a vault that has no build to report: whole, as it always was. */
export const ALWAYS_WHOLE: IndexWholeness = {
  state: () => ({ kind: "whole" }),
  changed: () => new Promise<IndexWholenessState>(() => {}),
};

export class IndexNotWholeError extends Error {
  readonly code = "INDEX_NOT_WHOLE";
  constructor(readonly state: IndexNotWholeState) {
    super(
      state.kind === "building"
        ? `The search index is still being built (${state.done} of ${state.total} files read)`
        : state.kind === "failed"
          ? `The search index is incomplete: ${state.reason}`
          : "The vault was closed before its search index was complete",
    );
    this.name = "IndexNotWholeError";
  }
}

/** Whether `error` is that refusal — by class, name or code (a refusal that crossed a window bus keeps only those). */
export function isIndexNotWholeError(error: unknown): error is IndexNotWholeError {
  const e = error as { name?: unknown; code?: unknown } | null | undefined;
  return !!e && typeof e === "object" && (e instanceof IndexNotWholeError || e.name === "IndexNotWholeError" || e.code === "INDEX_NOT_WHOLE");
}

/** Refuses unless the index is whole. For whoever plans a write from it now. */
export function requireWholeIndex(wholeness: IndexWholeness): void {
  const state = wholeness.state();
  if (state.kind !== "whole") throw new IndexNotWholeError(state);
}

/**
 * Resolves once the index is whole — through a build and through failed scans
 * (the next scan that goes through makes it whole); rejects when the vault is
 * closed first. For background work that can be done later.
 */
export async function untilWholeIndex(wholeness: IndexWholeness): Promise<void> {
  let state = wholeness.state();
  for (;;) {
    if (state.kind === "whole") return;
    if (state.kind === "closed") throw new IndexNotWholeError(state);
    state = await wholeness.changed();
  }
}
