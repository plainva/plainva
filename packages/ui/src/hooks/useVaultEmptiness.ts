import { useEffect, useRef, useState } from "react";
import { readVaultEmptiness, type VaultEmptiness, type VaultRootReader } from "@plainva/core";

/**
 * When the start of a vault asks the root again (plan Oberfläche, O8).
 *
 * The question only has a reason to be asked while the answer can still be
 * "empty". Once a vault was seen holding content it is not read again for as
 * long as it stays open: the triggers the shells pass (the desktop's file-tree
 * version moves on every save, the phone's bump on every return to Home) would
 * otherwise list the root of every real vault at every step (review of O8,
 * 2026-11-17). While a vault is empty its root is a handful of entries, and the
 * next trigger after the first note ends the prompt.
 *
 * A vault emptied later shows its ordinary start until it is opened again —
 * the prompt is for a first note, not a reminder that everything was deleted.
 */
export class VaultEmptinessLatch<V> {
  private settled: V | null = null;

  /** Whether `vault` still needs a read. */
  needsRead(vault: V): boolean {
    return this.settled !== vault;
  }

  /** Records a read's answer: content ends the reads for this vault. */
  record(vault: V, value: VaultEmptiness): void {
    if (value === "content") this.settled = vault;
  }
}

/**
 * The start of the open vault: `"empty"` shows the first-note prompt,
 * `"fetching"` says the vault is being loaded, `"content"` is the ordinary
 * start. Until the root has been read the answer is `"content"`.
 *
 * `firstPullPending` is true while the vault syncs and its first pull has not
 * finished — a cloud vault arriving is not an empty one.
 */
export function useVaultEmptiness(
  vault: VaultRootReader | null | undefined,
  trigger: unknown,
  firstPullPending: boolean,
): VaultEmptiness {
  const latch = useRef(new VaultEmptinessLatch<VaultRootReader>());
  const [answer, setAnswer] = useState<{ vault: VaultRootReader | null; value: VaultEmptiness }>({ vault: null, value: "content" });
  useEffect(() => {
    if (!vault || !latch.current.needsRead(vault)) return;
    let live = true;
    void readVaultEmptiness(vault, { firstPullPending }).then((value) => {
      if (!live) return;
      latch.current.record(vault, value);
      setAnswer({ vault, value });
    });
    return () => { live = false; };
  }, [vault, trigger, firstPullPending]);
  return vault && answer.vault === vault ? answer.value : "content";
}
