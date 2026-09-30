import type { InputHTMLAttributes } from "react";
import { useFieldDraft } from "../../hooks/useFieldDraft";
import { TextInput } from "./Field";

export type CommittedTextInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "defaultValue" | "onChange" | "onFocus" | "onBlur" | "onKeyDown"
> & {
  /** The stored value; followed while the field does not have the focus. */
  value: string;
  /** Persists the normalized text — after a pause, on blur, on Enter, on unmount. */
  onSave: (value: string) => void | Promise<void>;
  /** Applied when saving, never while typing. */
  normalize?: (draft: string) => string;
  delay?: number;
  compact?: boolean;
};

/**
 * A `TextInput` bound to a STORED value (E23): it types into its own draft and
 * commits it, so an asynchronous save can never pull the text — or the caret —
 * out from under the person typing. Use it for every setting a person types;
 * a field whose value lives only in the surface keeps the plain `TextInput`.
 */
export function CommittedTextInput({ value, onSave, normalize, delay, ...rest }: CommittedTextInputProps) {
  const draft = useFieldDraft({ value, onSave, normalize, delay });
  return (
    <TextInput
      {...rest}
      value={draft.value}
      onChange={draft.onChange}
      onFocus={draft.onFocus}
      onBlur={draft.onBlur}
      onKeyDown={draft.onKeyDown}
    />
  );
}
