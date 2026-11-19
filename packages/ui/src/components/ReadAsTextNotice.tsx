import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { overBudgetInlineRanges } from "@plainva/core";
import { Banner } from "./ui/Banner";
import { Button } from "./ui/Button";
import { InfoTip } from "./ui/InfoTip";

/**
 * The note's own word that part of it is read as text (L14, Gesamtplan
 * Leistung § 3a.3, decision 3): where the parse budget reads a paragraph, a
 * table or, over the note's budget, its heaviest blocks as written, the
 * reading view and the editor show their source — and without a word that
 * looks like a fault. One strip over the note in both shells, in the reading
 * view and in the editor alike; the ⓘ says what the part keeps and what not,
 * and the button goes to its first place.
 *
 * `content` is the note as the shell holds it (the editor mirrors its text
 * with a pause, so this asks the scan once a pause, not once a keystroke).
 */
export function ReadAsTextNotice({ content, onJump }: { content: string; onJump?: (offset: number) => void }) {
  const { t } = useTranslation();
  const first = useMemo(() => {
    const ranges = overBudgetInlineRanges(content);
    return ranges.length > 0 ? ranges[0].from : null;
  }, [content]);
  if (first === null) return null;
  return (
    <div data-testid="read-as-text-notice">
      <Banner
        kind="info"
        actions={onJump ? (
          <Button size="sm" variant="secondary" data-testid="read-as-text-jump" onClick={() => onJump(first)}>
            {t("editor.readAsTextJump")}
          </Button>
        ) : undefined}
      >
        {t("editor.readAsText")} <InfoTip label={t("editor.readAsText")} info={t("editor.readAsTextInfo")} testId="read-as-text-info" />
      </Banner>
    </div>
  );
}
