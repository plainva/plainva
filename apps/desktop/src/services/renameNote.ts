// The vault-wide rename-with-link-updates core moved to @plainva/ui (mobile
// M3E package C) — it was already adapter-neutral, and the mobile shell now
// renames through the same link retargeting. Desktop imports stay valid
// through this stub.
export {
  renameFileWithLinkUpdates,
  type RenameAdapter,
  type RenameResult,
} from "@plainva/ui";
