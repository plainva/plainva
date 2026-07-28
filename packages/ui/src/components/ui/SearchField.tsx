import { forwardRef, type InputHTMLAttributes, type KeyboardEvent } from "react";
import { Search, X } from "lucide-react";
import { cx } from "./cx";
import { ICON } from "../../lib/iconSizes";

export interface SearchFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "size" | "form"> {
  value: string;
  onValueChange: (next: string) => void;
  /** Fires on Escape when the field is ALREADY empty (close the surface). A
   * first Escape with text only clears — THE app-wide search-field contract. */
  onEscapeWhenEmpty?: () => void;
  /** Accessible name for the clear button. */
  clearLabel: string;
  /** Form-metric variant (rare; search fields default to the compact role). */
  form?: boolean;
  className?: string;
}

/**
 * SearchField (design sweep 2026-07-19): THE one search pattern — magnifier
 * left as a flex sibling, clear-X once there is text, Escape clears first and
 * closes second. Replaces the three divergent desktop schemas (absolute icon
 * overlay / palette without clear / mail hybrid).
 *
 * `className` AND `style` address the field as a whole — the root — while every
 * other prop belongs to the input. They used to disagree: `style` rode along in
 * `...rest` onto the inner `<input>`, so a caller laying the field out in a flex
 * row (`flex: 1; min-width: 0`) styled the wrong box and the field refused to
 * shrink. That is what pushed the left sidebar's "+" button out of the panel at
 * narrow widths.
 */
export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { value, onValueChange, onEscapeWhenEmpty, clearLabel, form, className, style, onKeyDown, ...rest },
  ref
) {
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      if (value) {
        e.preventDefault();
        e.stopPropagation();
        onValueChange("");
      } else if (onEscapeWhenEmpty) {
        e.preventDefault();
        onEscapeWhenEmpty();
      }
    }
    onKeyDown?.(e);
  };
  return (
    <div className={cx("pv-searchfield", form && "pv-searchfield--form", className)} style={style}>
      <Search size={ICON.ui} aria-hidden />
      <input
        ref={ref}
        type="text"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        onKeyDown={handleKeyDown}
        {...rest}
      />
      {value ? (
        <button
          type="button"
          className="pv-iconbtn pv-iconbtn--sm"
          aria-label={clearLabel}
          onClick={() => onValueChange("")}
        >
          <X size={ICON.meta} />
        </button>
      ) : null}
    </div>
  );
});
