import { useTranslation } from "react-i18next";
import { Maximize2, SquarePen } from "lucide-react";
import { ICON, IconButton, noteDisplayName } from "@plainva/ui";
import { AiConversation, AiSessionContext, startAiConversation } from "@plainva/ui/ai";
import { SheetGrip } from "./SheetGrip";
import { getMobileAiSession, openAiLink, openAiNotePick, openAiSkills } from "../services/ai/mobileAi";
import { editorSelectionReader } from "../services/editorSelection";
import { useAiSetupDoor } from "../hooks/useAiSetupDoor";

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
  onOpenNote: (target: string, kind?: "wiki" | "markdown") => void;
  onOpenSettings: () => void;
}) {
  const { t } = useTranslation();
  const session = getMobileAiSession();
  // "Set up" opens the three-step setup while a step is missing (plan Oberfläche O7, T9).
  const setup = useAiSetupDoor(onOpenSettings);
  return (
    <AiSessionContext.Provider value={session}>
      <div className="m-sheet-backdrop" onClick={onClose}>
        <div className="pv-sheet m-sheet m-ai-sheet" data-testid="ai-sheet" onClick={(event) => event.stopPropagation()}>
          <SheetGrip onClose={onClose} />
          <div className="m-ai-sheethead">
            <p className="m-sheet-title">{t("ai.title")}</p>
            {/* While an answer streams it says so instead of doing nothing (Befunde 06.11., B8), as the desktop's companion and tab. */}
            <IconButton label={t("ai.newConversation")} onClick={() => startAiConversation(session, t)}>
              <SquarePen size={ICON.head} />
            </IconButton>
            <IconButton label={t("ai.openFullScreen")} onClick={onOpenScreen}>
              <Maximize2 size={ICON.head} />
            </IconButton>
          </div>
          <AiConversation
            selection={editorSelectionReader}
            dress="sheet"
            activeNote={notePath ? { path: notePath, title: noteDisplayName(notePath) } : null}
            onOpenNote={onOpenNote}
            onOpenUrl={openAiLink}
            onOpenSettings={setup.open}
            onPickNote={() => openAiNotePick("pin")}
            onOpenSkills={openAiSkills}
          />
        </div>
      </div>
      {setup.sheet}
    </AiSessionContext.Provider>
  );
}
