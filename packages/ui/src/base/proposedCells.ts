import { commentActionController, commentCreatedAt, planCommentDecision, proposedPropertyOf, type CommentOperationService, type WorkspaceCommentRecord } from "@plainva/core";
import { runVisibleCommentOperation } from "../lib/commentActionView";
import { isCommentThreadOpen, type PropertyCommentCellsInput } from "../lib/commentThreads";
import { propertyValueWords } from "../lib/propertySuggestion";
import { isEmptyPropertyValue } from "./writeProperty";

/**
 * The values somebody proposes for the properties of the entries a database
 * shows (plan KI-Harness P5-4), for both shells.
 *
 * A proposed value is a suggestion like every other: it lives in the comments
 * of its note, is accepted or declined there, and syncs with them. A database
 * only shows it somewhere else — in the cell of that entry and that property —
 * and decides it through the same operation the note's margin uses, one
 * decision per note. Nothing here is a second store, and nothing is written
 * that the note's own "accept" would not write.
 */
export interface ProposedCell {
  path: string;
  /** The column that shows it. */
  column: string;
  /** The suggestion as its note keeps it. */
  comment: WorkspaceCommentRecord;
  /** The value the property would have; undefined where the proposal takes the property out. */
  value: unknown;
  removed: boolean;
}

const sameWords = (a: unknown, b: unknown) => propertyValueWords(a) === propertyValueWords(b);

/**
 * The columns a view shows as CELLS of its entries — the only places a
 * proposed value can stand in, and so the only ones the line above the rows
 * counts and decides: what "all" means is what the reader sees.
 *
 * `shown` are the property columns this shell's renderer draws for the view.
 * A calendar, a timeline, a pinboard and a graph show entries, not cells: a
 * proposal for one of their entries waits at its note. A gallery does not
 * draw the property its cover comes from. A board also says what it groups
 * its cards by — on the card itself, in both shells —, whether or not that
 * property is one of the view's columns. And nothing computed can be
 * proposed: not a property of the file, not a formula, a rollup or the other
 * side of a relation.
 */
export function proposalColumns(
  render: string,
  shown: readonly string[],
  schema: Readonly<Record<string, { rollup?: unknown; reverseOf?: unknown } | undefined>> | null | undefined,
  structure: { groupBy?: string | null; laneBy?: string | null; cover?: string | null } = {},
): string[] {
  if (render === "calendar" || render === "timeline" || render === "pinboard" || render === "graph") return [];
  const out: string[] = [];
  const take = (column: string | null | undefined) => {
    if (!column || out.includes(column)) return;
    if (column.startsWith("file.") || column.startsWith("formula.") || column === "okf_version") return;
    if (schema?.[column]?.rollup || schema?.[column]?.reverseOf) return;
    out.push(column);
  };
  for (const column of shown) if (!(render === "gallery" && column === structure.cover)) take(column);
  if (render === "board") {
    take(structure.groupBy);
    take(structure.laneBy);
  }
  return out;
}

/**
 * Which cells carry a proposed value: per entry and column, the open
 * suggestion that proposes this column's property.
 *
 * A database has its rows' values, not its notes' texts, so whether a proposal
 * still fits is judged by what the row says NOW: a property that is changed or
 * removed has to say what it said when the suggestion was made, and a new one
 * has to be missing. A proposal that no longer fits is not shown in a cell —
 * it stays at its note, where the card says so —, and neither is one a second
 * decision is needed for. Accepting asks the note itself again
 * (`planCommentDecision`), so a cell never writes what the margin would refuse.
 *
 * `columns` are the property columns the view shows. A proposal names the
 * note's own key: it goes to the column of that name, or to the one column
 * that differs from it only in its letters' case.
 */
export function buildProposedCells(
  entries: readonly PropertyCommentCellsInput[],
  rowOf: (path: string) => Readonly<Record<string, unknown>> | null | undefined,
  columns: readonly string[],
): Map<string, Map<string, ProposedCell>> {
  const cells = new Map<string, Map<string, ProposedCell>>();
  if (columns.length === 0) return cells;
  const exact = new Set(columns);
  const folded = new Map<string, string | null>();
  for (const column of columns) {
    const key = column.toLowerCase();
    folded.set(key, folded.has(key) ? null : column);
  }
  for (const entry of entries) {
    const row = rowOf(entry.path);
    if (!row) continue;
    for (const comment of entry.comments) {
      if (!comment.suggestion || !comment.anchor || comment.parentCommentId) continue;
      if (!isCommentThreadOpen(comment) || comment.suggestionDecision?.status === "conflict") continue;
      const property = proposedPropertyOf(comment.anchor, comment.suggestion.replacement);
      if (!property) continue;
      const column = exact.has(property.key) ? property.key : (folded.get(property.key.toLowerCase()) ?? null);
      if (column === null) continue;
      const current = row[column];
      // A new property goes where the note has none; a change or a removal, where the property still says what it said.
      if (property.added ? !isEmptyPropertyValue(current) : property.previous !== undefined && !sameWords(property.previous, current)) continue;
      // What the row says already is nothing to decide in a cell.
      if (!property.removed && !isEmptyPropertyValue(current) && sameWords(property.value, current)) continue;
      let byColumn = cells.get(entry.path);
      if (!byColumn) cells.set(entry.path, (byColumn = new Map()));
      const shown = byColumn.get(column);
      // Two proposals for one cell: the newest is the one in the cell; the other waits at the note.
      if (shown && commentCreatedAt(shown.comment) >= commentCreatedAt(comment)) continue;
      byColumn.set(column, { path: entry.path, column, comment, value: property.removed ? undefined : property.value, removed: property.removed });
    }
  }
  return cells;
}

/** Every proposed cell, in the order of the rows and columns given: what "accept all" means for a view. */
export function listProposedCells(cells: ReadonlyMap<string, ReadonlyMap<string, ProposedCell>>, paths: readonly string[], columns: readonly string[]): ProposedCell[] {
  const out: ProposedCell[] = [];
  for (const path of paths) {
    const byColumn = cells.get(path);
    if (!byColumn) continue;
    for (const column of columns) {
      const cell = byColumn.get(column);
      if (cell) out.push(cell);
    }
  }
  return out;
}

/** The suggestions the cells show, by comment id: a cell that shows a proposal does not count it among its remarks as well. */
export function proposedCellComments(cells: ReadonlyMap<string, ReadonlyMap<string, ProposedCell>>): Set<string> {
  const ids = new Set<string>();
  for (const byColumn of cells.values()) for (const cell of byColumn.values()) ids.add(cell.comment.commentId);
  return ids;
}

export interface ProposedCellDeps {
  service: CommentOperationService;
  /** The note's text as it is now — the editor's pending keystrokes saved first —, or null where the note is gone. */
  current(path: string): Promise<string | null>;
}

export interface ProposedCellOutcome {
  decided: ProposedCell[];
  /** What could not be decided, with the reason of the first of them: the proposals stay where they are. */
  failed: ProposedCell[];
  error: unknown;
}

/**
 * Accepts or declines proposed cells — the user's click on one, or on "all" of
 * a view. One decision per note, the same operation the note's margin runs
 * (backup, version history, sync and the note's index go with it), and one
 * after the other: a comment operation is one at a time.
 *
 * Several proposals of one note are one decision; where that decision cannot
 * be made as a whole — one of them no longer fits —, each is tried on its
 * own, so the ones that fit are not held back by the one that does not.
 */
export async function decideProposedCells(deps: ProposedCellDeps, cells: readonly ProposedCell[], outcome: "applied" | "declined"): Promise<ProposedCellOutcome> {
  const byPath = new Map<string, ProposedCell[]>();
  for (const cell of cells) {
    const list = byPath.get(cell.path);
    if (list) list.push(cell);
    else byPath.set(cell.path, [cell]);
  }
  const result: ProposedCellOutcome = { decided: [], failed: [], error: null };
  const decide = async (path: string, list: readonly ProposedCell[]): Promise<void> => {
    // Declining writes nothing into the note, so its text is not asked for.
    const text = outcome === "applied" ? await deps.current(path) : "";
    if (text === null) throw new Error("comment-suggestion-orphan");
    const input = planCommentDecision(path, text, list.map((cell) => cell.comment), outcome);
    await commentActionController(deps.service).execute(input, (operation) => runVisibleCommentOperation(deps.service, operation));
  };
  const failed = (list: readonly ProposedCell[], error: unknown) => {
    result.failed.push(...list);
    result.error ??= error;
  };
  for (const [path, list] of byPath) {
    try {
      await decide(path, list);
      result.decided.push(...list);
    } catch (error) {
      const fit = error instanceof Error && (error.message === "comment-suggestion-orphan" || error.message === "comment-suggestion-overlap");
      if (list.length === 1 || !fit) {
        failed(list, error);
        continue;
      }
      for (const cell of list) {
        try {
          await decide(path, [cell]);
          result.decided.push(cell);
        } catch (single) {
          failed([cell], single);
        }
      }
    }
  }
  return result;
}

/** A row as it reads once a proposal was accepted: what the cell shows until the index has caught up. */
export function withProposedValue<Row extends Record<string, unknown>>(row: Row, cell: ProposedCell): Row {
  const next: Record<string, unknown> = { ...row };
  if (cell.removed) delete next[cell.column];
  else next[cell.column] = cell.value;
  return next as Row;
}
