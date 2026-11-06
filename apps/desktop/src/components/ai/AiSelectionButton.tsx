import { useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles } from "lucide-react";
import {
  AI_TRANSLATE_LANGUAGES,
  aiStartBlocked,
  askMessage,
  ICON,
  IconButton,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuSurface,
  runSuggestAction,
  useAiSession,
  useAiState,
  type AiSuggestAction,
} from "@plainva/ui";
import { AI_OPEN_EVENT } from "../../services/ai/desktopAi";
import { readEditorRange, type EditorRange } from "../../services/editorSelection";

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/**
 * Where the menu stands and what it acts on. The menu lives OUTSIDE the
 * selection toolbar (Befunde 06.11., B9): opening a menu moves the focus into
 * it, the editor loses the focus, and the toolbar is taken down with the
 * selection's focus — a menu inside it went with it, before anyone saw it.
 * The marked range is read when the button is pressed, while it is still the
 * editor's.
 */
interface MenuRequest {
  at: { x: number; y: number };
  range: EditorRange | null;
}

let request: MenuRequest | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const setRequest = (next: MenuRequest | null) => {
  request = next;
  for (const listener of listeners) listener();
};

/**
 * "AI" in the editor's selection toolbar (plan KI-Harness P1.5, mockup v5
 * §5): as a suggestion — rewrite, shorten, translate, tasks — or in the
 * conversation — explain, ask. Every action opens the companion, where the
 * send overview asks and the run shows; a suggestion then waits in the
 * margin, authored by the model. Present only while the AI is on.
 */
export function AiSelectionButton() {
  const { t } = useTranslation();
  const session = useAiSession();
  const state = useAiState();
  const button = useRef<HTMLButtonElement>(null);
  const open = useSyncExternalStore(subscribe, () => request !== null);
  if (!session || !state?.loaded || !state.settings.enabled) return null;
  return (
    <IconButton
      ref={button}
      label={t("ai.selection.menu")}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={() => {
        const rect = button.current?.getBoundingClientRect();
        setRequest({ at: { x: rect ? rect.left : 0, y: rect ? rect.bottom + 4 : 0 }, range: readEditorRange() });
      }}
      data-testid="selection-ai"
    >
      <Sparkles size={ICON.ui} />
    </IconButton>
  );
}

/** The menu of the selection's AI button: mounted by the editor beside the toolbar, not in it (B9). */
export function AiSelectionMenu() {
  const { t, i18n } = useTranslation();
  const session = useAiSession();
  const current = useSyncExternalStore(subscribe, () => request);
  const [translate, setTranslate] = useState<MenuRequest | null>(null);
  if (!session) return null;

  const companion = () => window.dispatchEvent(new CustomEvent(AI_OPEN_EVENT));
  const close = () => setRequest(null);
  const suggest = (from: MenuRequest, action: AiSuggestAction, language?: string) => {
    close();
    setTranslate(null);
    // The range was read when the button was pressed: the menu took the focus since.
    const range = from.range ?? readEditorRange();
    if (!range) return;
    // The companion shows what happens — or the answer that still runs, with a line that says why nothing new began.
    companion();
    if (aiStartBlocked(session, t)) return;
    void runSuggestAction(session, t, { action, range, ...(language ? { language } : {}) });
  };
  const languageName = (code: string) => {
    try {
      return new Intl.DisplayNames([i18n.language], { type: "language" }).of(code) ?? code;
    } catch {
      return code;
    }
  };

  return (
    <>
      {current && (
        <MenuSurface open onClose={close} at={current.at} ariaLabel={t("ai.selection.menu")}>
          <MenuLabel>{t("ai.selection.asSuggestion")}</MenuLabel>
          <MenuItem onSelect={() => suggest(current, "rewrite")}>{t("ai.selection.action.rewrite")}</MenuItem>
          <MenuItem onSelect={() => suggest(current, "shorten")}>{t("ai.selection.action.shorten")}</MenuItem>
          <MenuItem
            onSelect={() => {
              close();
              setTranslate(current);
            }}
          >
            {t("ai.selection.action.translate")}
          </MenuItem>
          <MenuItem onSelect={() => suggest(current, "tasks")}>{t("ai.selection.action.tasks")}</MenuItem>
          <MenuSeparator />
          <MenuLabel>{t("ai.selection.inConversation")}</MenuLabel>
          <MenuItem
            onSelect={() => {
              close();
              companion();
              if (aiStartBlocked(session, t)) return;
              void session.send(askMessage("explain")!);
            }}
          >
            {t("ai.selection.action.explain")}
          </MenuItem>
          <MenuItem
            hint={IS_MAC ? "⌘J" : "Ctrl J"}
            onSelect={() => {
              close();
              companion();
            }}
          >
            {t("ai.selection.action.ask")}
          </MenuItem>
        </MenuSurface>
      )}
      {translate && (
        <MenuSurface open onClose={() => setTranslate(null)} at={translate.at} ariaLabel={t("ai.selection.translateTo")}>
          <MenuLabel>{t("ai.selection.translateTo")}</MenuLabel>
          {AI_TRANSLATE_LANGUAGES.map((language) => (
            <MenuItem key={language.code} onSelect={() => suggest(translate, "translate", language.name)}>
              {languageName(language.code)}
            </MenuItem>
          ))}
        </MenuSurface>
      )}
    </>
  );
}
