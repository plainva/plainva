/**
 * Wiki links as a construct of the Markdown tokenizer (finding 2026-10-11).
 *
 * `[[Note]]` and `![[Note]]` used to be looked for in the text the parser had
 * finished: in the value of each text node, after emphasis, code spans and
 * character references had been read. Whatever Markdown reads something into
 * was gone by then. `[[_private_]]` was two brackets, an emphasis and two
 * brackets; `[[_x]] and [[y_]]` one emphasis across both links; an alias with
 * a code span three pieces. None of them was a link for the index — no
 * backlink, no edge in the graph, and a rename left them on the old name. And
 * `[[Tom &amp; Jerry]]` was listed as a link to "Tom & Jerry", which is not
 * what the line says and not where a click on it leads.
 *
 * Here the link is read where the tokenizer reads a code span or an HTML tag:
 * from the left, before anything is read INTO it. What stands between the
 * brackets is a file's name, an anchor and an alias — text, not Markdown —
 * and reaches the tree as it stands in the note.
 *
 * The form is the one the scan over the text values knew: `[[`, then anything
 * but a line end up to the first `]]`; a `!` right in front makes it an embed.
 * A single `]` may stand inside, and nothing at all may.
 *
 * What starts further left wins, as between any two such constructs: a link
 * inside a code span, an HTML tag or an address in angle brackets is none,
 * and a bracket behind a backslash (`\[[Note]]`) opens none. What starts here
 * takes its line up to the `]]`: `[[1]](https://example.com)` is a wiki link
 * and a text in parentheses, not a Markdown link with the label `[1]`.
 *
 * No Markdown parser is imported here (`markdownParseSites.test.ts`): the
 * tokenizer's codes and the two calls a construct makes are spelled out.
 */

/** A character as the tokenizer hands it over: a code point, a negative code for a line end or a tab, null at the end. */
type Code = number | null;
type State = (code: Code) => State | undefined;

interface Effects {
  enter(type: string): unknown;
  exit(type: string): unknown;
  consume(code: Code): void;
}

interface TokenizeContext {
  now(): { offset: number };
  /** One object per parse, shared by every tokenizer of it. */
  parser: object;
}

const EXCLAMATION_MARK = 33;
const LEFT_SQUARE_BRACKET = 91;
const RIGHT_SQUARE_BRACKET = 93;

/** A line end arrives as -5 (CR), -4 (LF) or -3 (CRLF); -2 and -1 are a tab and its filler. */
const endsLine = (code: Code): boolean => code === null || code < -2;

const TOKEN = "wikiLink";

/**
 * Per parse: the stretch of one line in which a `[[` was followed to the line
 * end without a `]]`. Every `[[` further right in that stretch ends the same
 * way, so it is not followed again — a line that is a long run of `[` is read
 * once, not once per bracket.
 */
const withoutClose = new WeakMap<object, { from: number; until: number }>();

function tokenizeWikiLink(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  // eslint-disable-next-line @typescript-eslint/no-this-alias -- a tokenizer is called with its context as `this`
  const self = this;
  let from = 0;

  const start: State = (code) => {
    from = self.now().offset;
    const known = withoutClose.get(self.parser);
    if (known && from >= known.from && from < known.until) return nok(code);
    effects.enter(TOKEN);
    if (code !== EXCLAMATION_MARK) return first(code);
    effects.consume(code);
    return first;
  };

  const first: State = (code) => {
    if (code !== LEFT_SQUARE_BRACKET) return nok(code);
    effects.consume(code);
    return second;
  };

  const second: State = (code) => {
    if (code !== LEFT_SQUARE_BRACKET) return nok(code);
    effects.consume(code);
    return inside;
  };

  const inside: State = (code) => {
    if (endsLine(code)) {
      withoutClose.set(self.parser, { from, until: self.now().offset });
      return nok(code);
    }
    effects.consume(code);
    return code === RIGHT_SQUARE_BRACKET ? closing : inside;
  };

  const closing: State = (code) => {
    if (code !== RIGHT_SQUARE_BRACKET) return inside(code);
    effects.consume(code);
    effects.exit(TOKEN);
    return ok;
  };

  return start;
}

const construct = { name: TOKEN, tokenize: tokenizeWikiLink };

/**
 * The syntax extension. A construct of an extension is tried before the ones
 * the tokenizer already has for the same character, so `[[` is asked first
 * whether it is a wiki link, and only then whether it opens a link label.
 */
export const wikiLinkSyntax = {
  text: {
    [EXCLAMATION_MARK]: construct,
    [LEFT_SQUARE_BRACKET]: construct,
  },
};

/** A wiki link in the tree, as the tree builder makes it. */
interface BuiltWikiLink {
  type: "wikiLink";
  value: string;
  embed: boolean;
}

interface CompileContext {
  stack: unknown[];
  enter(node: BuiltWikiLink, token: unknown): void;
  exit(token: unknown): void;
  sliceSerialize(token: unknown): string;
}

/** The tree builder's part: one node per link, holding the link as it stands in the note. */
export const wikiLinkFromMarkdown = {
  enter: {
    [TOKEN](this: CompileContext, token: unknown): void {
      this.enter({ type: "wikiLink", value: "", embed: false }, token);
    },
  },
  exit: {
    [TOKEN](this: CompileContext, token: unknown): void {
      const node = this.stack[this.stack.length - 1] as BuiltWikiLink;
      node.value = this.sliceSerialize(token);
      node.embed = node.value.charCodeAt(0) === EXCLAMATION_MARK;
      this.exit(token);
    },
  },
};

/**
 * The way back, for a tree that is written out: the link as it stands in its
 * node — what is between its brackets is no Markdown to escape. `peek` tells
 * the text in front what follows, so that a `!` at its end gets its backslash
 * and does not turn the link into an embed.
 */
const writeWikiLink = Object.assign((node: { value: string }): string => node.value, {
  peek: (node: { value: string }): string => node.value.charAt(0),
});
export const wikiLinkToMarkdown = { handlers: { [TOKEN]: writeWikiLink } };

interface ProcessorData {
  micromarkExtensions?: unknown[];
  fromMarkdownExtensions?: unknown[];
  toMarkdownExtensions?: unknown[];
}

/**
 * The plugin form, for a processor that parses Markdown, writes it, or both:
 * it hands each of them its part, the way the table and footnote plugin does.
 */
export function remarkWikiLinks(this: { data(): unknown }): void {
  const data = this.data() as ProcessorData;
  (data.micromarkExtensions ??= []).push(wikiLinkSyntax);
  (data.fromMarkdownExtensions ??= []).push(wikiLinkFromMarkdown);
  (data.toMarkdownExtensions ??= []).push(wikiLinkToMarkdown);
}
