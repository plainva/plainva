/**
 * Swimlanes of a board (issue #83, plan Issue-Durchsicht 2026-09-06, P6/E6):
 * a second grouping axis. Columns stay what "Group by" says; a lane is a row
 * per value of a second select/status/multi-select/relation property, and a
 * card sits at the crossing of its column and its lane. A card with several
 * lane values (a multi-select) appears in every matching lane, exactly as it
 * appears in every matching column.
 *
 * Shared by both shells: the desktop draws a grid and drops a card on a cell
 * (writing both properties); the phone stacks the lanes and changes a card's
 * lane through its lane chip. Same grouping, same order, same "No value" lane.
 */
import { UNGROUPED_KEY } from "./boardOrder";

export interface BoardLane<Row = Record<string, unknown>> {
  /** The lane's display key, or `UNGROUPED_KEY` for rows without one. */
  key: string;
  /** What a drop into this lane writes: the stored value behind the key — a
   * relation lane keeps its `[[link]]`, an option lane its option value;
   * "" for the "No value" lane. */
  value: string;
  rows: Row[];
}

/** The plain display text of a wiki link, for relation lanes. */
function linkText(v: string): string {
  const m = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/.exec(v.trim());
  return m ? (m[2] ?? m[1]).trim() : v;
}

/** Every stored lane value of a row (empty = no value). Tolerates the `note.` prefix. */
export function laneRawValuesOf(row: Record<string, unknown>, laneBy: string): string[] {
  let raw = row[laneBy];
  if (raw === undefined && laneBy.startsWith("note.")) raw = row[laneBy.slice(5)];
  if (raw === undefined && !laneBy.startsWith("note.")) raw = row[`note.${laneBy}`];
  if (raw == null || raw === "") return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((v) => String(v)).filter((v) => v !== "");
}

/** Every lane KEY of a row: the stored values, wiki links by their text. */
export function laneValuesOf(row: Record<string, unknown>, laneBy: string): string[] {
  return laneRawValuesOf(row, laneBy).map(linkText);
}

/**
 * Rows bucketed by lane. Order: the property's option order first (empty
 * option lanes included, so a board keeps its shape), then any other value
 * alphabetically, the "No value" lane last and only when it has rows.
 */
export function groupRowsByLane<Row extends Record<string, unknown>>(rows: Row[], laneBy: string, optionOrder: string[] = []): BoardLane<Row>[] {
  const buckets = new Map<string, Row[]>();
  const valueOf = new Map<string, string>();
  for (const key of optionOrder) if (!buckets.has(key)) buckets.set(key, []);
  const ungrouped: Row[] = [];
  for (const row of rows) {
    const raws = laneRawValuesOf(row, laneBy);
    if (raws.length === 0) {
      ungrouped.push(row);
      continue;
    }
    for (const raw of raws) {
      const key = linkText(raw);
      const list = buckets.get(key) ?? [];
      list.push(row);
      buckets.set(key, list);
      if (!valueOf.has(key)) valueOf.set(key, raw);
    }
  }
  const known = new Set(optionOrder);
  const others = [...buckets.keys()].filter((k) => !known.has(k)).sort((a, b) => a.localeCompare(b));
  const out: BoardLane<Row>[] = [...optionOrder, ...others].map((key) => ({ key, value: valueOf.get(key) ?? key, rows: buckets.get(key) ?? [] }));
  if (ungrouped.length > 0) out.push({ key: UNGROUPED_KEY, value: "", rows: ungrouped });
  return out;
}

/** The value to write when a card is dropped in a lane: the lane's stored
 * value (a relation lane keeps its link), "" for the "No value" lane. */
export function laneWriteValue(lanes: ReadonlyArray<Pick<BoardLane, "key" | "value">>, laneKey: string): string {
  if (laneKey === UNGROUPED_KEY) return "";
  return lanes.find((l) => l.key === laneKey)?.value ?? laneKey;
}
