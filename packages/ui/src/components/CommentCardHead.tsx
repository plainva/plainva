import { authorHue, authorInitials } from "../lib/commentAuthor";
import { absoluteTimeLabel, relativeTimeLabel } from "../lib/relativeTime";

/**
 * Who wrote it and when, in ONE line at the top of a comment card (K3).
 *
 * Shared by the desktop column and the phone's sheet so both say the same:
 * an initials chip, the display name from the workspace policy, and a
 * relative time on the right. The member id and the full timestamp stay as
 * tooltips - a name is a claim the policy carries, not a verified identity,
 * and a relative phrase is a label, not the record.
 */
export function CommentCardHead({ name, initials, memberId, createdAt, locale, now }: {
  name: string;
  /**
   * The chip's letters, when they should not come from `name`: the reader's
   * own card says "you", and a chip reading "YO" names nobody - the letters
   * come from the stated name instead (finding 2026-09-09).
   */
  initials?: string;
  memberId: string;
  createdAt: string;
  locale: string;
  /** Injectable for tests; the card otherwise reads the clock. */
  now?: number;
}) {
  return (
    <div className="pv-comment-card__who">
      <span className="pv-comment-card__avatar" data-hue={authorHue(memberId)} aria-hidden="true">{initials ?? authorInitials(name)}</span>
      <span className="pv-comment-card__name" data-tip={memberId}>{name}</span>
      <time className="pv-comment-card__when" dateTime={createdAt} data-tip={absoluteTimeLabel(createdAt, locale)}>
        {relativeTimeLabel(createdAt, locale, now)}
      </time>
    </div>
  );
}
