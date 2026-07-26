import { useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { ICON } from "../../lib/iconSizes";

/**
 * A field whose values are chips: type, confirm with Enter (or a separator),
 * remove with the chip's ×. Backspace on an empty input takes the last chip
 * back — the behaviour people expect from every address field.
 *
 * Extracted when the third copy of this markup was about to be written (mail
 * recipients, event attendees, sender addresses). The `.pv-chipfield` markup
 * and its focus-within ring live in ui.css; three hand-rolled copies would
 * drift the moment one of them gains a fix.
 *
 * Values are handled as a LIST here. Callers that persist a joined string do
 * the joining themselves — the separator differs per field (", " for
 * recipients, one per line for aliases), and guessing it inside the field
 * would be wrong for at least one of them.
 */

export interface ChipFieldProps {
  /** Current values, already split. */
  values: string[];
  onChange: (values: string[]) => void;
  /**
   * Turns raw input into zero or more values. Given the freedom because the
   * fields differ: recipients accept `a@b.c, d@e.f` in one paste, an alias is
   * one entry. Returning an empty array rejects the input.
   */
  parse: (raw: string) => string[];
  /** Accessible name of a chip's remove button, given the value. */
  removeLabel: (value: string) => string;
  placeholder?: string;
  /** Extra separators that confirm the current input, besides Enter. */
  separators?: string[];
  testId?: string;
  autoFocus?: boolean;
  inputId?: string;
  ariaLabel?: string;
  /**
   * The uncommitted input, reported as it changes. Needed by callers that must
   * act on a value the user typed but never confirmed — sending a mail takes
   * the half-typed address along rather than dropping it silently.
   */
  onDraftChange?: (draft: string) => void;
}

export function ChipField({
  values,
  onChange,
  parse,
  removeLabel,
  placeholder,
  separators = [",", ";"],
  testId,
  autoFocus,
  inputId,
  ariaLabel,
  onDraftChange,
}: ChipFieldProps) {
  const [draft, setDraftState] = useState("");
  const setDraft = (next: string) => {
    setDraftState(next);
    onDraftChange?.(next);
  };

  const commit = (raw: string) => {
    const parsed = parse(raw);
    if (parsed.length === 0) return;
    // A duplicate is silently dropped rather than rejected loudly: adding an
    // address twice is a slip, not an error worth a message.
    onChange([...new Set([...values, ...parsed])]);
    setDraft("");
  };

  const remove = (value: string) => onChange(values.filter((v) => v !== value));

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || separators.includes(e.key)) {
      e.preventDefault();
      commit(draft);
    } else if (e.key === "Backspace" && draft === "" && values.length > 0) {
      remove(values[values.length - 1]);
    }
  };

  return (
    <div
      className="pv-field pv-chipfield"
      data-testid={testId ? `${testId}-field` : undefined}
      onClick={(e) => {
        // Clicking the empty area of the field focuses its input, like a
        // native one — the chips would otherwise swallow the click target.
        if (e.target === e.currentTarget) (e.currentTarget.querySelector("input") as HTMLInputElement | null)?.focus();
      }}
    >
      {values.map((v) => (
        <span key={v} className="pv-chip pv-chip--removable" data-testid={testId ? `${testId}-chip` : undefined}>
          <span>{v}</span>
          <button
            type="button"
            className="pv-chip-x"
            onClick={() => remove(v)}
            aria-label={removeLabel(v)}
            data-testid={testId ? `${testId}-remove` : undefined}
          >
            <X size={ICON.meta} />
          </button>
        </span>
      ))}
      <input
        id={inputId}
        aria-label={ariaLabel}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => commit(draft)}
        data-testid={testId}
        autoFocus={autoFocus}
        placeholder={values.length === 0 ? placeholder : ""}
      />
    </div>
  );
}
