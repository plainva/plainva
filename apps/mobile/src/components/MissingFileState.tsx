import { FileX, FolderInput } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button, EmptyState, ICON, movedChoiceBodyKey, type MissingFileLookup } from "@plainva/ui";

/**
 * An open database or image whose file is not where the screen says (issue
 * 110, E9): "Moved?" with the files that carry its content, or the missing
 * state — the words of the note screen, with the one way off the screen.
 * Nothing shows while the file is looked for; a moved file must not flash
 * "no longer exists" before the screen follows it. `keepsChanges`: the screen
 * holds a change that never reached the disk; the words say it is kept,
 * picking a file takes it along, and "Save here again" brings the file back.
 */
export function MissingFileState({
  lookup,
  keepsChanges = false,
  onPick,
  onRestore,
  onBack,
  testIdPrefix,
}: {
  lookup: MissingFileLookup;
  keepsChanges?: boolean;
  onPick(candidate: string): void;
  onRestore?(): void;
  onBack(): void;
  testIdPrefix: string;
}) {
  const { t } = useTranslation();
  if (lookup.kind === "checking") return null;
  const stillLooking = lookup.searching && (
    // The parent folder gave the first answer; a vault-wide pass still looks,
    // and the screen follows if it finds the file.
    <p className="m-hint" data-testid={`${testIdPrefix}-still-looking`}>{t("editor.movedFileStillLooking")}</p>
  );
  if (lookup.kind === "ask") {
    return (
      <EmptyState
        action={
          <div role="group" aria-label={t("editor.movedFileAskTitle")} className="m-moved-choice">
            {lookup.candidates.map((candidate) => (
              <Button key={candidate} data-testid={`${testIdPrefix}-moved-candidate`} onClick={() => onPick(candidate)} variant="tonal">
                {candidate}
              </Button>
            ))}
            <Button data-testid={`${testIdPrefix}-missing-back`} onClick={onBack} variant="ghost">
              {t("common.back")}
            </Button>
          </div>
        }
        icon={<FolderInput size={ICON.touch} />}
        title={t("editor.movedFileAskTitle")}
      >
        {keepsChanges ? t("editor.vanishedAsk") : t(movedChoiceBodyKey(lookup.candidates.length))}
        {stillLooking}
      </EmptyState>
    );
  }
  return (
    <EmptyState
      action={
        <div className="m-moved-choice">
          {onRestore && (
            <Button data-testid={`${testIdPrefix}-restore`} onClick={onRestore} variant="tonal">
              {t("editor.vanishedRestore")}
            </Button>
          )}
          <Button data-testid={`${testIdPrefix}-missing-back`} onClick={onBack} variant={onRestore ? "ghost" : "tonal"}>
            {t("common.back")}
          </Button>
        </div>
      }
      icon={<FileX size={ICON.touch} />}
      title={t("editor.missingFileTitle")}
    >
      {keepsChanges ? t("editor.vanishedGone") : t("editor.missingFileBody")}
      {stillLooking}
    </EmptyState>
  );
}
