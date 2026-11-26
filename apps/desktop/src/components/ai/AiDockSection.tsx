import { useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, PanelTop, Sparkles, SquarePen, X } from "lucide-react";
import { editorSelectionReader } from "../../services/editorSelection";
import { requestSkillsView } from "../../services/ai/desktopAi";
import { ICON, IconButton } from "@plainva/ui";
import { AiConversation } from "@plainva/ui/ai";

export interface AiDockProps {
  activeNote: { path: string; title: string } | null;
  onNewConversation: () => void;
  onOpenNote: (target: string) => void;
  /** Opens a note the conversation just made — an answer kept as a note — in a tab of its own, beside what is open. */
  onOpenCreated?: (path: string) => void;
  /** `composed`: the model put the address together itself (plan KI-Harness P4); the question before opening says so. */
  onOpenUrl: (url: string, composed?: boolean) => void;
  onOpenSettings: () => void;
  onPickNote?: () => void;
  /** The conversation holds the right column now (plan Oberfläche O7). */
  open: boolean;
  /** Opens it there — the "AI" head of the column's sections. */
  onOpen: () => void;
  /** Closes it; the column shows its sections again, the conversation stays stored. */
  onClose: () => void;
  /** "Pop out": the same conversation in the floating window, from now on on this device. */
  onPopOut: () => void;
  /** "Open as tab": the same conversation in the AI tab, as from the floating window. */
  onOpenAsTab: () => void;
}

/**
 * The docked conversation (plan Oberfläche O7, E1; KI-Harness §19.1 dress B):
 * the conversation beside the note it is about, in the full height of the
 * right column — never over the text. The same one conversation the floating
 * window and the AI tab show; docking changes the dress, never the
 * conversation. Its head carries what the window's head carries: a new
 * conversation, "Pop out" into the window, "Open as tab", and close.
 */
export function AiDockSection({ activeNote, onNewConversation, onOpenNote, onOpenCreated, onOpenUrl, onOpenSettings, onPickNote, onClose, onPopOut, onOpenAsTab }: AiDockProps) {
  const { t } = useTranslation();
  const root = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  // Focus follows the conversation (review O7, R4): into its field when it takes the column, back to where it came from
  // when it closes. A press on the column's "AI" head replaced the head itself; then focus goes back to the new head.
  useLayoutEffect(() => {
    const before = document.activeElement;
    const section = root.current;
    // Kept in a ref: an effect that runs again (StrictMode, a remount) finds focus already in the field and must not
    // take that for where the conversation came from.
    if (before instanceof HTMLElement && before !== document.body && before.isConnected && !section?.contains(before)) opener.current = before;
    const field = section?.querySelector<HTMLElement>("textarea, [contenteditable='true']");
    (field ?? section)?.focus({ preventScroll: true });
    return () => {
      const now = document.activeElement;
      // Only where focus was the conversation's: a click elsewhere took it on purpose.
      if (now && now !== document.body && !section?.contains(now)) return;
      window.requestAnimationFrame(() => {
        if (document.activeElement && document.activeElement !== document.body) return;
        if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
        else document.querySelector<HTMLElement>('[data-section-head="ai"]')?.focus({ preventScroll: true });
      });
    };
  }, []);
  return (
    <section ref={root} tabIndex={-1} className="pv-ai-dock" aria-label={t("ai.title")} data-testid="ai-dock">
      <div className="pv-ai-dock-head">
        <Sparkles size={ICON.ui} className="pv-ai-headicon" aria-hidden="true" />
        <span className="pv-ai-headtitle">{t("ai.title")}</span>
        <IconButton label={t("ai.newConversation")} onClick={onNewConversation} data-testid="right-ai-new">
          <SquarePen size={ICON.ui} />
        </IconButton>
        <IconButton label={t("ai.popOut")} onClick={onPopOut} data-testid="ai-dock-popout">
          <ExternalLink size={ICON.ui} />
        </IconButton>
        <IconButton label={t("ai.openAsTab")} onClick={onOpenAsTab} data-testid="ai-dock-tab">
          <PanelTop size={ICON.ui} />
        </IconButton>
        <IconButton label={t("common.close")} onClick={onClose} data-testid="ai-dock-close">
          <X size={ICON.ui} />
        </IconButton>
      </div>
      <AiConversation selection={editorSelectionReader} dress="dock" activeNote={activeNote} onOpenNote={onOpenNote} onOpenCreated={onOpenCreated} onOpenUrl={onOpenUrl} onOpenSettings={onOpenSettings} onPickNote={onPickNote} onOpenSkills={() => requestSkillsView()} />
    </section>
  );
}
