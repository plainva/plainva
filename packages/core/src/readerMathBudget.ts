/**
 * The reading view's formulas, bounded where they are made (review,
 * 2026-11-17). KaTeX holds far more while it lays a formula out than the
 * parse of the formula's source: every formula shape of the table
 * calibration reads at three times its limit under 128 MB without KaTeX, and
 * runs out of memory there with it. Weighed before the parse — by hand or
 * with a parser of their own — formulas came out wrong or expensive in ten
 * reviews in a row: a price, a `$` in code, a reference definition, a padded
 * `$ x $` each read differently there than in the reading view. So the table
 * budget weighs a table's structure alone, and this step, between
 * remark-math and rehype-katex, weighs the formulas of the tree the reading
 * view really parsed: each `inlineMath` and `math` node, in the order of the
 * note, `MATH_CHAR_WEIGHT` for each character of its source, its `$`
 * included. Once the formulas weigh more than `MATH_BUDGET`, every further
 * one stays as its source, as code: KaTeX never sees it, and a table stays a
 * table.
 */

/**
 * What each character of a formula's source weighs, its `$` included: chosen
 * from the formula shapes of the table calibration
 * (`scripts/perf/table-budget.ts`, limits under 128 MB with KaTeX,
 * 2026-11-15), so that the largest table of each shape KaTeX lays out within
 * 128 MB weighs at least 1.3 × the budget by its formulas alone. The matrix
 * of sixty cells decides it (105 rows of 149 characters: 1.35 ×); a hundred
 * `$a$` per row (88 rows) weighs 2.3 ×, forty fractions in one formula,
 * thirty `\overbrace`, an integral per row and forty `$\frac{a}{b}$` per
 * row more. The table around them weighs on its own (`TABLE_READ_BUDGET`).
 */
export const MATH_CHAR_WEIGHT = 600;

/** The most the formulas of one note may weigh and all be laid out by KaTeX. */
export const MATH_BUDGET = 6_970_000;

interface MathNode {
  type: string;
  value?: string;
  children?: MathNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
  data?: unknown;
  lang?: string | null;
  meta?: string | null;
}

/** What a formula of `source` characters weighs (`MATH_CHAR_WEIGHT`). */
export function mathWeight(source: number): number {
  return MATH_CHAR_WEIGHT * source;
}

/**
 * Bounds the formulas of `tree` (an mdast tree remark-math parsed `text`
 * into): formulas in the order of the note while they weigh `budget` or less
 * together, every later one as its source — an `inlineMath` as inline code,
 * a `math` block as a code block. Returns how many it left as their source.
 */
export function boundReaderMath(tree: MathNode, text: string, budget = MATH_BUDGET): number {
  let weight = 0;
  let left = 0;
  const walk = (node: MathNode) => {
    const children = node.children;
    if (!children) return;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child.type === "inlineMath" || child.type === "math") {
        const fence = child.type === "math" ? "$$" : "$";
        const from = child.position?.start.offset;
        const to = child.position?.end.offset;
        const placed = from !== undefined && to !== undefined && to >= from;
        // The length of its source from the tree's places, so that it weighs the same with or without the text at hand.
        weight += mathWeight(placed ? to - from : (child.value ?? "").length + 2 * fence.length);
        if (weight > budget) {
          left++;
          const source = placed && to <= text.length ? text.slice(from, to) : `${fence}${child.value ?? ""}${fence}`;
          children[i] = child.type === "math" ? { type: "code", lang: null, meta: null, value: source, position: child.position } : { type: "inlineCode", value: source, position: child.position };
        }
        continue;
      }
      walk(child);
    }
  };
  walk(tree);
  return left;
}

/**
 * The remark step of the reading view (behind remark-math, ahead of
 * rehype-katex): `boundReaderMath` on the tree, with the text it was parsed
 * from. `file.data.mathLeftAsSource` counts the formulas left as source.
 */
export function remarkReaderMathBudget() {
  return (tree: MathNode, file: { value?: unknown; data: Record<string, unknown> }) => {
    const left = boundReaderMath(tree, String(file.value ?? ""));
    if (left > 0) file.data.mathLeftAsSource = left;
  };
}
