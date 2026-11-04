/**
 * When a file was EDITED, as an SQL expression over `files f LEFT JOIN
 * sync_state s ON s.path = f.path` (Sammelplan § 3.164).
 *
 * The file's modification time (`mtime_local`) is right for a file changed on
 * this device. For one the sync downloaded and wrote it is the moment of the
 * download — a freshly connected phone listed every pulled note as edited
 * today. While the index holds the hash of the version the sync wrote
 * (`sync_state.pulled_sha256`, see `SyncStateRepository.recordPulledVersion`),
 * the time that version last changed on the remote stands instead; a change
 * made here changes the hash and the local time counts again. A row without a
 * remote time keeps the local one.
 *
 * One expression for every reader — the phone's Today list and the time a
 * write hands to the targets that keep it with the remote copy (`SyncQueue`).
 */
export const EDITED_AT_SQL =
  `(CASE WHEN s.pulled_sha256 IS NOT NULL AND s.pulled_sha256 = f.sha256 AND s.pulled_mtime IS NOT NULL
     THEN s.pulled_mtime ELSE f.mtime_local END)`;
