// The sync's engine and the providers' targets, loaded with the first vault that syncs (performance plan L5): a
// local vault never loads them, and the start bundle carries none of their code (WebDAV's XML reading among it).
// S3 and WebDAV, which read their listings as XML, load only for a vault that uses one (`syncXmlTargets.ts`, package B1b).
export { DeletionJournal, DriveSyncTarget, DropboxSyncTarget, OneDriveSyncTarget, OwnDeletionRegister, SettingsOnlySync, SyncEngine, SyncQueue, SyncWorker } from "@plainva/core";
