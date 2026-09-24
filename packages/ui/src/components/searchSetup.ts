import { search, searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { keymap, type KeyBinding } from "@codemirror/view";
import { Prec, EditorState } from "@codemirror/state";
import i18n from "../i18n";

/**
 * CodeMirror's search keys minus one: its "find previous" also sits on
 * Mod+Shift+G, which is Plainva's "open graph" (the desktop's global shortcut).
 * The editor does not stop a key it handles, so both ran — the graph opened and
 * the note behind it grew a search panel or jumped to the previous match. Find
 * previous keeps Shift+F3, and Shift+Enter in the search field. This is the
 * editor's ONLY copy of the search keys: basicSetup's is switched off.
 */
const editorSearchKeymap: readonly KeyBinding[] = searchKeymap.map((binding) =>
  binding.key === "Mod-g" ? { ...binding, shift: undefined } : binding,
);

// In-editor find & replace (#10). CodeMirror ships the panel + commands; we add
// it explicitly (panel at the top), wire the keymap (Ctrl/Cmd-F opens it; the
// panel has a "replace" toggle) and localize the panel labels via the phrases
// facet so the UI is German/English like the rest of the app.
function searchPhrases() {
  const p = (k: string, d: string) => i18n.t(k, { defaultValue: d });
  return EditorState.phrases.of({
    Find: p("search.find", "Suchen"),
    Replace: p("search.replace", "Ersetzen"),
    next: p("search.next", "weiter"),
    previous: p("search.previous", "zurück"),
    all: p("search.all", "alle"),
    "match case": p("search.matchCase", "Groß/klein"),
    "by word": p("search.byWord", "ganzes Wort"),
    regexp: p("search.regexp", "Regex"),
    replace: p("search.replaceOne", "ersetzen"),
    "replace all": p("search.replaceAll", "alle ersetzen"),
    close: p("search.close", "schließen"),
    "current match": p("search.current", "aktueller Treffer"),
  });
}

export function searchSetup() {
  return [search({ top: true }), highlightSelectionMatches(), searchPhrases(), Prec.high(keymap.of(editorSearchKeymap))];
}
