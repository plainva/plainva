/**
 * Turning a publication's provider advice into words (Stufe B, S5b).
 *
 * `publishedSliceProviderInstructions` decides WHICH advice a provider needs -
 * that is a rule about the provider, and it lives in `packages/core`. It
 * returns identifiers, not sentences, so the words stay where every other
 * user-facing word in Plainva lives: the ten locale files.
 *
 * The mapping is here rather than in either shell because both show the same
 * advice, and a second copy is how desktop and mobile come to tell a publisher
 * two different things about the same folder.
 */
import { PUBLISHED_NOTE_REFUSED, type PublishedSliceInstruction, type PublishedSlicePermissionHint } from "@plainva/core";

/** Fallbacks, so a missing translation degrades to English instead of a blank line. */
const DEFAULTS: Record<string, string> = {
  "dedicated-folder-permission": "Create a dedicated folder and grant {{permission}} access only.",
  "no-link-wide-access": "Do not enable link-wide access.",
  "specific-people-link": "Create a specific-people link with {{permission}} access.",
  "download-block-optional": "Disable download only as an optional policy; encryption remains authoritative.",
  "dedicated-folder-invite": "Invite recipients to a dedicated folder as {{permission}}.",
  "no-public-link": "Do not use a public shared link.",
  "share-password-expiry": "Create a dedicated share with password and expiry.",
  "credentials-outside": "Keep WebDAV credentials outside the publication.",
  "dedicated-collection": "Provision a dedicated collection and least-privilege credentials.",
  "tls-separate-account": "Use TLS and a separate account per publication.",
  "dedicated-prefix-deny-default": "Use a dedicated prefix with deny-by-default IAM.",
  "no-public-access-tls": "Disable public access and require TLS.",
};

const PERMISSION_DEFAULTS: Record<PublishedSlicePermissionHint, string> = {
  viewer: "viewer",
  commenter: "commenter",
};

/**
 * The permission word on its own.
 *
 * Separate from the sentence because providers name the same idea differently
 * and translators need to match the label the person is actually looking at in
 * the sharing dialog.
 */
export function publicationPermissionLabel(
  permission: PublishedSlicePermissionHint,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  return t(`workspaceSecurity.publicationPermission.${permission}`, {
    defaultValue: PERMISSION_DEFAULTS[permission],
  });
}

/** One instruction, ready to render. */
export function publicationInstructionText(
  instruction: PublishedSliceInstruction,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  return t(`workspaceSecurity.publicationInstruction.${instruction.id}`, {
    defaultValue: DEFAULTS[instruction.id] ?? instruction.id,
    // Interpolated rather than concatenated: German and French put the
    // permission in a different position than English does, and a sentence
    // glued together in code cannot move it.
    permission: instruction.permission ? publicationPermissionLabel(instruction.permission, t) : "",
  });
}

/**
 * The control plane throws error codes, not sentences.
 *
 * Six of them, and each one means something different to the person in front
 * of the screen: a publication this vault has never heard of, a vault that is
 * locked, a key that lives on another device, a member without the right to
 * invite, a publication whose policy carries no recipient group, and - since S6
 * - an attempt to withdraw somebody who is not a recipient of it. Showing the
 * raw code was the state before S5b, and it told nobody anything.
 *
 * Unknown codes fall through unchanged rather than being swallowed by a
 * generic sentence: an error we did not anticipate is still worth reading.
 */
const PUBLICATION_ERROR_KEYS: Record<string, string> = {
  "publication-unknown": "publicationUnknown",
  "publication-locked": "publicationLocked",
  "publication-key-missing": "publicationKeyMissing",
  "workspace-publication-not-permitted": "publicationNotPermitted",
  "publication-recipient-group-missing": "publicationRecipientGroupMissing",
  // The guard that stops a publisher revoking their own Owner out of the
  // publication - the red probe showed the core throws nothing without it.
  "member is not a publication recipient": "publicationNotRecipient",
};

/**
 * Whether a publication error is a note the sanitizer refuses. Such a reason
 * belongs to the sanitized copy alone — an exact one hands the note out as it
 * is —, while any other failure of a preview (a note that cannot be read, a
 * locked vault) stands whatever the mode.
 */
export function isPublishedNoteRefusal(error: unknown): boolean {
  return (error instanceof Error ? error.message : String(error)).startsWith(PUBLISHED_NOTE_REFUSED);
}

/**
 * Turn a thrown publication error into a sentence, or leave it alone.
 *
 * One of them carries a value: the note a sanitized publication will not
 * publish because the block at its top cannot be read as properties
 * (`projectPublishedNote` in core). The sentence names that note — a slice is
 * many notes, and the reason is of no use without the one it is about. It is
 * said the same way wherever it arrives: thrown out of the preview on either
 * shell, or read back from the publication's record on its row.
 */
export function publicationErrorText(
  error: unknown,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (isPublishedNoteRefusal(error)) {
    return t("workspaceSecurity.publicationNoteRefused", {
      defaultValue:
        "“{{path}}” cannot be published: the block at the top of the note cannot be read as properties. Correct it in the note's text; until then the publication is not fully refreshed.",
      path: raw.slice(PUBLISHED_NOTE_REFUSED.length),
    });
  }
  const key = PUBLICATION_ERROR_KEYS[raw];
  return key ? t(`workspaceSecurity.${key}`, { defaultValue: raw }) : raw;
}

/**
 * What a publication's row says about how current it is (Stufe B, S7).
 *
 * Three states, and the order between them is the point: an error outranks a
 * count, because a publication that could not refresh has a pending number that
 * describes work nobody managed to do. Saying "3 changes pending" when the
 * truth is "the provider rejected the last four attempts" would be the most
 * comfortable lie on this screen.
 *
 * `pending` counts what the NEXT refresh would touch, not what is broken - zero
 * with no error is simply current, whether the last run happened a minute ago
 * or the publication has never needed one since it was created.
 *
 * Shared rather than written into either shell for the same reason the
 * instructions above are: mobile lists publications too, and a second copy is
 * how the two shells come to describe the same folder differently.
 */
export function publicationStatusText(
  input: { lastError: string | null; pending: number },
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (input.lastError) {
    return t("workspaceSecurity.publicationRefreshFailed", {
      defaultValue: "Refresh failed: {{reason}}",
      reason: publicationErrorText(input.lastError, t),
    });
  }
  if (input.pending > 0) {
    return t("workspaceSecurity.publicationPending", { count: input.pending, defaultValue: "{{count}} changes pending" });
  }
  return t("workspaceSecurity.publicationCurrent", { defaultValue: "Up to date" });
}
