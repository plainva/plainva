import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles } from "lucide-react";
import {
  AI_TRANSLATE_LANGUAGES,
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
import { readEditorRange } from "../../services/editorSelection";

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/**
 * "AI" in the editor's selection toolbar (plan KI-Harness P1.5, mockup v5
 * §5): as a suggestion — rewrite, shorten, translate, tasks — or in the
 * conversation — explain, ask. Every action opens the companion, where the
 * send overview asks and the run shows; a suggestion then waits in the
 * margin, authored by the model. Present only while the AI is on.
 */
export function AiSelectionButton() {
  const { t, i18n } = useTranslation();
  const session = useAiSession();
  const state = useAiState();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [translate, setTranslate] = useState(false);
  if (!session || !state?.loaded || !state.settings.enabled) return null;

  const companion = () => window.dispatchEvent(new CustomEvent(AI_OPEN_EVENT));
  const suggest = (action: AiSuggestAction, language?: string) => {
    setOpen(false);
    setTranslate(false);
    // Read before anything moves the focus: the range is what the user marked.
    const range = readEditorRange();
    if (!range) return;
    companion();
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
      <IconButton ref={anchor} label={t("ai.selection.menu")} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(true)} data-testid="selection-ai">
        <Sparkles size={ICON.ui} />
      </IconButton>
      <MenuSurface open={open} onClose={() => setOpen(false)} anchorRef={anchor} ariaLabel={t("ai.selection.menu")}>
        <MenuLabel>{t("ai.selection.asSuggestion")}</MenuLabel>
        <MenuItem onSelect={() => suggest("rewrite")}>{t("ai.selection.action.rewrite")}</MenuItem>
        <MenuItem onSelect={() => suggest("shorten")}>{t("ai.selection.action.shorten")}</MenuItem>
        <MenuItem
          onSelect={() => {
            setOpen(false);
            setTranslate(true);
          }}
        >
          {t("ai.selection.action.translate")}
        </MenuItem>
        <MenuItem onSelect={() => suggest("tasks")}>{t("ai.selection.action.tasks")}</MenuItem>
        <MenuSeparator />
        <MenuLabel>{t("ai.selection.inConversation")}</MenuLabel>
        <MenuItem
          onSelect={() => {
            setOpen(false);
            companion();
            void session.send(askMessage("explain")!);
          }}
        >
          {t("ai.selection.action.explain")}
        </MenuItem>
        <MenuItem
          hint={IS_MAC ? "⌘J" : "Ctrl J"}
          onSelect={() => {
            setOpen(false);
            companion();
          }}
        >
          {t("ai.selection.action.ask")}
        </MenuItem>
      </MenuSurface>
      <MenuSurface open={translate} onClose={() => setTranslate(false)} anchorRef={anchor} ariaLabel={t("ai.selection.translateTo")}>
        <MenuLabel>{t("ai.selection.translateTo")}</MenuLabel>
        {AI_TRANSLATE_LANGUAGES.map((language) => (
          <MenuItem key={language.code} onSelect={() => suggest("translate", language.name)}>
            {languageName(language.code)}
          </MenuItem>
        ))}
      </MenuSurface>
    </>
  );
}
