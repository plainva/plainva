import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { readAsTextParts } from "@plainva/core";
import { Banner } from "./ui/Banner";
import { Button } from "./ui/Button";
import { InfoTip } from "./ui/InfoTip";
import type { ReadAsTextState } from "./readAsText";

/**
 * The note's own word that part of it is read as text (L14, Gesamtplan
 * Leistung § 3a.3, decision 3): where the parse budget reads a paragraph, a
 * table or, over the note's budget, its heaviest blocks as written, the
 * reading view and the editor show their source — and without a word that
 * looks like a fault. One strip over the note in both shells, in the reading
 * view and in the editor alike; the ⓘ says what the part keeps and what not,
 * and the button goes to its first place. Where a part is read as text and not
 * read for its links at all (`readAsTextParts`: too large to be read even in
 * pieces), the strip says that instead, and the button goes there.
 *
 * `state` is the editor's decision (`readAsText`), which holds its blocks
 * while it is typed in; without one, `content` is read as the reading view
 * reads it, from the text alone.
 */
export function ReadAsTextNotice({ state, content, onJump, onShownChange }: { state?: ReadAsTextState | null; content?: string; onJump?: (offset: number) => void; onShownChange?: (shown: boolean) => void }) {
  const { t } = useTranslation();
  const read = useMemo(() => state ?? (content !== undefined ? readAsTextParts(content) : null), [state, content]);
  const unread = (read?.unread.length ?? 0) > 0;
  const first = read ? (read.unread[0]?.from ?? read.ranges[0]?.from ?? null) : null;
  // Whether the notice shows, for a page that gives it a place of its own (the phone's floating controls, L14).
  useEffect(() => {
    onShownChange?.(first !== null);
  }, [first, onShownChange]);
  useEffect(() => () => onShownChange?.(false), [onShownChange]);
  if (first === null) return null;
  const title = t(unread ? "editor.readAsTextUnread" : "editor.readAsText");
  return (
    <div data-testid="read-as-text-notice" data-unread={unread ? "true" : undefined}>
      <Banner
        kind={unread ? "warning" : "info"}
        actions={onJump ? (
          <Button size="sm" variant="secondary" data-testid="read-as-text-jump" onClick={() => onJump(first)}>
            {t("editor.readAsTextJump")}
          </Button>
        ) : undefined}
      >
        {title} <InfoTip label={title} info={t(unread ? "editor.readAsTextUnreadInfo" : "editor.readAsTextInfo")} testId="read-as-text-info" />
      </Banner>
    </div>
  );
}
