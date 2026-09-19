import { Check } from "lucide-react";
import { ICON } from "@plainva/ui";
import { SheetGrip } from "./SheetGrip";

/**
 * The "sort by" sheet, once (finding 2026-09-19).
 *
 * The folder view had it inline; search hits and backlinks got an order of
 * their own on the same day, and three copies of one sheet is how three lists
 * come to disagree about what a second tap on the active key does. The rule is
 * the file tree's: a key, a direction that follows from it, the active key
 * again flips the direction — and a key without a direction (relevance) simply
 * shows none.
 */
export interface SortSheetOption<K extends string> {
  key: K;
  label: string;
}

export function SortSheet<K extends string>({
  title,
  options,
  active,
  direction,
  onChoose,
  onClose,
  testId,
}: {
  title: string;
  options: ReadonlyArray<SortSheetOption<K>>;
  active: K;
  /** The active key's direction as a word ("Ascending"); omitted for a key that has none. */
  direction?: string;
  onChoose: (key: K) => void;
  onClose: () => void;
  testId: string;
}) {
  return (
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()} data-testid={testId}>
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{title}</p>
        {options.map((option) => (
          <button key={option.key} className="m-row" onClick={() => onChoose(option.key)} aria-pressed={active === option.key} data-testid={`${testId}-${option.key}`}>
            {active === option.key ? <Check size={ICON.head} /> : <span className="m-row-spacer" />}
            <span>{option.label}</span>
            {active === option.key && direction && <span className="m-row-detail">{direction}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
