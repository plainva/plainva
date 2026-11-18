import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { aiSetupStep, AreaBoundary } from "@plainva/ui";
import { AiSetupSheet } from "../components/AiSetupSheet";
import { getMobileAiSession } from "../services/ai/mobileAi";

/**
 * The way from "Set up" to the first answer on the phone (plan Oberfläche
 * O7, T9): while a step is missing — no provider, or no model for new
 * conversations — the conversation's "Set up" opens the three-step sheet;
 * otherwise, and while the AI is off on this device, it opens the settings,
 * where the switch is and everything else can be changed.
 */
export function useAiSetupDoor(onOpenSettings: () => void): { open: () => void; sheet: ReactNode } {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  const open = () => {
    const state = getMobileAiSession().getState();
    if (state.loaded && state.settings.enabled && aiSetupStep(state) !== null) setShown(true);
    else onOpenSettings();
  };
  const sheet = shown ? (
    <AreaBoundary area="sheet:aiSetup" size="dialog" exit={{ label: t("common.close"), onExit: () => setShown(false) }}>
      {() => <AiSetupSheet onClose={() => setShown(false)} />}
    </AreaBoundary>
  ) : null;
  return { open, sheet };
}
