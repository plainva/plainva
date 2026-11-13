import type { IVaultAdapter, IndexReader } from "@plainva/core";
import { errorText, linkDiskProbe, planLinkOpen, requestAnchorJump, toast, type LinkToOpen } from "@plainva/ui";
import { openExternalUrl as openUrl } from "./openExternal";

/**
 * The desktop's ONE opener for a link — in the editor and the reading view, a
 * table cell, a comment, the journal and a database cell (finding 2026-10-12).
 *
 * What a click does is decided by the shared `planLinkOpen`; this file runs
 * the outcome the desktop's way. Before it, the editor and the reading view
 * each resolved a Markdown link themselves and disagreed about a bare name,
 * a table cell and a comment took every link for a wiki link and created a
 * note where a path led nowhere, and the journal and a database cell handed
 * the raw text of a link to the opener as a path.
 */

export interface DesktopLinkContext {
  /** The reader: a link to a note the index holds opens from its view, also during the first index; creating one asks it whole. */
  queryService: IndexReader<"requireWholeIndex" | "view"> | null | undefined;
  vaultAdapter: Pick<IVaultAdapter, "exists" | "getFileInfo" | "listDir"> | null | undefined;
  onOpenPath: (path: string, newTab: boolean) => void;
  /** Ctrl/Cmd+click. */
  newTab: boolean;
  /** A place in the note the link stands in — where the surface can scroll there itself. */
  onSameNoteAnchor?: (anchor: string) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

const noDisk = { fileExists: async () => false, folderExists: async () => false };

export async function openLink(link: LinkToOpen, ctx: DesktopLinkContext): Promise<void> {
  const { queryService, vaultAdapter, newTab } = ctx;
  if (!queryService) return;
  const outcome = await planLinkOpen(link, {
    resolveWiki: (target, from) => queryService.view().resolveNotePath(target, from),
    resolveMarkdown: (target, from) => queryService.view().resolveMarkdownLink(target, from),
    ...(vaultAdapter ? linkDiskProbe(vaultAdapter) : noDisk),
    requireWholeIndex: () => queryService.requireWholeIndex(),
  });
  switch (outcome.action) {
    case "open":
      ctx.onOpenPath(outcome.path, newTab);
      // Parked under the path: the pane that shows the note — this one after
      // the switch, or a fresh tab — takes it once the text is in.
      if (outcome.anchor) requestAnchorJump(outcome.path, outcome.anchor);
      return;
    case "folder":
      window.dispatchEvent(new CustomEvent("plainva-reveal-folder", { detail: { path: outcome.path } }));
      return;
    case "anchor":
      if (ctx.onSameNoteAnchor) ctx.onSameNoteAnchor(outcome.anchor);
      else if (link.sourcePath) {
        ctx.onOpenPath(link.sourcePath, newTab);
        requestAnchorJump(link.sourcePath, outcome.anchor);
      }
      return;
    case "external":
      openUrl(outcome.url).catch((error) => toast.error(ctx.t("dialogs.openWebLinkErrorMsg", { error })));
      return;
    case "notFound":
      toast.warning(ctx.t("dialogs.linkNotFoundMsg", { target: outcome.target }));
      return;
    case "refused":
      toast.warning(errorText(outcome.error));
      return;
    case "create":
      // The app owns the write, the index and the open, and asks first where
      // the setting says so (maintainer 2026-07-18, Obsidian parity).
      // The place travels with it: a Markdown link's name keeps every character
      // (`Draft #1`), which the wiki rule's reading of the target would cut.
      window.dispatchEvent(new CustomEvent("plainva-create-note-from-link", { detail: { target: outcome.target, hostPath: link.sourcePath, newTab, path: outcome.path, title: outcome.title } }));
      return;
  }
}
