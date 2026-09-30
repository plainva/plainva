import { FolderSearch } from "lucide-react";
import { CommittedTextInput, ICON, IconButton, SettingField } from "@plainva/ui";

/**
 * A vault path as a card row: free text plus the vault-internal folder browser.
 *
 * Shared because every surface that asks for a folder has to ask for it the
 * same way. It did not exist as a shared thing, which is why the meeting folder
 * on the calendar screen was a bare text field — you had to know the path and
 * type it — while the four folders in "Content & structure" had a browser
 * (feedback 2026-08-15, point 6).
 *
 * The field types into its own draft and saves after a pause, on blur and on
 * Enter (E23): bound straight to the stored value, a save per keystroke pulled
 * the text back under the caret, and `trim() || "Daily"` refilled a cleared
 * field while one was still typing. A folder picked in the browser arrives as a
 * new `value` and is taken over at once — the field does not have the focus.
 */
export function FolderField({
  label,
  hint,
  value,
  placeholder,
  normalize,
  onSave,
  onPick,
}: {
  label: string;
  hint?: string;
  /** The stored folder. */
  value: string;
  placeholder?: string;
  /** Applied when saving (a default for an empty field, trimming). */
  normalize?: (draft: string) => string;
  onSave: (value: string) => void | Promise<void>;
  onPick: () => void;
}) {
  return (
    <SettingField
      action={
        // Inside a <label>, so a plain click would only focus the input.
        <IconButton label={label} onClick={(e) => { e.preventDefault(); onPick(); }}>
          <FolderSearch size={ICON.head} />
        </IconButton>
      }
      hint={hint}
      label={label}
    >
      <CommittedTextInput normalize={normalize} onSave={onSave} placeholder={placeholder} value={value} />
    </SettingField>
  );
}
