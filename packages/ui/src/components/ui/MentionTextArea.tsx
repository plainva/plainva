import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, TextareaHTMLAttributes } from "react";
import { TextArea } from "./Field";
import { MenuItem, MenuSurface } from "./Menu";
import { applyMention, mentionQuery, type MentionQuery } from "../../lib/commentMentions";

/**
 * A comment field that completes `@Name` from the member list (Stufe D, D8).
 *
 * Shared because both shells write comments and the two must offer the same
 * names in the same order - a phone that ranked differently would be a second
 * meaning for the same gesture.
 *
 * It is a plain textarea, not the note editor: comments are short, and the
 * CodeMirror mention plugin cannot help here. The list rides on the existing
 * `MenuSurface`, so positioning, viewport clamping, outside-click and Escape are
 * the app's one implementation instead of a second floating panel - the only
 * thing this surface adds is that the caret STAYS in the field
 * (`autoFocus={false}`), because typing to narrow the list is the point.
 */
export interface MentionTextAreaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> {
  value: string;
  onChange(value: string): void;
  /** memberId -> display name. Empty map: the field behaves like a textarea. */
  names: ReadonlyMap<string, string>;
  /** Accessible name for the suggestion list. */
  pickerLabel: string;
}

export function MentionTextArea({
  value,
  onChange,
  names,
  pickerLabel,
  onKeyDown,
  ...rest
}: MentionTextAreaProps) {
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<MentionQuery | null>(null);
  const [active, setActive] = useState(0);
  // Set when a pick rewrites the body: React re-renders with the new value
  // first, and only then can the caret be put after the inserted name.
  const caretRef = useRef<number | null>(null);

  useEffect(() => {
    const caret = caretRef.current;
    if (caret === null) return;
    caretRef.current = null;
    const field = fieldRef.current;
    if (!field) return;
    field.focus();
    field.setSelectionRange(caret, caret);
  }, [value]);

  const refresh = useCallback(
    (body: string, caret: number | null) => {
      const next = caret === null ? null : mentionQuery(body, caret, names);
      setQuery(next);
      setActive(0);
    },
    [names],
  );

  const pick = (name: string) => {
    if (!query) return;
    const next = applyMention(value, query, name);
    caretRef.current = next.caret;
    setQuery(null);
    onChange(next.body);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || !query) return;
    const count = query.matches.length;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => (i + 1) % count);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => (i - 1 + count) % count);
    } else if (event.key === "Enter" || event.key === "Tab") {
      // Enter would otherwise send the comment (or break the line) while the
      // list is open - with a highlighted name on screen that reads as a
      // dropped keystroke.
      event.preventDefault();
      pick(query.matches[Math.min(active, count - 1)].name);
    } else if (event.key === "Escape") {
      // Stop here: the surrounding sheet or dialog must not close as well.
      event.preventDefault();
      event.stopPropagation();
      setQuery(null);
    }
  };

  return (
    <>
      <TextArea
        {...rest}
        ref={fieldRef}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          refresh(event.target.value, event.target.selectionStart);
        }}
        onKeyUp={(event) => {
          // Arrow keys and clicks move the caret without changing the text, and
          // the query follows the caret, not the keystroke.
          if (query || event.key.startsWith("Arrow")) refresh(value, event.currentTarget.selectionStart);
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => setQuery(null)}
      />
      <MenuSurface
        open={!!query}
        onClose={() => setQuery(null)}
        anchorRef={fieldRef}
        autoFocus={false}
        ariaLabel={pickerLabel}
      >
        {query?.matches.map((match, index) => (
          <MenuItem
            key={match.memberId}
            active={index === active}
            // The field loses focus to a click otherwise, and the blur above
            // would close the list before the pick lands.
            onMouseDown={(event) => event.preventDefault()}
            onSelect={() => pick(match.name)}
          >
            {match.name}
          </MenuItem>
        ))}
      </MenuSurface>
    </>
  );
}
