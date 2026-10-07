import { useEffect, useRef } from "react";
import { AiSheet } from "./AiSheet";
import { MobileAiNavigation, type useMobileAi } from "../services/ai/mobileAi";

/*
 * The assistant's place in the shell, in one module. App.tsx is under a line
 * budget, and the assistant's wiring is the assistant's: the shell pays one
 * import, one call of the hook, one line for the palette and one element —
 * and gets all of it from here.
 */
export { openAiNoteTarget, useMobileAi, withoutAiArea } from "../services/ai/mobileAi";

/**
 * Somewhere the system's assistant was asked to take the user (AI harness
 * P4.7): a note, or the search with the words that were said. The service
 * parks the place and signals it — an intent can be what started the app, and
 * then this is mounted after the order was redeemed.
 */
function useIntentNavigation(nav: MobileAiNavigation): void {
  const latest = useRef(nav);
  useEffect(() => {
    latest.current = nav;
  });
  useEffect(() => {
    const run = () => {
      void import("../services/intentService")
        .then(async ({ consumeIntentNavigation, seedIntentSearch }) => {
          const target = consumeIntentNavigation();
          if (!target) return;
          if (target.kind === "open") {
            latest.current.openNote(target.path);
            return;
          }
          // The search screen starts from the session the vault remembers: the words go there, then the screen opens.
          const { getActiveVaultEntry } = await import("../services/vaultRegistry");
          seedIntentSearch((await getActiveVaultEntry()).id, target.query);
          latest.current.openSearch?.();
        })
        .catch(() => {});
    };
    window.addEventListener("m-intent-nav", run);
    run();
    return () => window.removeEventListener("m-intent-nav", run);
  }, []);
}

/**
 * Hands the assistant the shell's navigation, takes the user where the
 * system's assistant was asked to, and hosts the assistant's sheet — which is
 * closed before it leads anywhere: to its screen, to a note, to the settings.
 */
export function MobileAiShell({
  ai,
  nav,
  onOpenScreen,
  onOpenNote,
}: {
  ai: Pick<ReturnType<typeof useMobileAi>, "navRef" | "sheet" | "closeSheet">;
  nav: MobileAiNavigation;
  onOpenScreen: () => void;
  onOpenNote: (target: string) => void;
}) {
  useIntentNavigation(nav);
  const leaving = (go: () => void) => () => {
    ai.closeSheet();
    go();
  };
  return (
    <>
      <MobileAiNavigation navRef={ai.navRef} nav={nav} />
      {ai.sheet && (
        <AiSheet
          notePath={ai.sheet.path}
          onClose={ai.closeSheet}
          onOpenNote={(target) => leaving(() => onOpenNote(target))()}
          onOpenScreen={leaving(onOpenScreen)}
          onOpenSettings={leaving(() => nav.openSettings?.())}
        />
      )}
    </>
  );
}
