import i18n from "@plainva/ui/i18n";
import { getPlatformServices, linkDiskProbe, planLinkOpen, requestAnchorJump, toast, type LinkToOpen } from "@plainva/ui";
import { mConfirm } from "./mobileDialogs";
import { getMobileSettings } from "./mobileSettings";
import { vaultOps, type MobileVault } from "./vaultService";

/**
 * The phone's ONE opener for a link — in the editor and the reading mode, a
 * table cell, a journal entry, today's journal and a comment (finding
 * 2026-10-12).
 *
 * What a tap does is decided by the shared `planLinkOpen`; this file runs the
 * outcome the phone's way. Before it, the editor resolved a link and created
 * a note where nothing answered, the journal and the comments resolved it and
 * did NOTHING where nothing answered — no note, no word —, and a link to a
 * folder was handed to the note opener as if the folder were a note.
 */

/** Asks the shell to show a folder (`hooks/useFolderLinkNav` pushes the folder screen); "" is the vault's root. */
export const OPEN_FOLDER_EVENT = "m-open-folder";

export interface MobileLinkContext {
  vault: MobileVault;
  onOpenNote: (path: string) => void;
  /** A place in the note the link stands in — where the surface can scroll there itself. */
  onSameNoteAnchor?: (anchor: string) => void;
}

export async function openLink(link: LinkToOpen, ctx: MobileLinkContext): Promise<void> {
  const { vault } = ctx;
  const outcome = await planLinkOpen(link, {
    resolveWiki: (target, from) => vaultOps.resolveWikiTarget(vault, target, from, "wiki"),
    resolveMarkdown: (target, from) => vaultOps.resolveMarkdownLink(vault, target, from),
    ...linkDiskProbe(vault.files),
  });
  switch (outcome.action) {
    case "open":
      // Parked under the path: the host that mounts for the note takes it.
      if (outcome.anchor) requestAnchorJump(outcome.path, outcome.anchor);
      ctx.onOpenNote(outcome.path);
      return;
    case "folder":
      window.dispatchEvent(new CustomEvent(OPEN_FOLDER_EVENT, { detail: { path: outcome.path, vaultId: vault.vaultId } }));
      return;
    case "anchor":
      if (ctx.onSameNoteAnchor) ctx.onSameNoteAnchor(outcome.anchor);
      else if (link.sourcePath) {
        requestAnchorJump(link.sourcePath, outcome.anchor);
        ctx.onOpenNote(link.sourcePath);
      }
      return;
    case "external":
      // window.open does not reliably reach the system browser inside the
      // native WebView; the platform service does.
      void getPlatformServices().openExternal(outcome.url);
      return;
    case "notFound":
      toast.warning(i18n.t("dialogs.linkNotFoundMsg", { target: outcome.target }));
      return;
    case "create": {
      // The target note does not exist yet — create it (Obsidian parity,
      // maintainer 2026-07-18), then open. The phone honours the same "ask
      // first" setting as the desktop (S39); default off.
      if (getMobileSettings().askBeforeCreateLink) {
        const ok = await mConfirm({ title: i18n.t("settings.askBeforeCreateLink"), message: outcome.title });
        if (!ok) return;
      }
      // Where the link's rule will find it: a Markdown link's name keeps its `#`.
      const created = await vaultOps.createNoteAt(vault, outcome.path, outcome.title);
      if (created) ctx.onOpenNote(created);
      return;
    }
  }
}
