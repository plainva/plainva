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
import type { PublishedSliceInstruction, PublishedSlicePermissionHint } from "@plainva/core";

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
 * Five of them, and each one means something different to the person in front
 * of the screen: a publication this vault has never heard of, a vault that is
 * locked, a key that lives on another device, a member without the right to
 * invite, and a publication whose policy carries no recipient group. Showing
 * the raw code was the state before S5b, and it told nobody anything.
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
};

/** Turn a thrown publication error into a sentence, or leave it alone. */
export function publicationErrorText(
  error: unknown,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const raw = error instanceof Error ? error.message : String(error);
  const key = PUBLICATION_ERROR_KEYS[raw];
  return key ? t(`workspaceSecurity.${key}`, { defaultValue: raw }) : raw;
}
