import { search, searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { keymap } from "@codemirror/view";
import { Prec, EditorState } from "@codemirror/state";
import i18n from "@plainva/ui/i18n";

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
  return [search({ top: true }), highlightSelectionMatches(), searchPhrases(), Prec.high(keymap.of(searchKeymap))];
}
