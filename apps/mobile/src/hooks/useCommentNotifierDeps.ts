import { useEffect } from "react";
import { requestCommentJump } from "@plainva/ui";
import {
  listAllMobileComments,
  listMobileCommentAuthors,
  mobileCommentSelfId,
} from "../services/mobileComments";
import type { MobileVault } from "../services/vaultService";
import type { CommentNotificationNote } from "@plainva/ui";
import type { WorkspaceCommentRecord } from "@plainva/core";

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
        listNotes: async () => {
          // Two sources, one list. A guest remark reaches the owner on EVERY
          // level (§4) - that argument is about the person, not about which
          // device is at hand, so the phone collects them too since F4.
          const notes: CommentNotificationNote[] = [...(await listAllMobileComments(vault))].map(
            ([path, comments]) => ({ path, comments }),
          );
          for (const [path, entries] of await guestComments(vault)) {
            for (const entry of entries) {
              notes.push({
                path,
                comments: [entry.comment],
                source: "publication",
                publicationName: entry.publicationName,
              });
            }
          }
          return notes;
        },
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

/**
 * Guest remarks for the open vault, or nothing.
 *
 * Every precondition is a plain "then there are none": no workspace, no object
 * store, no key for a publication. None of them is an error worth surfacing
 * from a notification cycle - the security screen is where a missing key is
 * stated plainly.
 */
async function guestComments(
  vault: MobileVault,
): Promise<Map<string, Array<{ comment: WorkspaceCommentRecord; publicationName: string }>>> {
  if (!vault.workspaceState || !vault.workspaceRuntime) return new Map();
  try {
    const [{ listAllMobilePublicationComments }, { getMobileWorkspaceObjectStore }] = await Promise.all([
      import("../services/mobileWorkspaceSecurity"),
      import("../services/syncService"),
    ]);
    const store = await getMobileWorkspaceObjectStore(vault.vaultId);
    if (!store) return new Map();
    return await listAllMobilePublicationComments({
      state: vault.workspaceState,
      store,
      runtime: vault.workspaceRuntime,
      vaultId: vault.vaultId,
    });
  } catch {
    return new Map();
  }
}
