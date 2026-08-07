import { useTranslation } from "react-i18next";
import { Button, EmptyState } from "@plainva/ui";

/**
 * The wide layout's work column before anything is chosen (mobile rework N7).
 *
 * It asked for a pick and offered none. The navigator standing beside it is
 * one way to make one; a new note is the other, and it is the only one this
 * column can carry itself — pressing something in the navigator is the
 * navigator's job, and a button here that pointed at it would be a label for
 * a thing already on screen.
 */
export function SplitPlaceholder({ onCreateNote }: { onCreateNote: () => void }) {
  const { t } = useTranslation();
  return (
    <EmptyState
      action={
        <Button data-testid="split-empty-new" onClick={onCreateNote} variant="tonal">
          {t("mobile.newNote")}
        </Button>
      }
      title={t("mobile.pickSomething")}
    >
      {t("mobile.pickSomethingBody")}
    </EmptyState>
  );
}
