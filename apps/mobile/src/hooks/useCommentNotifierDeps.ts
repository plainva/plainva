import { useEffect } from "react";
import { requestCommentJump } from "@plainva/ui";
import {
  listAllMobileComments,
  listMobileCommentAuthors,
  mobileCommentSelfId,
} from "../services/mobileComments";
import type { MobileVault } from "../services/vaultService";

/**
 * Hands the notifier what only the shell can read (Stufe F, F3).
 *
 * Its own module rather than an effect in `App.tsx`, and the structure ratchet
 * is right to insist: this is a list of shell capabilities, and a list belongs
 * somewhere it can be named and tested rather than inside the shell's body.
 *
 * Registered rather than imported, so the notifier stays free of the shell's
 * types - and so a notification tapped while the app was cold can park its
 * intent until there is somebody to act on it.
 *
 * Takes a navigate function rather than the shell's own openers because it has
 * to be callable BEFORE the shell's early "no vault yet" return: hooks run in
 * the same order on every render, and the openers are declared after it.
 */
export function useCommentNotifierDeps(
  vault: MobileVault | null,
  navigate: (entry: { kind: "note" | "comments"; path: string }) => void,
): void {
  useEffect(() => {
    if (!vault) return;
    let cancelled = false;
    void import("../services/commentNotifier").then((m) => {
      if (cancelled) return;
      m.setMobileCommentNotifierDeps({
        listNotes: async () =>
          [...(await listAllMobileComments(vault))].map(([path, comments]) => ({ path, comments })),
        listNames: async () => await listMobileCommentAuthors(vault),
        identity: async () => ({ memberId: await mobileCommentSelfId(), deviceId: null }),
        openComment: ({ path, commentId }) => {
          requestCommentJump({ path, commentId });
          // Straight to the note, without the attachment/database routing the
          // shell's own opener does: a comment always hangs on a note, so the
          // other branches cannot apply here.
          navigate({ kind: "note", path });
        },
        openOverview: () => navigate({ kind: "comments", path: "" }),
      });
      // A tap that arrived while the app was closed parked its intent before
      // this ran; now there is somebody to act on it.
      m.applyIntent();
    });
    return () => {
      cancelled = true;
      void import("../services/commentNotifier").then((m) => m.setMobileCommentNotifierDeps(null));
    };
  }, [vault, navigate]);
}
