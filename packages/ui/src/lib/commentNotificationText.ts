/**
 * What a notification actually says (Stufe F, §5).
 *
 * Shared rather than per shell, and that is not tidiness: this is where the
 * privacy decision lives. A notification appears on a LOCK SCREEN, so the rule
 * about what it may name - the person, the note, a word of the text - has to be
 * one rule. Two copies would drift, and the drift would only ever be visible on
 * somebody's lock screen, which is the worst place to discover it.
 *
 * The two cases that suppress the preview are deliberately separate:
 * `preview: false` is the user's choice (FB2), and a LOCKED vault suppresses it
 * regardless of that choice - the remark arrived sealed and nothing can open it
 * beforehand. Callers pass the conjunction, and the second half is not
 * negotiable.
 */

import type { CommentNotificationPlan } from "./commentNotifications.js";

/** Just enough of i18next to build the strings, so this stays testable. */
export interface CommentNotificationTranslate {
  (key: string, params?: Record<string, unknown>): string;
}

export interface CommentNotificationTextInput {
  plan: CommentNotificationPlan;
  /**
   * Whether the message may name things. The caller ANDs the user's preference
   * with "the vault is unlocked" - a locked vault never previews (§5).
   */
  preview: boolean;
  /** memberId -> display name, for naming the author of a single remark. */
  names: ReadonlyMap<string, string>;
  t: CommentNotificationTranslate;
}

export interface CommentNotificationText {
  title: string;
  body: string;
}

const EXCERPT_CHARS = 120;

/**
 * A lock-screen line, not a paragraph.
 *
 * Cut on a word where one is near the limit, so the excerpt does not end
 * mid-syllable; whitespace is collapsed because a comment may carry newlines
 * and a notification renders them as gaps.
 */
export function commentExcerpt(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  if (flat.length <= EXCERPT_CHARS) return flat;
  const cut = flat.slice(0, EXCERPT_CHARS);
  const space = cut.lastIndexOf(" ");
  return `${space > EXCERPT_CHARS - 24 ? cut.slice(0, space) : cut}…`;
}

/** The note's name as a person would say it, not its path. */
export function commentNoteName(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.md$/i, "");
}

/** The message for one cycle, or null when there is nothing to say. */
export function commentNotificationText(input: CommentNotificationTextInput): CommentNotificationText | null {
  const { plan, preview, names, t } = input;
  if (plan.kind === "none") return null;

  // No preview: not the author, not the note, not one word of the text. This
  // branch is what the switch beside the setting buys, and what a locked vault
  // enforces regardless of the switch.
  if (!preview) {
    return {
      title: plan.kind === "single" ? t("commentNotify.titleOne") : t("commentNotify.titleMany", { count: plan.commentCount }),
      body: t("commentNotify.quiet"),
    };
  }

  if (plan.kind === "single") {
    const { notice } = plan;
    const author = names.get(notice.authorMemberId) ?? t("commentNotify.someone");
    const title =
      notice.source === "publication" && notice.publicationName
        ? t("commentNotify.titleGuest", { name: notice.publicationName })
        : t("commentNotify.titleOneNamed", { author, note: commentNoteName(notice.path) });
    return { title, body: commentExcerpt(notice.body) };
  }

  return {
    title: plan.catchUp
      ? t("commentNotify.titleCatchUp", { count: plan.commentCount })
      : t("commentNotify.titleMany", { count: plan.commentCount }),
    body: t("commentNotify.inNotes", { count: plan.noteCount }),
  };
}
