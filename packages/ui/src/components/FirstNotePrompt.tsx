import { CloudDownload, PenLine } from "lucide-react";
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
 * Whether the vault IS empty is the core's `readVaultEmptiness`.
 *
 * `fetching`: the vault syncs and its first pull is still running — nothing
 * is here YET. It says so, without an action: a first note written into a
 * cloud vault that is still arriving is not what anybody came for (review of
 * O8, 2026-11-17: it was called empty during that pull).
 */
export function FirstNotePrompt({ onCreate, className, fetching = false }: { onCreate: () => void; className?: string; fetching?: boolean }) {
  const { t } = useTranslation();
  if (fetching) {
    return (
      <EmptyState className={className} icon={<CloudDownload size={ICON.empty} aria-hidden />} title={t("firstNote.fetchingTitle")} testId="vault-fetching">
        {t("firstNote.fetchingBody")}
      </EmptyState>
    );
  }
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
