import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Button, GroupCard, ICON, Row, RowList } from "@plainva/ui";
import { SheetGrip } from "./SheetGrip";
import { ChoiceMark } from "./ChoiceMark";

/**
 * The "sort by" sheet, once (finding 2026-09-19).
 *
 * The folder view had it inline; search hits and backlinks got an order of
 * their own on the same day, and three copies of one sheet is how three lists
 * come to disagree about what a second tap on the active key does. The rule is
 * the file tree's: a key, a direction that follows from it, the active key
 * again flips the direction — and a key without a direction (relevance) simply
 * shows none.
 *
 * The FORM says which of the three kinds of choice this is (finding
 * 2026-09-22): the app's own slot mark on the left, as every single choice
 * has; the direction as an arrow on the right, which is what a sort adds; and
 * the sheet stays open, because flipping the direction is a second decision.
 * It used to be a hand-built row with a tick — one of four spellings for
 * "chosen" on this phone.
 *
 * Every list that can be ordered opens THIS sheet (E21): the folder view, the
 * search hits and the backlinks, which had a row of chips of their own. It
 * holds until **Done** — the search page closed it on every tap, so the
 * direction could only be turned by opening it again — and it says in a line
 * under the card what the second tap does, as the 22.09. mockup (case c) has
 * it. Its title is the sheet's own, like every other sheet's.
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
  ascending,
  onChoose,
  onClose,
  testId,
}: {
  title: string;
  options: ReadonlyArray<SortSheetOption<K>>;
  active: K;
  /** The active key's direction as a word ("Ascending"); omitted for a key that has none. */
  direction?: string;
  /** Which way that direction points; only read when `direction` is given. */
  ascending?: boolean;
  onChoose: (key: K) => void;
  onClose: () => void;
  testId: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()} data-testid={testId}>
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{title}</p>
        <GroupCard>
          <RowList>
            {options.map((option) => {
              const on = active === option.key;
              return (
                <Row
                  key={option.key}
                  data-testid={`${testId}-${option.key}`}
                  aria-pressed={on}
                  icon={<ChoiceMark on={on} />}
                  title={option.label}
                  end={on && direction ? (
                    <span className="m-sortdir">
                      {direction}
                      {ascending === false ? <ArrowDown size={ICON.ui} /> : <ArrowUp size={ICON.ui} />}
                    </span>
                  ) : undefined}
                  onClick={() => onChoose(option.key)}
                />
              );
            })}
          </RowList>
        </GroupCard>
        {/* The sheet holds: tapping the active key again turns the direction
            around, and that is a decision one makes while looking at it. The
            line says so while a key with a direction is chosen. */}
        {direction && <p className="m-hint m-sortsheet-hint" data-testid={`${testId}-hint`}>{t("browse.sortFlipHint")}</p>}
        <div className="m-btnrow">
          <Button variant="primary" onClick={onClose} data-testid={`${testId}-done`}>{t("common.done")}</Button>
        </div>
      </div>
    </div>
  );
}
