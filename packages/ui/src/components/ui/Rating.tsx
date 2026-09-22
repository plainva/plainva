import { useTranslation } from "react-i18next";
import { cx } from "./cx";

/**
 * A rating as a row of marks (plan Journal-Erweiterungen, X6/E5).
 *
 * The value in the file is a plain NUMBER — `mood: 4` — because that is what
 * Obsidian, a spreadsheet and a future reader can all make sense of; the marks
 * are how Plainva draws it, not how it stores it. Sorting and filtering are a
 * number's, for the same reason.
 *
 * Settable and readable by the same component: a rating one can see but not
 * change would need a second renderer that drifts from this one. Pressing the
 * mark that is already the value clears it — otherwise a four could never
 * become "nothing" without a second control beside it.
 */
export interface RatingProps {
  value: number;
  /** How many marks; 5 unless the column says otherwise. */
  max?: number;
  /** What a mark looks like: one character, e.g. a dot, a star, a heart. */
  glyph?: string;
  /** Absent = read-only (a card, a table cell that is not being edited). */
  onChange?: (value: number) => void;
  /** What is being rated — read to a screen reader in place of "4 of 5". */
  label?: string;
  className?: string;
  testId?: string;
}

export const DEFAULT_RATING_MAX = 5;
export const DEFAULT_RATING_GLYPH = "●";

/** Whole marks, never fewer than one and never more than ten. */
export function clampRatingMax(max: unknown): number {
  const n = typeof max === "number" && Number.isFinite(max) ? Math.round(max) : DEFAULT_RATING_MAX;
  return Math.min(Math.max(n, 1), 10);
}

/** A stored value as a rating: whole, at least nothing, at most `max`. */
export function clampRating(value: unknown, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(Math.max(Math.round(n), 0), clampRatingMax(max));
}

export function Rating({ value, max = DEFAULT_RATING_MAX, glyph = DEFAULT_RATING_GLYPH, onChange, label, className, testId = "rating" }: RatingProps) {
  const { t } = useTranslation();
  const marks = clampRatingMax(max);
  const current = clampRating(value, marks);
  const mark = glyph.trim() ? [...glyph.trim()][0] : DEFAULT_RATING_GLYPH;

  if (!onChange) {
    return (
      <span
        aria-label={t("properties.ratingOf", { value: current, max: marks })}
        className={cx("pv-rating", className)}
        data-testid={testId}
        role="img"
      >
        {Array.from({ length: marks }, (_unused, index) => (
          <span aria-hidden="true" className={cx("pv-rating-mark", index < current && "pv-rating-mark--on")} key={index}>{mark}</span>
        ))}
      </span>
    );
  }

  return (
    <span
      aria-label={label}
      className={cx("pv-rating", "pv-rating--live", className)}
      data-testid={testId}
      role="radiogroup"
    >
      {Array.from({ length: marks }, (_unused, index) => {
        const step = index + 1;
        return (
          <button
            aria-checked={current === step}
            aria-label={t("properties.ratingOf", { value: step, max: marks })}
            className={cx("pv-rating-mark", "pv-iconbtn", "pv-iconbtn--sm", step <= current && "pv-rating-mark--on")}
            key={step}
            // Pressing the current value clears it: a four must be able to
            // become nothing without a second control beside it.
            onClick={(e) => { e.stopPropagation(); onChange(current === step ? 0 : step); }}
            role="radio"
            type="button"
          >
            <span aria-hidden="true">{mark}</span>
          </button>
        );
      })}
    </span>
  );
}
