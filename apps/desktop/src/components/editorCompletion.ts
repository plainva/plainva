import { autocompletion } from "@codemirror/autocomplete";
import { slashCommandCompletion, type SlashCompletion } from "./SlashCommandPlugin";
import { atMentionCompletionSource } from "./AtMentionPlugin";
import { wikiLinkCompletionSource, embedCompletionSource, tagCompletionSource, emojiColonCompletionSource, type EditorTriggerDeps } from "./editorTriggers";
import { renderSlashIcon, renderSlashDescription } from "./SlashCommandIcons";

// Single autocompletion config for the editor, combining every trigger source:
// `/` commands, `@` mentions, `[[` note links, `#` tags and `:` emoji. They MUST share one
// `autocompletion()` instance: `override` is not array-merged across multiple
// autocompletion extensions, so a second extension would silently drop the
// first source. All menus render with the same themed icon + description chrome
// (see MarkdownTheme.ts).
export function editorCompletion(deps: EditorTriggerDeps) {
  return autocompletion({
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
    addToOptions: [
      { render: (completion) => renderSlashIcon(completion.type ?? "text"), position: 20 },
      { render: (completion) => renderSlashDescription((completion as SlashCompletion).description), position: 70 },
    ],
  });
}
