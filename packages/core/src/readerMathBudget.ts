/**
 * The reading view's formulas, bounded by what KaTeX makes of them (reviews
 * of 2026-11-17). KaTeX holds far more while it lays formulas out than the
 * parse of their source, and what a formula makes differs by a factor of
 * three and more between an ordinary sum and a matrix of the same length:
 * weighed by its source, a budget calibrated at the dearest shape cut
 * ordinary lecture notes to a third of what `main` laid out. So the
 * formulas are charged by what they produced: this step stands in for the
 * rehype step that lays them out (`rehype-katex`, handed in as `layout`),
 * lays the formulas out one at a time in the order of the note, counts the
 * nodes each one produced, and once they hold more than `MATH_NODE_BUDGET`
 * leaves the formula that crossed it and every later one as its source.
 *
 * One estimate stays, ahead of the layout: a single formula's memory while
 * KaTeX lays it out — a matrix of 8 000 characters alone ran 128 MB out —
 * is spent before anything can be counted. So a formula whose dearest case
 * (`MATH_WORST_NODES_PER_CHAR` for each character of its source, the dearest
 * known shape) would not fit into what is left of the budget is not laid
 * out at all.
 */

/**
 * The most nodes KaTeX may produce for the formulas of one note. Calibrated
 * (`scripts/perf/reader-math.ts calibrate`, `main` ee8f2a950, 2026-11-17):
 * the most formulas `main` lays out under 128 MB made 123 860 to 128 289
 * nodes in every ordinary shape — inline, display, in table cells, in
 * footnotes, in a list — so what KaTeX made is a measure that holds across
 * them. `main` holds each string KaTeX writes as often as it writes it; held
 * once here (`countAndLighten`), the same formulas cost less, and at this
 * budget every formula `main` lays out under 128 MB is laid out, and a note
 * of three times as many stays under 128 MB, in each shape.
 */
export const MATH_NODE_BUDGET = 132_000;

/**
 * What one character of a formula's source may cost KaTeX to lay out, in
 * nodes of the budget: from the dearest known shape, a matrix of one row
 * (`\begin{matrix}a&a&…`), whose memory while it is laid out is spent
 * before anything can be counted and which `main` lays out alone up to
 * 7 704 characters under 128 MB (an array of 400 columns up to 8 169).
 */
export const MATH_WORST_NODES_PER_CHAR = 17;

/** A node of a hast tree, as far as this step reads it. */
export interface MathHastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: MathHastNode[];
}

/** The rehype step that lays out the formulas of a tree (`rehype-katex`'s transformer). */
export type MathLayout = (tree: MathHastNode, file: unknown) => void;

export interface ReaderMathBudgetOptions {
  /** Lays out the formulas of a tree in place: `rehypeKatex()` (`rehype-katex`). */
  layout: MathLayout;
  /** The most nodes the formulas may produce (`MATH_NODE_BUDGET`). */
  budget?: number;
  /** Shown once at the top of the note when a formula stays as its source. */
  notice?: string;
}

const MATH_CLASSES = ["language-math", "math-display", "math-inline"];

function classesOf(node: MathHastNode): unknown[] {
  const names = node.properties?.className;
  return Array.isArray(names) ? names : [];
}

function isMathElement(node: MathHastNode): boolean {
  return node.type === "element" && classesOf(node).some((name) => MATH_CLASSES.includes(name as string));
}

/** The element a formula stands in: a `<pre>` around `code.language-math` (display), else the math element itself. */
function mathScope(node: MathHastNode): boolean {
  if (node.type !== "element") return false;
  if (node.tagName === "pre") return (node.children ?? []).some((child) => child.type === "element" && child.tagName === "code" && classesOf(child).includes("language-math"));
  return isMathElement(node);
}

function textLength(node: MathHastNode): number {
  if (node.type === "text") return (node.value ?? "").length;
  let length = 0;
  for (const child of node.children ?? []) length += textLength(child);
  return length;
}

/** How many nodes a laid-out formula holds: every element and every text. */
export function mathNodeCount(nodes: readonly MathHastNode[]): number {
  let count = 0;
  const stack = [...nodes];
  while (stack.length > 0) {
    const node = stack.pop()!;
    count++;
    if (node.children) for (const child of node.children) stack.push(child);
  }
  return count;
}

/**
 * Counts the nodes of a laid-out formula and makes them lighter: their
 * places (KaTeX's HTML is parsed into the tree with a place for each node in
 * that HTML, which nothing reads) go, and the strings KaTeX writes over and
 * over — class names, styles — are held once (`strings`).
 */
function countAndLighten(nodes: readonly MathHastNode[], strings: Map<string, string>): number {
  const once = (value: string): string => {
    const held = strings.get(value);
    if (held !== undefined) return held;
    strings.set(value, value);
    return value;
  };
  let count = 0;
  const stack = [...nodes];
  while (stack.length > 0) {
    const node = stack.pop()! as MathHastNode & { position?: unknown };
    count++;
    if (node.position !== undefined) delete node.position;
    const properties = node.properties;
    if (properties) {
      for (const key of Object.keys(properties)) {
        const value = properties[key];
        if (typeof value === "string") properties[key] = once(value);
        else if (Array.isArray(value)) for (let i = 0; i < value.length; i++) if (typeof value[i] === "string") value[i] = once(value[i] as string);
      }
    }
    if (node.type === "text" && node.value !== undefined && node.value.length < 16) node.value = once(node.value);
    if (node.children) for (const child of node.children) stack.push(child);
  }
  return count;
}

/** Leaves a formula as its source: code, without the classes that ask for a layout. */
function asSource(node: MathHastNode): void {
  if (node.type !== "element") return;
  const names = classesOf(node).filter((name) => !MATH_CLASSES.includes(name as string));
  node.properties = { ...node.properties, className: [...names, "math-source"] };
  for (const child of node.children ?? []) asSource(child);
}

/**
 * Lays out the formulas of `tree` in the order of the note while what they
 * produced holds `budget` nodes or fewer, and leaves the rest as their
 * source. Returns how many it left as their source.
 */
export function boundReaderMath(tree: MathHastNode, file: unknown, layout: MathLayout, budget = MATH_NODE_BUDGET): number {
  let used = 0;
  let left = 0;
  let full = false;
  const strings = new Map<string, string>();
  const walk = (parent: MathHastNode) => {
    const children = parent.children;
    if (!children) return;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (!mathScope(child)) {
        walk(child);
        continue;
      }
      // The dearest case of this formula alone must fit into what is left: its layout's memory is spent before it can be counted.
      if (full || textLength(child) * MATH_WORST_NODES_PER_CHAR > budget - used) {
        asSource(child);
        left++;
        continue;
      }
      const alone: MathHastNode = { type: "root", children: [child] };
      layout(alone, file);
      const made = alone.children ?? [];
      const nodes = countAndLighten(made, strings);
      if (used + nodes > budget) {
        // The formula that crosses the budget stays as its source, and so does every later one.
        full = true;
        asSource(child);
        left++;
        continue;
      }
      used += nodes;
      children.splice(i, 1, ...made);
      i += made.length - 1;
    }
  };
  walk(tree);
  return left;
}

/** The element the notice stands in, for the reading view to draw as its notice (a `Banner`). */
export const READER_NOTICE_TAG = "reader-notice";

/**
 * The rehype step of the reading view, in place of `rehype-katex`:
 * `boundReaderMath` with KaTeX's own step. When a formula stays as its
 * source, `options.notice` stands once at the top of the note and
 * `file.data.mathLeftAsSource` counts them.
 */
export function rehypeReaderMath(options: ReaderMathBudgetOptions) {
  return (tree: MathHastNode, file: { data?: Record<string, unknown> }) => {
    const left = boundReaderMath(tree, file, options.layout, options.budget ?? MATH_NODE_BUDGET);
    if (left === 0) return;
    if (file.data) file.data.mathLeftAsSource = left;
    if (options.notice) {
      tree.children = [
        { type: "element", tagName: READER_NOTICE_TAG, properties: {}, children: [{ type: "text", value: options.notice }] },
        ...(tree.children ?? []),
      ];
    }
  };
}
