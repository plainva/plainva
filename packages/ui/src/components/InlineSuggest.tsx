import { createContext, useContext, useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Hash, Paperclip } from "lucide-react";
import { ICON } from "../lib/iconSizes";
import { applyInlineTrigger, inlineTriggerAt, suggestForTrigger, type InlineSuggestion, type InlineTrigger, type TriggerQuerySource } from "../lib/inlineTriggers";
import { MenuItem, MenuSurface } from "./ui/Menu";

/**
 * `[[` and `#` suggestions for a plain text field (plan Befunde 2026-10-06, W5)
 * — the capture fields of the journal and the tasks view, in both shells.
 *
 * The same grammar as the `@` picker of a comment (`MentionTextArea`): the list
 * rides on `MenuSurface`, the caret STAYS in the field so typing narrows the
 * list, the arrow keys move the highlight, Enter or Tab takes it, Escape puts
 * the list away without closing what is around the field. What is offered and
 * what a pick writes come from `lib/inlineTriggers` — the searches the note
 * editor's completion reads.
 *
 * Where the vault's index comes from is the shell's business: it puts an
 * `InlineSuggestProvider` around its surfaces. A field outside of one (the
 * global quick-capture window, which has no index of its own) simply offers
 * nothing.
 */
const SourceContext = createContext<TriggerQuerySource | null>(null);

export function InlineSuggestProvider({ source, children }: { source: TriggerQuerySource | null; children: ReactNode }) {
  return <SourceContext.Provider value={source}>{children}</SourceContext.Provider>;
}

export interface InlineSuggestApi {
  /** Call with every change of the text and the caret it left. */
  onText: (text: string, caret: number | null) => void;
  /** Call first in the field's key handler; true means the key was the list's. */
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => boolean;
  /** The caret moved without the text changing (arrow keys, a click). */
  onCaret: (caret: number | null) => void;
  onBlur: () => void;
  /** The list; render it beside the field. */
  menu: ReactNode;
}

const ICONS = { note: FileText, attachment: Paperclip, tag: Hash } as const;

/**
 * The keys that move the caret along the line without changing the text — a
 * field reports the caret after them (`onCaret`). Up and Down are not among
 * them: while the list is open they move its highlight.
 */
export const CARET_KEYS: ReadonlySet<string> = new Set(["ArrowLeft", "ArrowRight", "Home", "End"]);

export function useInlineSuggest({
  value,
  onChange,
  fieldRef,
}: {
  value: string;
  onChange: (value: string) => void;
  fieldRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
}): InlineSuggestApi {
  const { t } = useTranslation();
  const source = useContext(SourceContext);
  const [open, setOpen] = useState<{ trigger: InlineTrigger; options: InlineSuggestion[] } | null>(null);
  const [active, setActive] = useState(0);
  // Answers arrive later than the typing that asked; only the latest counts.
  const asked = useRef(0);
  // Set when a pick rewrites the text: React renders the new value first, and
  // only then can the caret be put behind what was inserted.
  const caretAfter = useRef<number | null>(null);

  useEffect(() => {
    const caret = caretAfter.current;
    if (caret === null) return;
    caretAfter.current = null;
    const field = fieldRef.current;
    if (!field) return;
    field.focus();
    field.setSelectionRange(caret, caret);
  }, [value, fieldRef]);

  const close = () => {
    asked.current += 1;
    setOpen(null);
  };

  const look = (text: string, caret: number | null) => {
    const trigger = source && caret !== null ? inlineTriggerAt(text, caret) : null;
    if (!source || !trigger) {
      close();
      return;
    }
    const id = (asked.current += 1);
    void suggestForTrigger(source, trigger)
      .then((options) => {
        if (asked.current !== id) return;
        setOpen(options.length > 0 ? { trigger, options } : null);
        setActive(0);
      })
      .catch(() => {
        // An index that cannot answer offers nothing; the field stays a field.
        if (asked.current === id) setOpen(null);
      });
  };

  const pick = (option: InlineSuggestion) => {
    if (!open) return;
    const next = applyInlineTrigger(value, open.trigger, option.insert);
    caretAfter.current = next.caret;
    close();
    onChange(next.text);
  };

  return {
    onText: look,
    onCaret: (caret) => {
      if (open) look(value, caret);
    },
    onBlur: close,
    onKeyDown: (event) => {
      if (!open || event.nativeEvent.isComposing) return false;
      const count = open.options.length;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActive((index) => (index + 1) % count);
        return true;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActive((index) => (index - 1 + count) % count);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        // Enter would otherwise save the entry while a highlighted suggestion
        // is on screen — that reads as a dropped keystroke.
        event.preventDefault();
        pick(open.options[Math.min(active, count - 1)]);
        return true;
      }
      if (event.key === "Escape") {
        // Only the list goes; the dialog or sheet around the field stays.
        event.preventDefault();
        event.stopPropagation();
        close();
        return true;
      }
      return false;
    },
    menu: (
      <MenuSurface
        // A list that changed its length is measured again, so one that opens
        // upward (a field at the bottom of a sheet) keeps clear of the field.
        key={open ? open.options.length : 0}
        open={open !== null}
        onClose={close}
        anchorRef={fieldRef}
        autoFocus={false}
        ariaLabel={t("editor.completionSuggestions")}
      >
        {open?.options.map((option, index) => {
          const Icon = ICONS[option.kind];
          return (
            <MenuItem
              key={`${option.kind}:${option.insert}`}
              icon={<Icon size={ICON.ui} />}
              hint={option.kind === "tag" ? t("editor.tagCount", { count: option.count ?? 0 }) : undefined}
              active={index === active}
              data-testid="inline-suggest-option"
              // A press would take the focus out of the field, and the blur
              // would close the list before the pick lands.
              onMouseDown={(event) => event.preventDefault()}
              onSelect={() => pick(option)}
            >
              {option.label}
            </MenuItem>
          );
        })}
      </MenuSurface>
    ),
  };
}
