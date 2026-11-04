import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { STYLE_EXAMPLES_MAX } from "@plainva/core";
import { AiSheet } from "./AiSheet";
import { LearnSheets } from "./LearnSheets";
import { NotePickSheet } from "./NotePickSheet";
import { pushEntry, SCREEN_ENTRY, tapTab, type NavEntry, type NavState } from "../navigation";
import { draftPath } from "../screens/mail/mailNavRefs";
import { MobileAiNavigation, openAiNoteTarget, pickedForAi, type useMobileAi } from "../services/ai/mobileAi";
import { leaveThen } from "../services/leaveQuestion";
import { tabTapped } from "../services/tabTap";
import type { MobileVault } from "../services/vaultService";

/*
 * The assistant's place in the shell, in one module. App.tsx is under a line
 * budget, and the assistant's wiring is the assistant's: the shell pays one
 * import, one call of the hook, one line for the palette and one element —
 * and gets all of it from here.
 */
export { openAiNoteTarget, useMobileAi, withoutAiArea } from "../services/ai/mobileAi";
export { ShellProviders } from "./ShellProviders";

/**
 * Where the assistant's surfaces lead in the shell — every step through
 * `leaveThen` (finding 2026-10-09). Only the screen on top is rendered, so a
 * note, the search, the settings or the composer put over a surface that
 * holds unsaved input — a message being written — would take that input with
 * it. These steps are not that surface's own, so they ask first, as every
 * other way onto the stack does. The event editor's way is the bar's
 * (`tabTapped`), which asks itself; the assistant's sheet closes only once the
 * step was agreed to. The composer gets its draft through the codec of its
 * path (`draftPath`).
 */
export function aiShellRoutes(shell: {
  ai: { closeSheet(): void };
  vault: MobileVault;
  openNote: (path: string) => void;
  push: (entry: NavEntry) => void;
  setNav: (fn: (state: NavState) => NavState) => void;
  commands: MobileAiNavigation["commands"];
  /** The bar carries the assistant's screen: a tap there is the way to it, otherwise it is pushed. */
  aiInBar: boolean;
}): { nav: MobileAiNavigation; onOpenNote: (target: string) => void; onOpenScreen: () => void } {
  const { ai, vault, openNote, push, setNav } = shell;
  const asked = (step: () => void) => () => leaveThen(step);
  return {
    nav: {
      openNote: (path) => leaveThen(() => openNote(path)),
      openSearch: asked(() => push({ kind: "search", path: "" })),
      openSettings: asked(() => push({ kind: "settingsArea", path: "ai" })),
      openMailDraft: (mail) =>
        leaveThen(() => {
          ai.closeSheet();
          push({ kind: "mailcompose", path: draftPath({ accountId: "", ...mail }) });
        }),
      openEventEditor: () => void tabTapped("today", setNav, () => ai.closeSheet()),
      commands: shell.commands,
    },
    onOpenNote: (target) => openAiNoteTarget(vault, target, (path) => leaveThen(() => openNote(path))),
    onOpenScreen: asked(() => setNav((s) => (shell.aiInBar ? tapTab(s, "ai") : pushEntry({ ...s, overlay: [] }, SCREEN_ENTRY.ai)))),
  };
}

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
  ai: Pick<ReturnType<typeof useMobileAi>, "navRef" | "sheet" | "closeSheet" | "notePick" | "closePick">;
  nav: MobileAiNavigation;
  onOpenScreen: () => void;
  onOpenNote: (target: string) => void;
}) {
  const { t } = useTranslation();
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
      {/* The note the AI asked for (plan P9-3): to pin it, or as an example of the writing style — over whatever shows. */}
      {ai.notePick && (
        <NotePickSheet
          vault={ai.notePick.vault}
          title={ai.notePick.purpose === "pin" ? t("ai.pinNote") : t("ai.style.pick")}
          {...(ai.notePick.purpose === "style" ? { hint: t("ai.style.examplesHint", { max: STYLE_EXAMPLES_MAX }) } : {})}
          onPick={(path) => pickedForAi(ai.notePick!.purpose, path)}
          onClose={ai.closePick}
        />
      )}
      {/* Learning's sheets (plan P6-2): opened from a conversation, a draft or a skill, wherever those are shown. */}
      <LearnSheets onOpenNote={(target) => leaving(() => onOpenNote(target))()} />
    </>
  );
}
