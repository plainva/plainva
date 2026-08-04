/**
 * Moved to `@plainva/ui` (S34): every write here goes through an IVaultAdapter
 * and the shared frontmatter surgery — nothing in it was desktop-specific
 * except waiting for a pending editor save, which is now a platform service
 * (`flushPendingSave`). Re-exported so the existing call sites keep their
 * import path.
 */
export {
  appendWikiLink,
  removeLinksTo,
  createConnectedNote,
  frontmatterBodyOffset,
  findFirstUnlinkedOccurrence,
  applyInlineLink,
  applyMentionLink,
  type InlineOccurrence,
} from "@plainva/ui";
