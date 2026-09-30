import { autocompletion, closeCompletion, completionKeymap, completionStatus } from "@codemirror/autocomplete";
import { Prec } from "@codemirror/state";
import { keymap, type Command } from "@codemirror/view";
import { slashCommandCompletion, type SlashCompletion } from "./SlashCommandPlugin";
import { atMentionCompletionSource } from "./AtMentionPlugin";
import { wikiLinkCompletionSource, embedCompletionSource, tagCompletionSource, emojiColonCompletionSource, type EditorTriggerDeps } from "./editorTriggers";
import { renderSlashIcon, renderSlashDescription } from "./SlashCommandIcons";

/**
 * Escape closes a completion menu only when there is one to see.
 *
 * CodeMirror's own binding (`closeCompletion`) also "closes" a query that is
 * merely running: with `activateOnTyping`, every source is pending for about
 * 100 ms after each typed character, and an async source until it answers —
 * `null` for plain text. The binding then reported the key as handled and
 * swallowed it, so an Escape pressed right after typing did nothing anyone
 * could see: the window around the editor (a pinboard's "New entry", the peek)
 * stayed open (plan Befunde 2026-09-24, E15). The running query is still
 * cancelled; the key goes on to whatever holds the editor. A menu on screen —
 * also one greyed out while its list is refreshed — keeps the key, as before.
 */
export const closeVisibleCompletion: Command = (view) => {
  const status = completionStatus(view.state);
  if (status === null) return false;
  const onScreen = status === "active" || view.dom.querySelector(".cm-tooltip-autocomplete") !== null;
  closeCompletion(view);
  return onScreen;
};

// Single autocompletion config for the editor, combining every trigger source:
// `/` commands, `@` mentions, `[[` note links, `#` tags and `:` emoji. They MUST share one
// `autocompletion()` instance: `override` is not array-merged across multiple
// autocompletion extensions, so a second extension would silently drop the
// first source. All menus render with the same themed icon + description chrome
// (see MarkdownTheme.ts). The keymap is CodeMirror's own, at the same
// precedence, with Escape answered by `closeVisibleCompletion`.
export function editorCompletion(deps: EditorTriggerDeps) {
  return [
    autocompletion({
      override: [
        slashCommandCompletion,
        atMentionCompletionSource(deps),
        wikiLinkCompletionSource(deps),
        embedCompletionSource(deps),
        tagCompletionSource(deps),
        emojiColonCompletionSource(),
      ],
      activateOnTyping: true,
      icons: false,
      defaultKeymap: false,
      addToOptions: [
        { render: (completion) => renderSlashIcon(completion.type ?? "text"), position: 20 },
        { render: (completion) => renderSlashDescription((completion as SlashCompletion).description), position: 70 },
      ],
    }),
    Prec.highest(keymap.of(completionKeymap.map((binding) => (binding.key === "Escape" ? { ...binding, run: closeVisibleCompletion } : binding)))),
  ];
}
