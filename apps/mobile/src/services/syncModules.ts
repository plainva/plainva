// The sync's engine and the providers' targets, loaded with the first vault that syncs (performance plan L5): a
// local vault never loads them, and the start bundle carries none of their code (WebDAV's XML reading among it).
export { DeletionJournal, DriveSyncTarget, DropboxSyncTarget, OneDriveSyncTarget, S3SyncTarget, SettingsOnlySync, SyncEngine, SyncWorker, WebDavSyncTarget } from "@plainva/core";
