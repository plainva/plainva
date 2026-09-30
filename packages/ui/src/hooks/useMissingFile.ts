import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { readIndexedIdentity, type MissingFileDeps } from "@plainva/core";
import { healMissingNote, planMissingNote, type KnownFileIdentity, type MissingFileOutcome } from "../lib/movedNote";

/**
 * What an open file surface shows while its file is not where it says
 * (issue 110, E9): `checking` while it is looked for, `ask` with the files that
 * carry its content when none of them is certain ("Moved?"), `gone` when
 * nothing was found. `searching` while the vault-wide pass behind that first
 * answer still runs. A certain match never shows here — the surface follows it.
 */
export type MissingFileLookup =
  | { kind: "checking" }
  | { kind: "ask"; candidates: string[]; searching: boolean }
  | { kind: "gone"; searching: boolean };

/** What a surface lends the search. Read afresh on every use. */
export interface MissingFileSurface {
  /** What the search needs, or null where the surface cannot look (no index yet): its own error then stays. */
  deps: MissingFileDeps | null;
  /** The vault. One search per path and vault runs, however many surfaces ask. */
  scope: string;
  /** Carries what Plainva stores about the file along a proven or picked move (`adoptExternalMove`). */
  adopt(from: string, to: string): Promise<unknown>;
  /**
   * Takes along what the surface holds that never reached the disk, before
   * the surface goes to the file's new place. Resolves false when that
   * failed; the file is then offered instead of followed.
   */
  carry?(to: string): Promise<boolean>;
  /**
   * Moves the surface to where the file lives now. Absent where the surface
   * cannot navigate: the file is then offered, never silently dropped.
   */
  follow?(to: string): void;
  /** A stale index row went or a new place came in: lists refresh. */
  onIndexChanged?(): void;
}

export interface MissingFile {
  /** Null: nothing is looked for, or the file is there after all — the surface shows its own error. */
  lookup: MissingFileLookup | null;
  /** Looks for the file: after a failed load, a vanish notice, or a write that found it gone. */
  look(): void;
  /** The reader said which file it is: that move is as good as proven. */
  pick(candidate: string): void;
  /** Keeps the identity the index holds for the file now — after a load and after every save. */
  remember(): void;
  /** Nothing to look for any more (the reader saved the file back). */
  clear(): void;
}

/**
 * The missing-file lookup for any surface that shows one vault file — a
 * database, an image — in both shells (issue 110, E9). The decision is the
 * core's (`searchMissingFile`); the dedupe and the carrying of stored paths
 * are `healMissingNote`'s; this is the state around them that every such
 * surface would otherwise write again. The note editors keep their own,
 * because a note's unsaved text changes what the answer means.
 *
 * `remember` matters for a file that vanishes while it is open: by the time
 * the surface hears of it, the watcher or a reconcile has usually removed the
 * index row that carried its content hash and time.
 */
export function useMissingFile(path: string, surface: MissingFileSurface): MissingFile {
  const [lookup, setLookup] = useState<MissingFileLookup | null>(null);
  const [round, setRound] = useState(0);
  const knownRef = useRef<KnownFileIdentity | null>(null);
  // Written after the commit (render-time ref writes break the hooks rules);
  // everything below reads them from events and effects only.
  const surfaceRef = useRef(surface);
  const pathRef = useRef(path);
  useLayoutEffect(() => {
    surfaceRef.current = surface;
    pathRef.current = path;
  });
  useEffect(() => {
    knownRef.current = null;
    setLookup(null);
  }, [path]);
  const aliveRef = useRef(false);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  /**
   * Goes to the file's new place. `isStale` is asked again after the carry:
   * a surface the reader has left meanwhile must not navigate whatever
   * stands in its place now.
   */
  const goTo = useCallback(async (to: string, isStale: () => boolean) => {
    const offer = () => { if (!isStale()) setLookup({ kind: "ask", candidates: [to], searching: false }); };
    if (!surfaceRef.current.follow) {
      offer();
      return;
    }
    let carried = true;
    const carry = surfaceRef.current.carry;
    if (carry) {
      try {
        carried = await carry(to);
      } catch (e) {
        console.warn("[missingFile] taking the change along failed", e);
        carried = false;
      }
    }
    if (isStale()) return;
    // Could not take the change along: the file is offered, and the reader decides.
    if (!carried) {
      offer();
      return;
    }
    surfaceRef.current.follow?.(to);
  }, []);

  useEffect(() => {
    if (round === 0) return;
    const { deps, scope, adopt } = surfaceRef.current;
    const at = pathRef.current;
    if (!deps) {
      setLookup(null);
      return;
    }
    let stale = false;
    const isStale = () => stale;
    const settle = (outcome: MissingFileOutcome, searching: boolean) => {
      // Every answer but "present" changed the index — the stale row went, the
      // new place came in — and the lists hear of it even when this surface
      // has moved on meanwhile.
      if (outcome.kind !== "present") surfaceRef.current.onIndexChanged?.();
      if (stale) return;
      const step = planMissingNote(outcome, false);
      if (step.kind === "stay") setLookup(null);
      else if (step.kind === "follow") void goTo(step.to, isStale);
      else setLookup(step.kind === "ask" ? { kind: "ask", candidates: step.candidates, searching } : { kind: "gone", searching });
    };
    const fail = (e: unknown) => {
      console.warn("[missingFile] looking for a missing file failed", e);
      if (!stale) setLookup((m) => (m && m.kind !== "checking" ? { ...m, searching: false } : { kind: "gone", searching: false }));
    };
    void healMissingNote(at, deps, scope, { known: knownRef.current, onProvenMove: adopt }).then((found) => {
      settle(found.first, !!found.settled);
      found.settled?.then((outcome) => settle(outcome, false), fail);
    }, fail);
    return () => {
      stale = true;
    };
  }, [round, goTo]);

  const look = useCallback(() => {
    if (!surfaceRef.current.deps) return;
    // At once, in the same update as whatever failed: the surface must not
    // flash its error for the frame before the search starts.
    setLookup({ kind: "checking" });
    setRound((r) => r + 1);
  }, []);

  const pick = useCallback((candidate: string) => {
    const from = pathRef.current;
    setLookup({ kind: "checking" });
    void (async () => {
      await Promise.resolve(surfaceRef.current.adopt(from, candidate)).catch((e) => console.warn("[missingFile] adopting the picked file failed", e));
      await goTo(candidate, () => !aliveRef.current || pathRef.current !== from);
    })();
  }, [goTo]);

  const remember = useCallback(() => {
    const deps = surfaceRef.current.deps;
    const at = pathRef.current;
    if (!deps) return;
    void readIndexedIdentity(deps.db, at)
      .then((identity) => {
        if (identity && pathRef.current === at) knownRef.current = identity;
      })
      .catch(() => {});
  }, []);

  const clear = useCallback(() => setLookup(null), []);

  return { lookup, look, pick, remember, clear };
}
