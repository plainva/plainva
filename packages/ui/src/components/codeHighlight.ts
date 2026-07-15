import { LanguageDescription, defaultHighlightStyle } from "@codemirror/language";
import { languages as codeLanguages } from "@codemirror/language-data";
import { highlightCode, type Highlighter } from "@lezer/highlight";

import { markdownHighlightStyle } from "./MarkdownTheme";

/**
 * Static syntax highlighting for read-mode fenced code blocks (issue #13).
 *
 * The live editor already highlights code inside ```lang fences: it wires
 * `markdown({ base, codeLanguages })` (grammar lazy-loaded per language from
 * @codemirror/language-data) and paints tokens with basicSetup's
 * `defaultHighlightStyle` plus the app's `markdownHighlightStyle` overrides
 * (keyword → accent, comment → muted, …). The read view (MarkdownReader ->
 * CodeBlock) rendered a plain monospace block instead, so highlighting stopped
 * at the preview boundary.
 *
 * This helper reproduces the editor's highlighting statically so the read view
 * matches it exactly: it resolves the fence language from the SAME
 * `codeLanguages` table, parses the snippet with that grammar and tokenizes it
 * with the SAME two highlighters. Nothing here touches the editor.
 */

/** One highlighted run of code: `cls` is empty for unstyled text. */
export interface HighlightedToken {
  text: string;
  cls: string;
}

/**
 * The editor renders `syntaxHighlighting(defaultHighlightStyle, { fallback: true })`
 * (via basicSetup) with `markdownHighlightStyle` layered on top at Prec.highest.
 * That is override-then-fallback: the markdown style wins for the handful of
 * tags it defines, the default style fills in the rest. `highlightCode` merges
 * multiple highlighters by CONCATENATING their classes, so we express the same
 * precedence explicitly with a single first-match-wins highlighter instead.
 */
const readerHighlighter: Highlighter = {
  style: (tags) => markdownHighlightStyle.style(tags) ?? defaultHighlightStyle.style(tags),
};

let stylesInjected = false;

/**
 * Inject the two highlight styles' CSS rules once, so the atomic class names
 * returned by `.style(tags)` resolve in the read view even when no editor is
 * mounted (read-only mode, embeds, managed index.md). Both modules are also
 * mounted by the editor when present; duplicate identical rules are harmless.
 */
function ensureHighlightStyles(): void {
  if (stylesInjected || typeof document === "undefined") return;
  stylesInjected = true;
  const rules = [defaultHighlightStyle.module, markdownHighlightStyle.module]
    .map((mod) => mod?.getRules() ?? "")
    .filter(Boolean)
    .join("\n");
  if (!rules) return;
  const el = document.createElement("style");
  el.setAttribute("data-plainva-code-highlight", "");
  el.textContent = rules;
  document.head.appendChild(el);
}

/**
 * Tokenize `code` for the read view using the grammar named by the fence info
 * string (`css`, `html`, `js`, `python`, …), matched exactly like the editor.
 *
 * Resolves to `null` when there is no language, the language is unknown, or the
 * grammar fails to load/parse — the caller then renders a plain block. The
 * grammar loads on demand (dynamic import via @codemirror/language-data) and is
 * cached by CodeMirror, so the second block in the same language is synchronous.
 */
export async function highlightCodeToTokens(
  code: string,
  lang: string | undefined,
): Promise<HighlightedToken[] | null> {
  if (!lang) return null;
  const description = LanguageDescription.matchLanguageName(codeLanguages, lang, true);
  if (!description) return null;

  let support;
  try {
    support = await description.load();
  } catch {
    return null;
  }

  try {
    const tree = support.language.parser.parse(code);
    ensureHighlightStyles();
    const tokens: HighlightedToken[] = [];
    highlightCode(
      code,
      tree,
      readerHighlighter,
      (text, cls) => tokens.push({ text, cls }),
      () => tokens.push({ text: "\n", cls: "" }),
    );
    return tokens;
  } catch {
    return null;
  }
}
