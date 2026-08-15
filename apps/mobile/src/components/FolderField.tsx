import { FolderSearch } from "lucide-react";
import { ICON, IconButton, SettingField, TextInput } from "@plainva/ui";

/**
 * A vault path as a card row: free text plus the vault-internal folder browser.
 *
 * Shared because every surface that asks for a folder has to ask for it the
 * same way. It did not exist as a shared thing, which is why the meeting folder
 * on the calendar screen was a bare text field — you had to know the path and
 * type it — while the four folders in "Content & structure" had a browser
 * (feedback 2026-08-15, point 6).
 */
export function FolderField({
  label,
  hint,
  value,
  placeholder,
  onChange,
  onBlur,
  onPick,
}: {
  label: string;
  hint?: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
  /** For fields that persist on blur rather than on every keystroke. */
  onBlur?: () => void;
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
      <TextInput
        onBlur={onBlur}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        value={value}
      />
    </SettingField>
  );
}
