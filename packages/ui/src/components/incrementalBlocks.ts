import { language, syntaxTree } from "@codemirror/language";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { StateField, type EditorSelection, type EditorState, type Extension, type Range, type Transaction } from "@codemirror/state";

/**
 * Block widgets that move with the text (performance plan L6, finding B7).
 *
 * Tables, Mermaid diagrams, `$$` blocks and ```tasks queries change line
 * heights, so they come from state fields. Each field used to find every block
 * of the note again on every caret move and every keystroke: a walk over the
 * whole syntax tree, a new table model, a new widget. In a note of 20 000
 * lines that took longer than a frame for each field.
 *
 * Here a field keeps what it found. A caret move re-decides only the blocks the
 * old or the new selection touches (the caret entering or leaving a block is
 * what flips it between widget and source). An edit maps the blocks through the
 * change and looks again only in the top-level blocks of the note that the
 * change can have altered (`planBlockRescan`). The decorations stay exactly the
 * ones a search from scratch gives: `incrementalBlocks.test.ts` holds every
 * field against its from-scratch result over thousands of random edits.
 */

/** A node of the syntax tree (its type, without a dependency on Lezer itself). */
export type SyntaxNode = ReturnType<typeof syntaxTree>["topNode"];
/** The cursor a node hands out - what `Tree.iterate` passes to `enter`. */
export type NodeCursor = ReturnType<SyntaxNode["cursor"]>;

/**
 * Visit `node` and every node below it, with the descent rule of
 * `Tree.iterate`: `enter` returning false skips the node's children. Like
 * `iterate`, anonymous nodes are passed through (their children are visited)
 * and mounted trees are entered, so a search per top-level node finds exactly
 * what one `iterate` over the whole tree finds in that node.
 */
export function walkSubtree(node: SyntaxNode, enter: (n: NodeCursor) => boolean | void): void {
  const c = node.cursor();
  let depth = 0;
  for (;;) {
    if (enter(c) !== false && c.firstChild()) {
      depth++;
      continue;
    }
    for (;;) {
      if (depth === 0) return;
      if (c.nextSibling()) break;
      c.parent();
      depth--;
    }
  }
}

/** What an edit or a parse step asks a block field to look at again. */
export interface BlockRescan {
  /** The parser itself changed: search from scratch. */
  readonly all: boolean;
  /**
   * Rescan the top-level nodes of the new tree that START in one of these
   * ranges (new positions, half-open, `to` may be Infinity; both bounds are
   * line starts). Every block a field finds lies inside one top-level node.
   */
  readonly ranges: ReadonlyArray<{ readonly from: number; readonly to: number }>;
  /** The first rescanned position, Infinity when nothing is rescanned. */
  readonly from: number;
  /** Where the rescanned stretch ends (Infinity: up to the end of the note). */
  readonly to: number;
  /** New minus old document length: a position at or after `to` moved by exactly this. */
  readonly delta: number;
  /**
   * An old block (old positions, inside one top-level node): its new range when
   * it lies outside every rescanned range, otherwise null.
   */
  keep(from: number, to: number): { from: number; to: number } | null;
}

const RESCAN_ALL: BlockRescan = { all: true, ranges: [], from: 0, to: Infinity, delta: 0, keep: () => null };

/**
 * Which top-level nodes of the note a transaction can have changed.
 *
 * The Markdown parser reads a note line by line, and between two top-level
 * blocks it carries nothing but the position. So:
 *
 * - Before the change, every top-level node stays as it was except the last
 *   one that starts before the changed line - its end is decided by the line
 *   after it, which may be the changed one. The rescan starts there (`S`).
 * - After the change, the first top-level node that starts behind the change
 *   and has the same type and the same (moved) range as a node of the old tree
 *   proves that both parses agree from there on: same state, same text. The
 *   rescan ends there (`E`). A fence or a comment opened by the edit runs on
 *   to the end of the note, and so does the rescan.
 * - An incomplete parse (the editor parses a long note in steps) has a last
 *   node that may be cut off, and nothing after it. From the old tree's last
 *   node, or the new tree's, on everything is looked at again (`T`).
 *
 * A step of the background parse changes the tree without changing the text:
 * only that last part is new. A new parser (another language configuration) is
 * a search from scratch. A code language loading later only mounts a tree
 * inside a fence; no field looks inside fences for its blocks (no grammar but
 * the note's own has tables), so nothing needs to be looked at again.
 */
export function planBlockRescan(tr: Transaction): BlockRescan | null {
  const oldTree = syntaxTree(tr.startState);
  const newTree = syntaxTree(tr.state);
  if (!tr.docChanged && oldTree === newTree) return null;
  if (tr.startState.facet(language) !== tr.state.facet(language)) return RESCAN_ALL;
  const delta = tr.state.doc.length - tr.startState.doc.length;
  const newTop = newTree.topNode;

  let S = Infinity;
  let E = Infinity;
  let oldE = Infinity;
  if (tr.docChanged) {
    let fromA = Infinity;
    let toA = -1;
    let fromB = Infinity;
    let toB = -1;
    tr.changes.iterChangedRanges((fa, ta, fb, tb) => {
      if (fa < fromA) fromA = fa;
      if (ta > toA) toA = ta;
      if (fb < fromB) fromB = fb;
      if (tb > toB) toB = tb;
    });
    const lineStart = lineStartOf(tr.state, fromB);
    const before = newTop.childBefore(lineStart);
    S = before ? lineStartOf(tr.state, before.from) : 0;
    const oldTop = oldTree.topNode;
    for (let node = before ?? newTop.firstChild; node; node = node.nextSibling) {
      if (node.from < toB) continue;
      const oldFrom = node.from - delta;
      if (oldFrom < toA) continue;
      const old = oldTop.childAfter(oldFrom);
      if (old && old.from === oldFrom && old.to + delta === node.to && old.type === node.type) {
        // Behind the change every position moved by `delta`, line starts too.
        E = lineStartOf(tr.state, node.from);
        oldE = E - delta;
        break;
      }
    }
  }

  let T = Infinity;
  if (oldTree.length < tr.startState.doc.length) {
    const last = oldTree.topNode.lastChild;
    const at = tr.changes.mapPos(last ? lineStartOf(tr.startState, last.from) : 0, 1);
    const node = newTop.childAfter(at);
    T = Math.min(T, lineStartOf(tr.state, node ? Math.min(node.from, at) : at));
  }
  if (newTree.length < tr.state.doc.length) {
    const last = newTop.lastChild;
    T = Math.min(T, last ? lineStartOf(tr.state, last.from) : 0);
  }

  const ranges: Array<{ from: number; to: number }> = [];
  if (S !== Infinity) ranges.push({ from: S, to: E });
  if (T !== Infinity) {
    if (ranges.length && T <= E) ranges[0] = { from: Math.min(S, T), to: Infinity };
    else ranges.push({ from: T, to: Infinity });
  }
  ranges.sort((a, b) => a.from - b.from);
  const changes = tr.changes;
  return {
    all: false,
    ranges,
    from: ranges.length ? ranges[0].from : Infinity,
    to: ranges.length ? ranges[ranges.length - 1].to : Infinity,
    delta,
    keep(from, to) {
      // Classified by its OLD start: a block in a node the edit rebuilt maps
      // anywhere into the rebuilt stretch, also onto its end.
      if (from >= S && from < oldE) return null;
      const next = { from: changes.mapPos(from, 1), to: changes.mapPos(to, -1) };
      if (next.from >= T) return null;
      return next;
    },
  };
}

/**
 * The start of the line `pos` stands on. Every bound of a plan is a line
 * start: a block begins at the start of its first line, and a top-level node
 * may begin after the indentation of its line - a bound at the node would
 * leave the block on the wrong side of it.
 */
function lineStartOf(state: EditorState, pos: number): number {
  return state.doc.lineAt(Math.min(pos, state.doc.length)).from;
}

/** Every top-level node of `state`'s tree that starts in one of the plan's ranges, in order. */
export function forEachRescannedNode(state: EditorState, plan: BlockRescan, visit: (node: SyntaxNode) => void): void {
  const top = syntaxTree(state).topNode;
  for (const range of plan.ranges) {
    // The ranges are bounded by line starts and no node shares a line with another.
    for (let node = top.childAfter(range.from); node && node.from < range.to; node = node.nextSibling) {
      if (node.from >= range.from) visit(node);
    }
  }
}

/** True when a selection range touches [from, to] - the caret on one of the block's lines. */
export function selectionTouches(selection: EditorSelection, from: number, to: number): boolean {
  for (const r of selection.ranges) if (r.from <= to && r.to >= from) return true;
  return false;
}

export interface BlockEntry<I> {
  /** Start of the block's first line and end of its last line. */
  readonly from: number;
  readonly to: number;
  /** What the block is made of - read from its text, so it holds while the text does. */
  readonly info: I;
}

export interface KindState<I, X = unknown> {
  readonly blocks: readonly BlockEntry<I>[];
  /** Anything else a search has to remember (the `$$` search: where it stopped). */
  readonly extra?: X;
}

/** One kind of block a field draws. */
export interface BlockKind<I, C, X = unknown> {
  /** The search from scratch: every block of the note. */
  discoverAll(state: EditorState): KindState<I, X>;
  /** The same blocks, found again only where `plan` says the note may have changed. */
  discover(state: EditorState, prev: KindState<I, X>, plan: BlockRescan): KindState<I, X>;
  /** The block's decoration in `state`, or null (the caret is in it, or it draws nothing). */
  decorate(state: EditorState, ctx: C, block: BlockEntry<I>): Decoration | null;
}

/** A kind whose blocks are each found inside one top-level node of the tree. */
export function nodeScopedDiscovery<I>(
  discoverAll: (state: EditorState) => BlockEntry<I>[],
  findInNode: (state: EditorState, node: SyntaxNode, out: BlockEntry<I>[]) => void,
): Pick<BlockKind<I, unknown>, "discoverAll" | "discover"> {
  return {
    discoverAll: (state) => ({ blocks: discoverAll(state) }),
    discover(state, prev, plan) {
      const out: BlockEntry<I>[] = [];
      for (const block of prev.blocks) {
        const kept = plan.keep(block.from, block.to);
        if (!kept) continue;
        out.push(kept.from === block.from && kept.to === block.to ? block : { from: kept.from, to: kept.to, info: block.info });
      }
      forEachRescannedNode(state, plan, (node) => findInNode(state, node, out));
      out.sort((a, b) => a.from - b.from);
      return { blocks: out };
    },
  };
}

interface KindValue {
  readonly state: KindState<unknown>;
  /** The decoration each block had - reused while nothing about the block changed. */
  readonly decos: ReadonlyMap<BlockEntry<unknown>, Decoration | null>;
}

interface BlockFieldValue<C> {
  readonly ctx: C;
  /** Null while the field draws nothing (see `enabled`). */
  readonly kinds: readonly KindValue[] | null;
  readonly set: DecorationSet;
}

export interface BlockFieldConfig<C> {
  /** Names the field in the console when a search fails. */
  readonly label: string;
  // The kinds' info types differ; the field only passes them through.
  readonly kinds: ReadonlyArray<BlockKind<any, C, any>>;
  /** What every decoration depends on besides the block and the selection. */
  context(state: EditorState): C;
  sameContext(a: C, b: C): boolean;
  /** False: the field draws nothing at all. */
  enabled?(ctx: C): boolean;
  /** Whether a transaction can change any decoration (the condition the field always had). */
  triggers(tr: Transaction): boolean;
  /** Whether a transaction changes every decoration besides edits and context (anchor frames). */
  refreshesAll?(tr: Transaction): boolean;
}

function assemble(kinds: readonly KindValue[]): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (const kind of kinds) {
    for (const block of kind.state.blocks) {
      const deco = kind.decos.get(block);
      if (deco) ranges.push(deco.range(block.from, block.to));
    }
  }
  return Decoration.set(ranges, true);
}

function fromScratch<C>(config: BlockFieldConfig<C>, state: EditorState, ctx: C): BlockFieldValue<C> {
  if (config.enabled && !config.enabled(ctx)) return { ctx, kinds: null, set: Decoration.none };
  // A parser edge case must never blank the editor: the field then draws
  // nothing and searches from scratch on its next update.
  try {
    return searchAll(config, state, ctx);
  } catch (e) {
    console.error(`[${config.label}] build error`, e);
    return { ctx, kinds: null, set: Decoration.none };
  }
}

function searchAll<C>(config: BlockFieldConfig<C>, state: EditorState, ctx: C): BlockFieldValue<C> {
  const kinds = config.kinds.map((kind): KindValue => {
    const found = kind.discoverAll(state);
    const decos = new Map<BlockEntry<unknown>, Decoration | null>();
    for (const block of found.blocks) decos.set(block, kind.decorate(state, ctx, block));
    return { state: found, decos };
  });
  return { ctx, kinds, set: assemble(kinds) };
}

/** The decorations of a field's config, searched from scratch - the reference the field must equal. */
export function blockDecorationsFromScratch<C>(config: BlockFieldConfig<C>, state: EditorState): DecorationSet {
  const ctx = config.context(state);
  if (config.enabled && !config.enabled(ctx)) return Decoration.none;
  return searchAll(config, state, ctx).set;
}

function advance<C>(config: BlockFieldConfig<C>, value: BlockFieldValue<C>, tr: Transaction): BlockFieldValue<C> {
  if (!config.triggers(tr)) return value;
  const state = tr.state;
  const ctx = config.context(state);
  const sameCtx = config.sameContext(ctx, value.ctx);
  if (config.enabled && !config.enabled(ctx)) return value.kinds === null && sameCtx ? value : { ctx, kinds: null, set: Decoration.none };
  const plan = planBlockRescan(tr);
  if (!value.kinds || plan?.all) return fromScratch(config, state, ctx);

  // Everything is decided anew after an edit (every block behind it moved, and
  // a widget carries its range), a new context, or new anchor frames. A caret
  // move re-decides the blocks it enters or leaves; a parse step the blocks
  // it found anew.
  const all = tr.docChanged || !sameCtx || (config.refreshesAll?.(tr) ?? false);
  const before = tr.startState.selection;
  const after = state.selection;
  const moved = !before.eq(after);
  let changed = all;
  const kinds = config.kinds.map((kind, index): KindValue => {
    const prev = (value.kinds as readonly KindValue[])[index];
    const found = plan ? kind.discover(state, prev.state, plan) : prev.state;
    if (found !== prev.state) changed = true;
    const decos = new Map<BlockEntry<unknown>, Decoration | null>();
    for (const block of found.blocks) {
      const reusable = !all && prev.decos.has(block)
        && !(moved && (selectionTouches(before, block.from, block.to) || selectionTouches(after, block.from, block.to)));
      if (reusable) {
        decos.set(block, prev.decos.get(block) ?? null);
      } else {
        const deco = kind.decorate(state, ctx, block);
        if (!prev.decos.has(block) || prev.decos.get(block) !== deco) changed = true;
        decos.set(block, deco);
      }
    }
    return { state: found, decos };
  });
  if (!changed) return value;
  return { ctx, kinds, set: assemble(kinds) };
}

/**
 * A state field drawing block widgets that follow the text (see the top of
 * this file). Block widgets must come from a state field, not a view plugin:
 * they change line heights and have to be known before the viewport is measured.
 */
export function incrementalBlockField<C>(config: BlockFieldConfig<C>): StateField<BlockFieldValue<C>> {
  return StateField.define<BlockFieldValue<C>>({
    create: (state) => fromScratch(config, state, config.context(state)),
    update: (value, tr) => {
      try {
        return advance(config, value, tr);
      } catch (e) {
        console.error(`[${config.label}] update error`, e);
        return fromScratch(config, tr.state, config.context(tr.state));
      }
    },
    provide: (f) => EditorView.decorations.from(f, (value) => value.set),
  });
}

/** What a field made by `incrementalBlockField` draws in `state` (for tests and probes). */
export function blockFieldDecorations(state: EditorState, field: Extension): DecorationSet {
  return state.field(field as StateField<BlockFieldValue<unknown>>).set;
}
