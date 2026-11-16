import { useEffect, useState } from "react";
import { isEmptyVaultListing, type IVaultAdapter } from "@plainva/core";

/**
 * Whether the open vault holds nothing the user wrote yet (O8) — the core's
 * one rule (`isEmptyVaultListing`), asked again whenever the file tree moves,
 * so the first note ends the prompt at once.
 *
 * Until the root has been read, and when it cannot be read, the answer is
 * "not empty": a prompt to write a first note over a vault full of notes
 * would be the one wrong thing this can show.
 */
export function useVaultEmpty(adapter: IVaultAdapter | null | undefined, version: number): boolean {
  const [empty, setEmpty] = useState(false);
  useEffect(() => {
    if (!adapter) {
      setEmpty(false);
      return;
    }
    let live = true;
    adapter.listDir("").then(
      (entries) => { if (live) setEmpty(isEmptyVaultListing(entries)); },
      () => { if (live) setEmpty(false); },
    );
    return () => { live = false; };
  }, [adapter, version]);
  return empty;
}
