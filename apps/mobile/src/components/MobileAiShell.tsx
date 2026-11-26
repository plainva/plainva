import { AreaBoundary } from "@plainva/ui";
import { useTranslation } from "react-i18next";
import { STYLE_EXAMPLES_MAX } from "@plainva/core/ai";
import { AiSheet } from "./AiSheet";
import { LearnSheets } from "./LearnSheets";
import { NotePickSheet } from "./NotePickSheet";
import { pickedForAi, type MobileAiNavigation, type useMobileAi } from "../services/ai/mobileAi";

/*
 * The assistant's place in the shell, in one module. App.tsx is under a line
 * budget, and the assistant's wiring is the assistant's: the shell pays one
 * import, one call of the hook, one line for the palette and one element —
 * and gets all of it from here.
 */
export { openAiNoteTarget, useMobileAi, withoutAiArea } from "../services/ai/mobileAi";
export { ShellProviders } from "./ShellProviders";

/**
 * Hosts the assistant's sheet (the navigation and the system assistant's intents are `MobileAiEntry`'s, mounted
 * before the AI loads) — which is
 * closed before it leads anywhere: to its screen, to a note, to the settings.
 */
export function MobileAiShell({
  ai,
  nav,
  onOpenScreen,
  onOpenNote,
}: {
  ai: Pick<ReturnType<typeof useMobileAi>, "navRef" | "sheet" | "closeSheet" | "notePick" | "closePick">;
  nav: MobileAiNavigation;
  onOpenScreen: () => void;
  onOpenNote: (target: string, kind?: "wiki" | "markdown") => void;
}) {
  const { t } = useTranslation();
  const leaving = (go: () => void) => () => {
    ai.closeSheet();
    go();
  };
  return (
    <>
      {ai.sheet && (
        <AreaBoundary area="sheet:ai" size="dialog" exit={{ label: t("common.close"), onExit: ai.closeSheet }}>
        <AiSheet
          notePath={ai.sheet.path}
          onClose={ai.closeSheet}
          onOpenNote={(target, kind) => leaving(() => onOpenNote(target, kind))()}
          onOpenScreen={leaving(onOpenScreen)}
          onOpenSettings={leaving(() => nav.openSettings?.())}
        />
        </AreaBoundary>
      )}
      {/* The note the AI asked for (plan P9-3): to pin it, or as an example of the writing style — over whatever shows. */}
      {ai.notePick && (
        <AreaBoundary area="sheet:notePick" size="dialog" exit={{ label: t("common.close"), onExit: ai.closePick }}>
        <NotePickSheet
          vault={ai.notePick.vault}
          title={ai.notePick.purpose === "pin" ? t("ai.pinNote") : t("ai.style.pick")}
          {...(ai.notePick.purpose === "style" ? { hint: t("ai.style.examplesHint", { max: STYLE_EXAMPLES_MAX }) } : {})}
          onPick={(path) => pickedForAi(ai.notePick!.purpose, path)}
          onClose={ai.closePick}
        />
        </AreaBoundary>
      )}
      {/* Learning's sheets (plan P6-2): opened from a conversation, a draft or a skill, wherever those are shown. */}
      <LearnSheets onOpenNote={(target) => leaving(() => onOpenNote(target))()} />
    </>
  );
}
