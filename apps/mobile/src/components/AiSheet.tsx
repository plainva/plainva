import { useTranslation } from "react-i18next";
import { Maximize2, SquarePen } from "lucide-react";
import { AiConversation, AiSessionContext, ICON, IconButton, noteDisplayName } from "@plainva/ui";
import { SheetGrip } from "./SheetGrip";
import { getMobileAiSession, openAiLink } from "../services/ai/mobileAi";

/**
 * The KI sheet (plan KI-Harness §19.1, dress A on the phone): the companion's
 * counterpart over a note — a floating window does not work on a phone. The
 * same conversation as the KI screen; "full screen" takes it there.
 */
export function AiSheet({
  notePath,
  onClose,
  onOpenScreen,
  onOpenNote,
  onOpenSettings,
}: {
  notePath: string | null;
  onClose: () => void;
  onOpenScreen: () => void;
  onOpenNote: (target: string) => void;
  onOpenSettings: () => void;
}) {
  const { t } = useTranslation();
  const session = getMobileAiSession();
  return (
    <AiSessionContext.Provider value={session}>
      <div className="m-sheet-backdrop" onClick={onClose}>
        <div className="pv-sheet m-sheet m-ai-sheet" data-testid="ai-sheet" onClick={(event) => event.stopPropagation()}>
          <SheetGrip onClose={onClose} />
          <div className="m-ai-sheethead">
            <p className="m-sheet-title">{t("ai.title")}</p>
            <IconButton label={t("ai.newConversation")} onClick={() => session.newConversation()}>
              <SquarePen size={ICON.head} />
            </IconButton>
            <IconButton label={t("ai.openFullScreen")} onClick={onOpenScreen}>
              <Maximize2 size={ICON.head} />
            </IconButton>
          </div>
          <AiConversation
            dress="sheet"
            activeNote={notePath ? { path: notePath, title: noteDisplayName(notePath) } : null}
            onOpenNote={onOpenNote}
            onOpenUrl={openAiLink}
            onOpenSettings={onOpenSettings}
          />
        </div>
      </div>
    </AiSessionContext.Provider>
  );
}
