// The two targets that read their listings as XML (fast-xml-parser and its helpers, about 100 KB): loaded at a vault's
// open only when the vault syncs through S3 or WebDAV (package B1b); every other vault, and a local one, never loads
// them.
export { S3SyncTarget, WebDavSyncTarget } from "@plainva/core";
