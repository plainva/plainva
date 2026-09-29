import { FileX, FolderInput } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button, ICON, movedChoiceBodyKey, type MissingFileLookup } from "@plainva/ui";

const card = {
  padding: "var(--space-8)",
  color: "var(--text-muted)",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "var(--space-2)",
  textAlign: "center",
} as const;

/**
 * An open database or image whose file is not where its tab says (issue 110,
 * E9): the same three states, words and test hooks the note editor shows —
 * looking, "Moved?" with the files that carry its content, and the missing
 * state. `keepsChanges`: the surface holds a change that never reached the
 * disk; the words say it is kept, picking a file takes it along, and "Save
 * here again" brings the file back with it.
 */
export function MissingFileView({
  path,
  lookup,
  keepsChanges = false,
  onPick,
  onRestore,
  onCloseTab,
  testIdPrefix,
}: {
  path: string;
  lookup: MissingFileLookup;
  keepsChanges?: boolean;
  onPick(candidate: string): void;
  onRestore?(): void;
  onCloseTab?(): void;
  testIdPrefix: string;
}) {
  const { t } = useTranslation();
  if (lookup.kind === "checking") {
    // Looking first: a moved file must not flash "no longer exists" before
    // the tab follows it.
    return <div data-testid={`${testIdPrefix}-looking`} style={{ padding: "var(--space-8)", color: "var(--text-faint)" }}>{t("editor.loadingFile")}</div>;
  }
  const stillLooking = lookup.searching && (
    // The parent folder gave the first answer; a vault-wide pass still looks,
    // and the tab follows if it finds the file.
    <p data-testid={`${testIdPrefix}-still-looking`} style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--text-faint)" }}>{t("editor.movedFileStillLooking")}</p>
  );
  if (lookup.kind === "ask") {
    return (
      <div data-testid={`${testIdPrefix}-moved-choice`} style={card}>
        <FolderInput size={ICON.empty} style={{ color: "var(--text-faint)" }} />
        <strong style={{ fontSize: "var(--text-md)", color: "var(--text-main)" }}>{t("editor.movedFileAskTitle")}</strong>
        <code style={{ fontSize: "var(--text-sm)" }}>{path}</code>
        <p style={{ margin: 0, fontSize: "var(--text-md)", maxWidth: "42ch" }}>
          {keepsChanges ? t("editor.vanishedAsk") : t(movedChoiceBodyKey(lookup.candidates.length))}
        </p>
        <div role="group" aria-label={t("editor.movedFileAskTitle")} style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", alignItems: "stretch" }}>
          {lookup.candidates.map((candidate) => (
            <Button key={candidate} variant="secondary" data-testid={`${testIdPrefix}-moved-candidate`} onClick={() => onPick(candidate)}>
              {candidate}
            </Button>
          ))}
        </div>
        {stillLooking}
        {onCloseTab && (
          <Button variant="ghost" onClick={onCloseTab}>
            {t("editor.missingFileCloseTab")}
          </Button>
        )}
      </div>
    );
  }
  return (
    <div data-testid={`${testIdPrefix}-missing-file`} style={card}>
      <FileX size={ICON.empty} style={{ color: "var(--text-faint)" }} />
      <strong style={{ fontSize: "var(--text-md)", color: "var(--text-main)" }}>{t("editor.missingFileTitle")}</strong>
      <code style={{ fontSize: "var(--text-sm)" }}>{path}</code>
      <p style={{ margin: 0, fontSize: "var(--text-md)", maxWidth: "42ch" }}>
        {keepsChanges ? t("editor.vanishedGone") : t("editor.missingFileBody")}
      </p>
      {stillLooking}
      <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", justifyContent: "center" }}>
        {onRestore && (
          <Button variant="primary" data-testid={`${testIdPrefix}-restore`} onClick={onRestore}>
            {t("editor.vanishedRestore")}
          </Button>
        )}
        {onCloseTab && (
          <Button variant={onRestore ? "secondary" : "primary"} onClick={onCloseTab}>
            {t("editor.missingFileCloseTab")}
          </Button>
        )}
      </div>
    </div>
  );
}
