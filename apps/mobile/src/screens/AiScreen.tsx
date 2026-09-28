import { useTranslation } from "react-i18next";
import { History, SquarePen } from "lucide-react";
import { AiConversation, AiSessionContext, ICON, IconButton } from "@plainva/ui";
import { AppBar } from "../components/AppBar";
import { getMobileAiSession, openAiLink } from "../services/ai/mobileAi";

/**
 * The KI screen (plan KI-Harness §19.1, dress C on the phone): the ninth area
 * of the pool, outside the bar by default. The conversation fills the
 * surface; the history is one tap away in the bar's actions.
 */
export function AiScreen({
  onBack,
  onMenu,
  onHistory,
  onOpenNote,
  onOpenSettings,
}: {
  onBack?: () => void;
  onMenu?: () => void;
  onHistory: () => void;
  onOpenNote: (target: string) => void;
  onOpenSettings: () => void;
}) {
  const { t } = useTranslation();
  const session = getMobileAiSession();
  return (
    <AiSessionContext.Provider value={session}>
      <div className="m-page m-ai-page" data-testid="ai-screen">
        <AppBar
          large={!onBack}
          onBack={onBack}
          onMenu={onMenu}
          title={t("ai.title")}
          actions={
            <>
              <IconButton label={t("ai.history.title")} onClick={onHistory} data-testid="ai-history-open">
                <History size={ICON.head} />
              </IconButton>
              <IconButton label={t("ai.newConversation")} onClick={() => session.newConversation()} data-testid="ai-new">
                <SquarePen size={ICON.head} />
              </IconButton>
            </>
          }
        />
        <AiConversation dress="screen" activeNote={null} onOpenNote={onOpenNote} onOpenUrl={openAiLink} onOpenSettings={onOpenSettings} />
      </div>
    </AiSessionContext.Provider>
  );
}
