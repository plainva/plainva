import { useTranslation } from "react-i18next";
import { ExternalLink, PanelTop, Sparkles, SquarePen, X } from "lucide-react";
import { editorSelectionReader } from "../../services/editorSelection";
import { AiConversation, ICON, IconButton } from "@plainva/ui";

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
  return (
    <section className="pv-ai-dock" aria-label={t("ai.title")} data-testid="ai-dock">
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
      <AiConversation selection={editorSelectionReader} dress="dock" activeNote={activeNote} onOpenNote={onOpenNote} onOpenCreated={onOpenCreated} onOpenUrl={onOpenUrl} onOpenSettings={onOpenSettings} onPickNote={onPickNote} />
    </section>
  );
}
