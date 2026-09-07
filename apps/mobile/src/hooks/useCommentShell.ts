import type { MobileVault } from "../services/vaultService";
import { useCommentNotifierDeps } from "./useCommentNotifierDeps";
import { useCommentMoves } from "./useCommentMoves";

/**
 * What the shell owes the comment store, in one call.
 *
 * Two things only the shell can do: hand the notifier what it needs to read
 * and open (Stufe F), and keep remarks with a renamed note (N1). `App.tsx` is
 * at its structure budget, and the ratchet is right - each of these is a named
 * capability with its own module and test, and the shell's body should read
 * as a list of such names, not grow one line per capability.
 */
export function useCommentShell(
  vault: MobileVault | null,
  navigate: (entry: { kind: "note" | "comments"; path: string }) => void,
): void {
  useCommentNotifierDeps(vault, navigate);
  useCommentMoves(vault);
}
