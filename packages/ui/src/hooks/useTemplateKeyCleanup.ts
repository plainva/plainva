import { useEffect, useMemo, useState } from "react";
import {
  readHiddenTemplateKeys,
  templateKeyNotesOutside,
  templateKeysSignature,
  withoutTemplateKeys,
  writeHiddenTemplateKeys,
  type TemplateKeyNote,
} from "../lib/templateKeys";
import { useStableHandler } from "../lib/useStableHandler";
import { isIndexNotWholeError } from "@plainva/core";

/**
 * "Keys taken over from templates" for a tasks view (open-items plan 3.136
 * no. 1, decision E2). Both shells drive their notice from this one hook:
 * which notes are offered, which are picked to begin with, what removing the
 * keys writes and what "hide" means must not differ between them. The shells
 * hand in their way of changing a note that exists.
 */
export interface TemplateKeyCleanupDeps {
  /** Identity the hidden notice is kept under. */
  vault: string | null;
  /** Anything that means "the index may have changed". */
  reloadKey: unknown;
  /** The vault's query service. Must be stable across renders. */
  queryService: { listTemplateKeyNotes?(): Promise<TemplateKeyNote[]>; untilWholeIndex?(): Promise<void> } | null;
  /** The vault's template folder ("" where none is set). */
  templateFolder: string;
  /** The vault's entry for a change of a note that exists. */
  updateTextFile(path: string, change: (text: string) => string | null): Promise<unknown>;
  /** After a change: refresh what the view shows. */
  onChanged?(): void;
  onError(error: unknown): void;
}

export interface TemplateKeyCleanupState {
  /** The notes outside the template folder that carry a template's keys. */
  items: TemplateKeyNote[];
  /** The notes picked to lose the keys. */
  picked: ReadonlySet<string>;
  toggle(path: string): void;
  /** Show the notice: there is something to offer and it was not hidden. */
  visible: boolean;
  busy: boolean;
  /** Takes the keys out of the picked notes; resolves with how many were changed and how many failed. */
  remove(): Promise<{ removed: number; failed: number } | null>;
  /** "Not now" — until the set of notes changes. */
  hide(): void;
}

export function useTemplateKeyCleanup(deps: TemplateKeyCleanupDeps): TemplateKeyCleanupState {
  const { vault, reloadKey, queryService, templateFolder } = deps;
  const [loaded, setLoaded] = useState<{ source: unknown; items: TemplateKeyNote[] } | null>(null);
  const [unpicked, setUnpicked] = useState<ReadonlySet<string>>(new Set());
  const [hiddenNow, setHiddenNow] = useState<{ vault: string | null; signature: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const stored = useMemo(() => readHiddenTemplateKeys(vault), [vault]);
  const hidden = hiddenNow && hiddenNow.vault === vault ? hiddenNow.signature : stored;
  const onError = useStableHandler(deps.onError);

  useEffect(() => {
    // A query service without the question (an older one handed over a window boundary) offers nothing.
    if (typeof queryService?.listTemplateKeyNotes !== "function") return;
    let stale = false;
    const source = { vault, reloadKey, tick, templateFolder };
    // What it offers to rewrite is planned from the index, so it is asked of a
    // whole one (performance plan L3): while the first index is built the
    // notice waits and comes then; a vault closed first ends the wait unsaid.
    Promise.resolve()
      .then(() => queryService.untilWholeIndex?.())
      .then(() => queryService.listTemplateKeyNotes!())
      .then((notes) => {
        if (!stale) setLoaded({ source, items: templateKeyNotesOutside(notes, templateFolder) });
      })
      .catch((e: unknown) => {
        if (!stale && !isIndexNotWholeError(e)) onError(e);
      });
    return () => {
      stale = true;
    };
  }, [queryService, vault, reloadKey, tick, templateFolder, onError]);

  const items = useMemo(() => loaded?.items ?? [], [loaded]);
  const signature = templateKeysSignature(items);
  const picked = useMemo(() => new Set(items.map((item) => item.path).filter((path) => !unpicked.has(path))), [items, unpicked]);

  const toggle = (path: string) =>
    setUnpicked((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const remove = async (): Promise<{ removed: number; failed: number } | null> => {
    if (busy || picked.size === 0) return null;
    setBusy(true);
    let removed = 0;
    let failed = 0;
    try {
      for (const path of picked) {
        try {
          await deps.updateTextFile(path, (text) => {
            const next = withoutTemplateKeys(text);
            return next === text ? null : next;
          });
          removed += 1;
        } catch (e) {
          // One note that cannot be written must not stop the rest.
          console.error("[templateKeys] the keys could not be taken out of", path, e);
          failed += 1;
        }
      }
    } finally {
      setBusy(false);
    }
    setUnpicked(new Set());
    setTick((n) => n + 1);
    deps.onChanged?.();
    return { removed, failed };
  };

  const hide = () => {
    writeHiddenTemplateKeys(vault, signature);
    setHiddenNow({ vault, signature });
  };

  return {
    items,
    picked,
    toggle,
    visible: items.length > 0 && signature !== hidden,
    busy,
    remove,
    hide,
  };
}
