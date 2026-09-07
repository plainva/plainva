import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "@plainva/ui";
import type { MailAttachment } from "@plainva/ui/mail";
import type { CompareSubject } from "../components/CompareModal";
import { useVault } from "../contexts/VaultContext";
import { appConfirm } from "../services/appDialogs";
import { createNoteFromLink } from "../services/createNoteFromLink";
import { getAskBeforeCreateLink } from "../services/linkCreatePrompt";
import { getConfiguredNoteType } from "../services/newNote";
import { routeOpenThroughOwner } from "../services/openRouting";
import { requestRevealInTree } from "../services/revealRouting";
import { getWindowBus } from "../services/windowBus";

/** What the editor's "send as mail" hands over — the floating composer's seed. */
export interface MailDraftSeed {
  subject: string;
  markdown: string;
  attachments?: MailAttachment[];
  to?: string;
}

export interface AuxBridgeOptions {
  /** This window's label — the `from` of every routed open (null only outside a real window). */
  label: string | null;
  /** Opens content in this window's focused pane (after the owner said so). */
  openInFocusedPane: (path: string, newTab: boolean) => void;
  /** Unfolds this window's context sidebar (the properties section expands itself). */
  revealRightSidebar: () => void;
}

/**
 * The listeners behind `services/auxBridge.ts` (finding 2026-09-07).
 *
 * One hook, one table: every event the table bridges is answered here, and
 * `useAuxBridge.test.tsx` walks the table to prove it. The shell renders what
 * the answers need — the comparison modal, the template picker, the floating
 * composer — from the state this returns; the shell itself stays about panes,
 * tabs and the bus.
 *
 * Read the options through a ref so the listeners are installed once: the
 * pane-layout callbacks change identity on every layout move, and a listener
 * that re-subscribed with them could miss an event fired in between.
 */
export function useAuxBridge(opts: AuxBridgeOptions) {
  const { t } = useTranslation();
  const { vaultAdapter, vaultPath } = useVault();
  const optsRef = useRef(opts);
  const vaultRef = useRef({ vaultAdapter, vaultPath });
  // Written in an effect, never during render (react-hooks/refs): the
  // listeners below read the latest values when an event arrives.
  useEffect(() => {
    optsRef.current = opts;
    vaultRef.current = { vaultAdapter, vaultPath };
  });

  const [compareTarget, setCompareTarget] = useState<CompareSubject | null>(null);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [mailDraft, setMailDraft] = useState<MailDraftSeed | null>(null);

  useEffect(() => {
    // --- local: the comparison surface (version history, conflict) ---------
    const onShowVersions = (e: Event) => {
      const detail = (e as CustomEvent).detail as { path?: string; orphan?: boolean } | undefined;
      if (detail?.path) setCompareTarget({ kind: "version", path: detail.path, orphan: detail.orphan });
    };
    const onResolveConflict = (e: Event) => {
      const detail = (e as CustomEvent).detail as { path?: string } | undefined;
      if (detail?.path) setCompareTarget({ kind: "conflict", conflictPath: detail.path });
    };

    // --- window-with-tree: reveal in the file tree --------------------------
    const onRevealFolder = (e: Event) => {
      const detail = (e as CustomEvent).detail as { path?: string } | undefined;
      if (!detail?.path) return;
      void requestRevealInTree(detail.path).then((outcome) => {
        // The two outcomes with nothing to show are SAID, not swallowed: a
        // click that does nothing was the finding this bridge answers.
        if (outcome === "none") toast.info(t("window.revealNoTree"));
        else if (outcome === "unreachable") toast.error(t("window.ownerUnreachable"));
      });
    };

    // --- local: the note behind an unresolved wiki link ---------------------
    const onCreateNote = (e: Event) => {
      const d = (e as CustomEvent).detail as { target?: string; hostPath?: string; newTab?: boolean } | undefined;
      const { vaultAdapter: adapter, vaultPath: vault } = vaultRef.current;
      if (!d?.target || !adapter) return;
      void (async () => {
        try {
          const result = await createNoteFromLink(d.target!, d.hostPath, {
            vaultAdapter: adapter,
            noteType: () => getConfiguredNoteType(vault ?? ""),
            askFirst: getAskBeforeCreateLink,
            confirm: (title) =>
              appConfirm({
                title: t("dialogs.createNoteFromLinkTitle", { defaultValue: "Notiz anlegen?" }),
                message: t("dialogs.createNoteFromLinkMsg", { title, defaultValue: "„{{title}}“ existiert noch nicht. Jetzt anlegen?" }),
                confirmLabel: t("dialogs.createNoteFromLinkConfirm", { defaultValue: "Anlegen" }),
              }),
            // No indexer here: the write travelled the bus, and the owner
            // indexes what it writes (ownerBus "write").
          });
          if (result.outcome !== "created" && result.outcome !== "exists") return;
          const path = result.path;
          const { label, openInFocusedPane } = optsRef.current;
          routeOpenThroughOwner(path, () => openInFocusedPane(path, !!d.newTab), { from: label });
        } catch (err) {
          toast.error(t("dialogs.createErrorMsg", { error: err instanceof Error ? err.message : String(err) }));
        }
      })();
    };

    // --- local: the floating composer -----------------------------------------
    const onComposeMail = (e: Event) => {
      const detail = (e as CustomEvent).detail as MailDraftSeed | undefined;
      if (detail) setMailDraft({ subject: detail.subject ?? "", markdown: detail.markdown ?? "", attachments: detail.attachments, to: detail.to });
    };

    // --- local: the template picker, the context sidebar ----------------------
    const onOpenTemplatePicker = () => setTemplatePickerOpen(true);
    const onRevealProperties = () => optsRef.current.revealRightSidebar();

    // --- owner: settings exist in exactly one window --------------------------
    const onOpenSyncSettings = (e: Event) => {
      const detail = (e as CustomEvent).detail as { provider?: unknown; area?: unknown; accountId?: unknown } | undefined;
      void (async () => {
        try {
          const bus = await getWindowBus();
          await bus.request("owner-surface", {
            surface: "settings",
            provider: typeof detail?.provider === "string" ? detail.provider : undefined,
            area: typeof detail?.area === "string" ? detail.area : undefined,
            accountId: typeof detail?.accountId === "string" ? detail.accountId : undefined,
          });
        } catch (err) {
          console.warn("[useAuxBridge] the central window did not answer", err);
          toast.error(t("window.ownerUnreachable"));
        }
      })();
    };

    // --- owner: the unlock prompt lives with the master key (N3) ------------
    const onEncryptionLocked = (e: Event) => {
      const detail = (e as CustomEvent).detail as { vaultPath?: unknown; force?: unknown } | undefined;
      // Only a person's request travels: the sync guard's own "locked" never
      // fires here (a client window runs no worker), and if it ever did, the
      // owner's guard already prompts for itself.
      if (detail?.force !== true || typeof detail.vaultPath !== "string") return;
      const vaultPath = detail.vaultPath;
      void (async () => {
        try {
          const bus = await getWindowBus();
          await bus.request("owner-surface", { surface: "encryption-unlock", vaultPath });
        } catch (err) {
          console.warn("[useAuxBridge] the central window did not answer", err);
          toast.error(t("window.ownerUnreachable"));
        }
      })();
    };

    window.addEventListener("plainva-show-version-history", onShowVersions);
    window.addEventListener("plainva-resolve-conflict", onResolveConflict);
    window.addEventListener("plainva-reveal-folder", onRevealFolder);
    window.addEventListener("plainva-create-note-from-link", onCreateNote);
    window.addEventListener("plainva-compose-mail", onComposeMail);
    window.addEventListener("plainva-open-template-picker", onOpenTemplatePicker);
    window.addEventListener("plainva-reveal-properties", onRevealProperties);
    window.addEventListener("plainva-open-sync-settings", onOpenSyncSettings);
    window.addEventListener("plainva-encryption-locked", onEncryptionLocked);
    return () => {
      window.removeEventListener("plainva-show-version-history", onShowVersions);
      window.removeEventListener("plainva-resolve-conflict", onResolveConflict);
      window.removeEventListener("plainva-reveal-folder", onRevealFolder);
      window.removeEventListener("plainva-create-note-from-link", onCreateNote);
      window.removeEventListener("plainva-compose-mail", onComposeMail);
      window.removeEventListener("plainva-open-template-picker", onOpenTemplatePicker);
      window.removeEventListener("plainva-reveal-properties", onRevealProperties);
      window.removeEventListener("plainva-open-sync-settings", onOpenSyncSettings);
      window.removeEventListener("plainva-encryption-locked", onEncryptionLocked);
    };
  }, [t]);

  const closeCompare = useCallback(() => setCompareTarget(null), []);
  const closeTemplatePicker = useCallback(() => setTemplatePickerOpen(false), []);
  const closeMailDraft = useCallback(() => setMailDraft(null), []);

  return { compareTarget, closeCompare, templatePickerOpen, closeTemplatePicker, mailDraft, closeMailDraft };
}
