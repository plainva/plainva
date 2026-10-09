# Text scanning

Plainva reads a lot of text it did not write: notes from a synced vault, mail
headers and bodies, calendar and task data from providers, server responses,
imports, comments from publication guests. A regular expression that
backtracks or moves super-linearly turns one hostile string into a frozen
window. In September 2026 code scanning found nineteen such patterns within
five days — one of them exponential: an `<input -="" -="" … !>` in an event
description or a guest comment stopped the reader. This page is the rule that
keeps the class closed.

## Rules

1. **Text scans are linear.** Trimming, delimiters, links, tags and line
   grammars go through the shared scanners, not through ad-hoc patterns:
   - `packages/core/src/textScan.ts` — `trimChars`, `trimStartChars`,
     `trimEndChars`, `trimSpaceBeforeLineEnds` (the one-pass form of
     `/[ \t]+$/gm`), `delimitedText`, `replaceDelimited`, `firstAngleValue`,
     `markdownLinks`, `codeSpanRanges`;
   - `packages/core/src/markdownListItem.ts` — one list-item reader for the
     editor's list continuation and both copy converters, in the two grammars
     they speak;
   - `packages/core/src/markdownBlockLine.ts` — ATX heading and blockquote
     lines for both copy converters, and `peelBlockquotes` for nested quotes;
   - `packages/core/src/linkScan.ts` — wiki and Markdown link scanners
     (`wikiLinks`, `bracketLinks`, `replaceBracketLinks`, the matchers and the
     `nextWhere` cursor they are built on), used by the editor plugins, the
     inline renderer, the importers, publications and the reader;
   - `packages/core/src/frontmatter-block.ts` — the properties block at the top
     of a note: `frontmatterSpan` for where it is, `noteBodyOf` for the text
     behind it. Every reader and writer asks there; a pattern or a search of
     one's own for the two `---` lines fails `frontmatterDefinition.test.ts`.
     The editor holds lines, not a string, and reads the same rule on them in
     one place, `frontmatterLines` in
     `packages/ui/src/components/editorFrontmatter.ts` — kept per document, so
     no part of the editor scans the lines for itself on a transaction;
   - `packages/core/src/vault/htmlCheckbox.ts` — the tag tokenizer behind the
     HTML task box, shared by both renderers and the writer;
   - `packages/core/src/vault/filterComparison.ts` — the `column op "value"`
     filter of a `.base`, for the evaluator and the config panel;
   - `packages/core/src/mailText.ts` and `packages/core/src/pim/davTagScan.ts`
     — sender names, `.eml` links, and the CalDAV tags read as text.
2. **No super-linear regular expressions.** `pnpm lint` runs
   `regexp/no-super-linear-backtracking` and `regexp/no-super-linear-move`
   (`eslint-plugin-regexp`) as errors on the shipped sources of
   `packages/core`, `packages/ui`, `apps/desktop` and `apps/mobile`. Tests are
   exempt: they scan the repository's own files.
3. **Replacing a pattern keeps its behaviour.** The existing tests are the
   yardstick and stay unchanged. Where a pattern had a quirk, the replacement
   keeps it; a differential run against the old pattern on generated input is
   the proof, and a test with a hostile input (a long ambiguous run plus a
   rejecting suffix, about 100 000 characters) and a time budget pins the
   linear time.
4. **An inline exception is rare and says why.** `eslint-disable-next-line
   regexp/…` only where the input provably cannot come from a user or from
   outside, with that reason in the comment.

## Shapes that pass the lint

- One quantifier per ambiguous stretch: `[ \t](.*)$` plus a linear trim of the
  capture instead of `[ \t]+(.*)$`.
- Anchored patterns whose runs cannot trade characters (`^\s*` followed by a
  character `\s` cannot match).
- A hand-written scanner with tables built once per line (next closer, next
  line break) where the pattern would retry the rest of the line from every
  opener — see the tag rule's blanking in `packages/core/src/tagRule.ts`.
