import {
  autocompletion,
  CompletionContext,
  CompletionResult,
  Completion,
  pickedCompletion,
  startCompletion,
} from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
import i18n from "../i18n";
import { renderSlashIcon, renderSlashDescription } from "./SlashCommandIcons";

// The editor's `/` command menu (Notion-style). Each entry maps a readable name
// to a Markdown snippet. The menu is themed (see MarkdownTheme.ts), grouped into
// sections, and filtered as you type against the localized title plus a set of
// German/English keywords (so "/heading", "/über" and "/h1" all find Heading 1).

type ApplyFn = (view: EditorView, completion: Completion, from: number, to: number) => void;

interface SlashDef {
  // Unique id; also selects the icon (see SlashCommandIcons.ts).
  key: string;
  // i18n keys for the title and the short description line.
  labelKey: string;
  descKey: string;
  // Section the command is grouped under.
  section: "basics" | "format" | "media" | "document" | "callouts";
  // Compact Markdown-syntax hint shown right-aligned (e.g. "##", "**").
  hint: string;
  // Extra match terms (lowercase, German + English) for dynamic filtering.
  keywords: string[];
  // What gets inserted. A string replaces the typed `/query`; a function lets
  // us place the caret (e.g. inside `**…**`).
  apply: string | ApplyFn;
}

// A Completion carrying our extra render data (description + icon type).
export type SlashCompletion = Completion & { description?: string };

const SECTION_RANK: Record<SlashDef["section"], number> = {
  basics: 1,
  format: 2,
  media: 3,
  document: 4,
  callouts: 5,
};

const SECTION_LABEL_KEY: Record<SlashDef["section"], string> = {
  basics: "editor.slashSecBasics",
  format: "editor.slashSecFormat",
  media: "editor.slashSecMedia",
  document: "editor.slashSecDocument",
  callouts: "editor.slashSecCallouts",
};

// The Obsidian callout variants offered in the menu. Each inserts the canonical
// `> [!type] ` marker; aliases are kept as filter keywords so e.g. "/error" finds
// Danger and "/summary" finds Abstract. Colours/rendering come from callouts.ts.
const CALLOUT_VARIANTS: { type: string; labelKey: string; descKey: string; keywords: string[] }[] = [
  { type: "note", labelKey: "editor.calloutNote", descKey: "editor.calloutNoteDesc", keywords: ["callout", "note", "notiz", "hinweis"] },
  { type: "info", labelKey: "editor.calloutInfo", descKey: "editor.calloutInfoDesc", keywords: ["callout", "info", "information"] },
  { type: "todo", labelKey: "editor.calloutTodo", descKey: "editor.calloutTodoDesc", keywords: ["callout", "todo", "to-do", "aufgabe"] },
  { type: "abstract", labelKey: "editor.calloutAbstract", descKey: "editor.calloutAbstractDesc", keywords: ["callout", "abstract", "summary", "tldr", "zusammenfassung", "kurzfassung"] },
  { type: "tip", labelKey: "editor.calloutTip", descKey: "editor.calloutTipDesc", keywords: ["callout", "tip", "tipp", "hint", "important", "empfehlung", "wichtig"] },
  { type: "success", labelKey: "editor.calloutSuccess", descKey: "editor.calloutSuccessDesc", keywords: ["callout", "success", "erfolg", "check", "done", "erledigt"] },
  { type: "question", labelKey: "editor.calloutQuestion", descKey: "editor.calloutQuestionDesc", keywords: ["callout", "question", "frage", "help", "hilfe", "faq"] },
  { type: "warning", labelKey: "editor.calloutWarning", descKey: "editor.calloutWarningDesc", keywords: ["callout", "warning", "warnung", "caution", "attention", "achtung", "vorsicht"] },
  { type: "failure", labelKey: "editor.calloutFailure", descKey: "editor.calloutFailureDesc", keywords: ["callout", "failure", "fehlschlag", "fail", "missing", "fehlt"] },
  { type: "danger", labelKey: "editor.calloutDanger", descKey: "editor.calloutDangerDesc", keywords: ["callout", "danger", "gefahr", "error", "fehler"] },
  { type: "bug", labelKey: "editor.calloutBug", descKey: "editor.calloutBugDesc", keywords: ["callout", "bug", "fehler"] },
  { type: "example", labelKey: "editor.calloutExample", descKey: "editor.calloutExampleDesc", keywords: ["callout", "example", "beispiel"] },
  { type: "quote", labelKey: "editor.calloutQuote", descKey: "editor.calloutQuoteDesc", keywords: ["callout", "quote", "zitat", "cite"] },
];

// Insert `before + after`, replacing the typed `/query`, and put the caret at
// `from + caret`. Adds the pickedCompletion annotation so the menu closes.
function wrap(before: string, after: string, caret: number): ApplyFn {
  return (view, completion, from, to) => {
    view.dispatch({
      changes: { from, to, insert: before + after },
      selection: { anchor: from + caret },
      annotations: pickedCompletion.of(completion),
      userEvent: "input.complete",
    });
  };
}

// Table: remove the typed `/query`, then open the graphical size picker (handled
// by the Editor via a window event). The actual table is inserted on selection.
const openTablePicker: ApplyFn = (view, completion, from, to) => {
  view.dispatch({
    changes: { from, to, insert: "" },
    selection: { anchor: from },
    annotations: pickedCompletion.of(completion),
    userEvent: "input.complete",
  });
  // Defer so the completion tooltip closes and the selection settles first.
  setTimeout(() => window.dispatchEvent(new CustomEvent("plainva-open-table-picker")), 0);
};

// Plain text: just remove the typed `/query` and leave a normal paragraph.
const toPlainText: ApplyFn = (view, completion, from, to) => {
  view.dispatch({
    changes: { from, to, insert: "" },
    selection: { anchor: from },
    annotations: pickedCompletion.of(completion),
    userEvent: "input.complete",
  });
};

// Remove the typed `/query`, then fire a window event so the editor opens the
// base picker / creates an inline `.base` at that position (handled in Editor.tsx).
function clearAndEmit(eventName: string): ApplyFn {
  return (view, completion, from, to) => {
    view.dispatch({
      changes: { from, to, insert: "" },
      selection: { anchor: from },
      annotations: pickedCompletion.of(completion),
      userEvent: "input.complete",
    });
    setTimeout(() => window.dispatchEvent(new CustomEvent(eventName, { detail: { pos: from } })), 0);
  };
}
const openBasePicker = clearAndEmit("plainva-open-base-picker");
const createInlineBase = clearAndEmit("plainva-create-inline-base");

// Footnote (P3.6): insert the next free numeric reference at the caret and
// append its definition at the end of the document; the caret jumps into the
// definition so the footnote text is typed right away.
const insertFootnote: ApplyFn = (view, completion, from, to) => {
  const doc = view.state.doc.toString();
  let max = 0;
  for (const m of doc.matchAll(/\[\^(\d+)\]/g)) {
    const n = Number(m[1]);
    if (n > max) max = n;
  }
  const label = `[^${max + 1}]`;
  const tailGap = doc.endsWith("\n\n") ? "" : doc.endsWith("\n") ? "\n" : "\n\n";
  const definition = `${tailGap}${label}: `;
  const end = view.state.doc.length;
  view.dispatch({
    changes: [
      { from, to, insert: label },
      { from: end, to: end, insert: definition },
    ],
    // Both changes are before-positions of the SAME dispatch; the definition's
    // insertion point shifts by the reference we insert at the caret.
    selection: { anchor: end + (label.length - (to - from)) + definition.length },
    annotations: pickedCompletion.of(completion),
    userEvent: "input.complete",
  });
};

// Insert an opener (`[[` / `![[`) replacing the typed `/query`, then open the
// autocomplete so the user can search existing files (note link / embed / image).
function insertAndComplete(opener: string): ApplyFn {
  return (view, completion, from, to) => {
    view.dispatch({
      changes: { from, to, insert: opener },
      selection: { anchor: from + opener.length },
      annotations: pickedCompletion.of(completion),
      userEvent: "input.complete",
    });
    setTimeout(() => startCompletion(view), 0);
  };
}

const DEFS: SlashDef[] = [
  // --- Grundlagen / Basic blocks ---
  { key: "text", labelKey: "editor.slashText", descKey: "editor.slashTextDesc", section: "basics", hint: "", keywords: ["text", "plain", "paragraph", "absatz", "fliesstext", "body"], apply: toPlainText },
  { key: "h1", labelKey: "editor.slashH1", descKey: "editor.slashH1Desc", section: "basics", hint: "#", keywords: ["h1", "heading", "ueberschrift", "title", "titel"], apply: "# " },
  { key: "h2", labelKey: "editor.slashH2", descKey: "editor.slashH2Desc", section: "basics", hint: "##", keywords: ["h2", "heading", "ueberschrift"], apply: "## " },
  { key: "h3", labelKey: "editor.slashH3", descKey: "editor.slashH3Desc", section: "basics", hint: "###", keywords: ["h3", "heading", "ueberschrift"], apply: "### " },
  { key: "h4", labelKey: "editor.slashH4", descKey: "editor.slashH4Desc", section: "basics", hint: "####", keywords: ["h4", "heading", "ueberschrift"], apply: "#### " },
  { key: "h5", labelKey: "editor.slashH5", descKey: "editor.slashH5Desc", section: "basics", hint: "#####", keywords: ["h5", "heading", "ueberschrift"], apply: "##### " },
  { key: "h6", labelKey: "editor.slashH6", descKey: "editor.slashH6Desc", section: "basics", hint: "######", keywords: ["h6", "heading", "ueberschrift"], apply: "###### " },
  { key: "ul", labelKey: "editor.slashUl", descKey: "editor.slashUlDesc", section: "basics", hint: "-", keywords: ["ul", "bullet", "list", "liste", "aufzaehlung", "unordered", "punkte"], apply: "- " },
  { key: "ol", labelKey: "editor.slashOl", descKey: "editor.slashOlDesc", section: "basics", hint: "1.", keywords: ["ol", "number", "numbered", "ordered", "nummeriert", "geordnet", "liste"], apply: "1. " },
  { key: "task", labelKey: "editor.slashTask", descKey: "editor.slashTaskDesc", section: "basics", hint: "- [ ]", keywords: ["task", "todo", "to-do", "checkbox", "aufgabe", "haken", "check"], apply: "- [ ] " },
  { key: "quote", labelKey: "editor.slashQuote", descKey: "editor.slashQuoteDesc", section: "basics", hint: ">", keywords: ["quote", "blockquote", "zitat"], apply: "> " },
  { key: "code", labelKey: "editor.slashCode", descKey: "editor.slashCodeDesc", section: "basics", hint: "```", keywords: ["code", "codeblock", "code-block", "snippet", "pre"], apply: wrap("```\n", "\n```", 4) },
  { key: "table", labelKey: "editor.slashTable", descKey: "editor.slashTableDesc", section: "basics", hint: "table", keywords: ["table", "tabelle", "grid", "spalten"], apply: openTablePicker },
  { key: "hr", labelKey: "editor.slashHr", descKey: "editor.slashHrDesc", section: "basics", hint: "---", keywords: ["hr", "divider", "trennlinie", "trenner", "rule", "horizontal", "linie"], apply: "---" },
  // Math + Mermaid (Part 2): insert the fenced/`$$` scaffold with the caret on
  // the empty middle line, so the user never has to remember the exact syntax.
  // The live/read renderers (mathMermaidLive, MarkdownReader) take over once the
  // caret leaves the block. Same three-line wrap() shape as the code block.
  { key: "math", labelKey: "editor.slashMath", descKey: "editor.slashMathDesc", section: "basics", hint: "$$", keywords: ["math", "mathe", "formel", "formula", "latex", "katex", "equation", "gleichung"], apply: wrap("$$\n", "\n$$", 3) },
  { key: "mermaid", labelKey: "editor.slashMermaid", descKey: "editor.slashMermaidDesc", section: "basics", hint: "mermaid", keywords: ["mermaid", "diagram", "diagramm", "flowchart", "flussdiagramm", "graph", "chart", "sequenz"], apply: wrap("```mermaid\n", "\n```", 11) },
  // --- Text formatieren / Inline formatting ---
  { key: "bold", labelKey: "editor.slashBold", descKey: "editor.slashBoldDesc", section: "format", hint: "**", keywords: ["bold", "fett", "strong"], apply: wrap("**", "**", 2) },
  { key: "italic", labelKey: "editor.slashItalic", descKey: "editor.slashItalicDesc", section: "format", hint: "*", keywords: ["italic", "kursiv", "emphasis"], apply: wrap("*", "*", 1) },
  { key: "strike", labelKey: "editor.slashStrike", descKey: "editor.slashStrikeDesc", section: "format", hint: "~~", keywords: ["strike", "strikethrough", "durchgestrichen", "durchstreichen"], apply: wrap("~~", "~~", 2) },
  { key: "inlinecode", labelKey: "editor.slashInlineCode", descKey: "editor.slashInlineCodeDesc", section: "format", hint: "`", keywords: ["inline", "code", "monospace", "kbd"], apply: wrap("`", "`", 1) },
  { key: "highlight", labelKey: "editor.slashHighlight", descKey: "editor.slashHighlightDesc", section: "format", hint: "==", keywords: ["highlight", "markierung", "mark", "hervorheben", "marker"], apply: wrap("==", "==", 2) },
  { key: "footnote", labelKey: "editor.slashFootnote", descKey: "editor.slashFootnoteDesc", section: "format", hint: "[^1]", keywords: ["footnote", "fussnote", "fußnote", "anmerkung", "quelle", "reference", "referenz"], apply: insertFootnote },
  // Emoji: opens the emoji picker at the caret (Editor listens for the event)
  // and inserts the chosen Unicode character — never a `:shortcode:` (see the
  // `:name` autocomplete in editorTriggers.ts for the rationale).
  { key: "emoji", labelKey: "editor.slashEmoji", descKey: "editor.slashEmojiDesc", section: "format", hint: "😊", keywords: ["emoji", "smiley", "emoticon", "reaction", "symbol", "gefühl", "gesicht", "zeichen"], apply: clearAndEmit("plainva-open-emoji-picker") },
  // --- Verknüpfen & Einbetten / Links & media ---
  { key: "link", labelKey: "editor.slashLink", descKey: "editor.slashLinkDesc", section: "media", hint: "[](url)", keywords: ["link", "url", "hyperlink", "extern", "external"], apply: wrap("[", "](url)", 1) },
  { key: "wikilink", labelKey: "editor.slashWikiLink", descKey: "editor.slashWikiLinkDesc", section: "media", hint: "[[ ]]", keywords: ["wikilink", "wiki", "internal", "intern", "interner", "verknuepfung", "note", "verlinken", "suche", "search"], apply: insertAndComplete("[[") },
  { key: "image", labelKey: "editor.slashImage", descKey: "editor.slashImageDesc", section: "media", hint: "![](url)", keywords: ["image", "bild", "picture", "foto", "grafik", "img", "extern", "web"], apply: wrap("![", "](url)", 2) },
  { key: "internalimage", labelKey: "editor.slashInternalImage", descKey: "editor.slashInternalImageDesc", section: "media", hint: "![[ ]]", keywords: ["image", "bild", "intern", "internal", "vault", "datei", "attachment", "embed", "suche"], apply: insertAndComplete("![[") },
  { key: "embed", labelKey: "editor.slashEmbed", descKey: "editor.slashEmbedDesc", section: "media", hint: "![[ ]]", keywords: ["embed", "einbetten", "einbettung", "transclude", "include", "attachment"], apply: insertAndComplete("![[") },
  { key: "embedbase", labelKey: "editor.slashEmbedBase", descKey: "editor.slashEmbedBaseDesc", section: "media", hint: "![[.base]]", keywords: ["base", "database", "datenbank", "db", "tabelle", "embed", "einbetten"], apply: openBasePicker },
  { key: "newbase", labelKey: "editor.slashNewBase", descKey: "editor.slashNewBaseDesc", section: "media", hint: "+ .base", keywords: ["base", "database", "datenbank", "db", "neu", "new", "inline"], apply: createInlineBase },
  // --- Dokument / Document-level presentation (W3) ---
  { key: "icon", labelKey: "editor.slashDocIcon", descKey: "editor.slashDocIconDesc", section: "document", hint: "", keywords: ["icon", "symbol", "dokument", "document"], apply: clearAndEmit("plainva-open-icon-picker") },
  { key: "headercolor", labelKey: "editor.slashHeaderColor", descKey: "editor.slashHeaderColorDesc", section: "document", hint: "", keywords: ["header", "farbe", "color", "farbstreifen", "streifen", "banner", "cover", "kopf"], apply: clearAndEmit("plainva-open-header-color") },
  // --- Callouts (Obsidian) --- generated from CALLOUT_VARIANTS, canonical markers.
  ...CALLOUT_VARIANTS.map(
    (v): SlashDef => ({
      key: `callout-${v.type}`,
      labelKey: v.labelKey,
      descKey: v.descKey,
      section: "callouts",
      hint: `[!${v.type}]`,
      keywords: v.keywords,
      apply: `> [!${v.type}] `,
    }),
  ),
];

function defToCompletion(def: SlashDef): SlashCompletion {
  const completion: SlashCompletion = {
    label: i18n.t(def.labelKey),
    type: def.key,
    section: { name: i18n.t(SECTION_LABEL_KEY[def.section]), rank: SECTION_RANK[def.section] },
    apply: def.apply,
    description: i18n.t(def.descKey),
  };
  if (def.hint) completion.detail = def.hint;
  return completion;
}

// All slash commands, in display order. Used when the query is just `/`.
export function getSlashCommands(): SlashCompletion[] {
  return DEFS.map(defToCompletion);
}

// True when `def` matches the (already lowercased, slash-stripped) query. We use
// word-prefix matching (key / keywords / each word of the localized title starts
// with the query) — that mirrors Notion and avoids accidental mid-word hits
// (e.g. "/h" should not match "paragrap_h_"). Empty query matches everything.
function defMatches(def: SlashDef, query: string): boolean {
  if (!query) return true;
  if (def.key.startsWith(query)) return true;
  if (def.keywords.some((k) => k.startsWith(query))) return true;
  return i18n
    .t(def.labelKey)
    .toLowerCase()
    .split(/\s+/)
    .some((word) => word.startsWith(query));
}

// Dynamically narrow the command list by what was typed after `/`.
// Exposed for unit testing requirement #4.
export function filterSlashCommands(query: string): SlashCompletion[] {
  const q = query.replace(/^\//, "").trim().toLowerCase();
  return DEFS.filter((def) => defMatches(def, q)).map(defToCompletion);
}

export function slashCommandCompletion(context: CompletionContext): CompletionResult | null {
  // `\p{L}` keeps umlauts (e.g. "/über") matchable; the `u` flag enables it.
  const word = context.matchBefore(/\/[\p{L}\p{N}_-]*/u);
  if (!word) return null;
  if (word.from === word.to && !context.explicit) return null;

  return {
    from: word.from,
    // We filter ourselves (by title/keywords, not just the label), so disable
    // CodeMirror's own matching. No `validFor` => the source re-runs on every
    // keystroke, keeping the list in sync as the user types.
    filter: false,
    options: filterSlashCommands(word.text),
  };
}

export const slashCommandPlugin = () => {
  return autocompletion({
    override: [slashCommandCompletion],
    activateOnTyping: true,
    // Replace CodeMirror's built-in icon column with our themed icon + a Notion
    // style description line.
    icons: false,
    addToOptions: [
      { render: (completion) => renderSlashIcon(completion.type ?? "text"), position: 20 },
      { render: (completion) => renderSlashDescription((completion as SlashCompletion).description), position: 70 },
    ],
  });
};
