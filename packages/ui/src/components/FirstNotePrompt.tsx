import { PenLine } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/Button";
import { EmptyState } from "./ui/EmptyState";
import { ICON } from "../lib/iconSizes";

/**
 * What an empty vault shows (plan Oberfläche, O8 / T11): exactly ONE prompt,
 * "Write your first note", with the one action that answers it.
 *
 * Both shells render this one component where an empty vault lands — the
 * phone's Home in place of its tabs and lists, the desktop's empty editor pane
 * in place of "nothing is open" — so the words and the action cannot drift.
 * Whether the vault IS empty is the core's `isEmptyVaultListing`.
 */
export function FirstNotePrompt({ onCreate, className }: { onCreate: () => void; className?: string }) {
  const { t } = useTranslation();
  return (
    <EmptyState
      className={className}
      icon={<PenLine size={ICON.empty} aria-hidden />}
      title={t("firstNote.title")}
      action={
        <Button variant="primary" onClick={onCreate} data-testid="first-note-create">
          {t("firstNote.action")}
        </Button>
      }
    >
      {t("firstNote.body")}
    </EmptyState>
  );
}
