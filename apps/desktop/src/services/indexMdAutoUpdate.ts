// The managed-index auto-updater moved to @plainva/ui (P6, 2026-08-21). The
// phone runs the same one: a vault edited there no longer drifts out of date
// until a desktop opens it.
export {
  affectedFolders,
  createIndexAutoUpdater,
  notifyFileOps,
  updateAllManagedIndexes,
  type FileOp,
  type IndexAutoUpdater,
  type IndexAutoUpdaterDeps,
} from "@plainva/ui";
