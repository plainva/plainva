import { useCallback, useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";

/** Pause after the last keystroke before a draft is saved on its own. */
export const FIELD_DRAFT_DELAY_MS = 600;

export interface FieldDraftOptions {
  /** The stored value. Taken over whenever the field does not have the focus. */
  value: string;
  /**
   * Persists the (normalized) draft. May be async; it is not awaited, and a
   * value equal to the last one saved is not saved again.
   */
  onSave: (value: string) => void | Promise<void>;
  /**
   * Turns what was typed into what is stored — trimming, a default for an
   * empty field, a sanitized date format. Applied when SAVING, never while
   * typing: a rewrite under the caret is what moved it.
   */
  normalize?: (draft: string) => string;
  /** Debounce while typing; blur, Enter and unmount save at once. */
  delay?: number;
}

/** Props for any text control: spread them onto an `<input>` or `TextInput`. */
export interface FieldDraftProps {
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  onFocus: () => void;
  onBlur: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
}

/**
 * A text field bound to a stored setting (TestFlight finding 2026-09-22, build
 * 115, E23).
 *
 * The phone bound its settings fields straight to the stored value and saved on
 * every keystroke. The save is asynchronous, so between a key and its
 * acknowledgement React rendered the OLD value into the field; the new one
 * arrived a moment later and WebKit put the caret at the end. Deleting in the
 * middle of "YYYY-MM-DD" jumped the caret, and a second quick key was typed
 * into the old text and lost the first. The folder fields also normalized on
 * every keystroke (`trim() || "Daily"`), so a cleared field refilled itself
 * under the thumb, and the desktop's date format moved its caret whenever the
 * sanitizer changed a character.
 *
 * So the field owns a DRAFT that changes synchronously with the keys. Saving
 * happens after a pause, on blur, on Enter and on unmount, and only then is the
 * text normalized. A change from outside (settings sync, another screen) is
 * taken over while the field is not focused — never under the fingers. One
 * building block for both shells; `settingsFields.test.tsx` (phone) and
 * `settingsFieldDraft.test.tsx` (desktop) keep a stored value from being bound
 * to a field, or rewritten under the caret, again.
 */
export function useFieldDraft({ value, onSave, normalize, delay = FIELD_DRAFT_DELAY_MS }: FieldDraftOptions): FieldDraftProps & { flush: () => string } {
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(value);
  /** The value known to be stored: the last one received or saved; null after a failed save. */
  const savedRef = useRef<string | null>(value);
  /** The draft holds keys that are not saved yet. */
  const dirtyRef = useRef(false);
  const focusedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saveRef = useRef(onSave);
  const normalizeRef = useRef(normalize);
  useEffect(() => {
    saveRef.current = onSave;
    normalizeRef.current = normalize;
  });

  /**
   * Saves what was typed and returns what the field should show. A draft
   * without new keys saves nothing: merely focusing a field and leaving it must
   * never write its old text over a change that arrived in the meantime.
   */
  const flush = useCallback((): string => {
    if (timerRef.current !== undefined) clearTimeout(timerRef.current);
    timerRef.current = undefined;
    if (!dirtyRef.current) return savedRef.current ?? draftRef.current;
    dirtyRef.current = false;
    const out = normalizeRef.current ? normalizeRef.current(draftRef.current) : draftRef.current;
    if (out !== savedRef.current) {
      savedRef.current = out;
      const save = saveRef.current;
      // Async on purpose: a save that throws synchronously lands in the same
      // catch as one that rejects, instead of escaping from a blur handler.
      void (async () => save(out))().catch(() => {
        // The caller reports and rolls back; the next save must not be skipped
        // as "already stored".
        savedRef.current = null;
      });
    }
    return out;
  }, []);

  const show = (next: string) => {
    draftRef.current = next;
    setDraft(next);
  };

  // What is stored now. While the field has the focus or holds unsaved keys,
  // only the bookkeeping follows: the text under the caret stays the person's.
  useEffect(() => {
    savedRef.current = value;
    if (focusedRef.current || dirtyRef.current) return;
    draftRef.current = value;
    setDraft(value);
  }, [value]);

  // A screen that closes mid-word still saves the word.
  useEffect(() => () => {
    if (dirtyRef.current) flush();
  }, [flush]);

  return {
    value: draft,
    flush,
    onChange: (event) => {
      show(event.target.value);
      dirtyRef.current = true;
      if (timerRef.current !== undefined) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, delay);
    },
    onFocus: () => {
      focusedRef.current = true;
    },
    onBlur: () => {
      focusedRef.current = false;
      show(flush());
    },
    onKeyDown: (event) => {
      // Enter confirms a single-line field; in a text area it is a new line.
      if (event.key !== "Enter" || event.currentTarget instanceof HTMLTextAreaElement) return;
      show(flush());
    },
  };
}
