import { useTranslation } from "react-i18next";
import { PanelTop, Sparkles, SquarePen, X } from "lucide-react";
import { editorSelectionReader } from "../../services/editorSelection";
import { AiConversation, FloatingWindow, ICON, IconButton, useAiSession, useAiState } from "@plainva/ui";

/**
 * The companion (plan KI-Harness §19.1, dress A): the quick question over the
 * work, in the shared `FloatingWindow` — the window that already carries peek
 * and compose. It never covers the app for good: it moves, resizes, and turns
 * into the AI tab with the same conversation.
 */
export function AiCompanion({
  activeNote,
  onClose,
  onOpenAsTab,
  onOpenNote,
  onOpenUrl,
  onOpenSettings,
  onPickNote,
}: {
  activeNote: { path: string; title: string } | null;
  onClose: () => void;
  onOpenAsTab: () => void;
  onOpenNote: (target: string) => void;
  onOpenUrl: (url: string) => void;
  onOpenSettings: () => void;
  onPickNote?: () => void;
}) {
  const { t } = useTranslation();
  const session = useAiSession();
  const state = useAiState();
  return (
    <FloatingWindow
      persistKey="ai-companion"
      defaultWidth={440}
      defaultHeight={560}
      minWidth={420}
      minHeight={320}
      ariaLabel={t("ai.companion")}
      testId="ai-companion"
      head={
        <>
          <Sparkles size={ICON.ui} className="pv-ai-headicon" aria-hidden="true" />
          <span className="pv-ai-headtitle">{t("ai.title")}</span>
          <IconButton label={t("ai.newConversation")} disabled={Boolean(state?.live)} onClick={() => session?.newConversation()} data-testid="ai-companion-new">
            <SquarePen size={ICON.ui} />
          </IconButton>
          <IconButton label={t("ai.openAsTab")} onClick={onOpenAsTab} data-testid="ai-companion-tab">
            <PanelTop size={ICON.ui} />
          </IconButton>
          <IconButton label={t("common.close")} onClick={onClose} data-testid="ai-companion-close">
            <X size={ICON.ui} />
          </IconButton>
        </>
      }
    >
      <AiConversation selection={editorSelectionReader} dress="window" activeNote={activeNote} onOpenNote={onOpenNote} onOpenUrl={onOpenUrl} onOpenSettings={onOpenSettings} onPickNote={onPickNote} />
    </FloatingWindow>
  );
}
