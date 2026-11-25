import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AreaBoundary } from "@plainva/ui";
import { aiSetupStep, type AiSession } from "@plainva/ui/ai";
import { AiSetupDialog } from "./AiSetupDialog";

/**
 * The way from "Set up" to the first answer on the desktop (plan Oberfläche O7, T9; plan Umsetzung 0.9.x, B7), as on
 * the phone (`useAiSetupDoor` there): while a step is missing — no provider, or no model for new conversations — a
 * conversation's "Set up" opens the three-step dialog; otherwise, and while the AI is off on this device, it opens the
 * settings, where the switch is and everything else can be changed. It asks the session it is given and loads
 * nothing of its own: the conversation that offers "Set up" has the AI loaded already.
 */
export function useAiSetupDoor(session: AiSession | null, onOpenSettings: () => void): { open: () => void; dialog: ReactNode } {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  const open = () => {
    const state = session?.getState();
    if (state?.loaded && state.settings.enabled && aiSetupStep(state) !== null) setShown(true);
    else onOpenSettings();
  };
  const dialog =
    shown && session ? (
      <AreaBoundary area="dialog:aiSetup" size="dialog" exit={{ label: t("common.close"), onExit: () => setShown(false) }}>
        {() => <AiSetupDialog session={session} onClose={() => setShown(false)} />}
      </AreaBoundary>
    ) : null;
  return { open, dialog };
}
