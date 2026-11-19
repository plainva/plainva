/**
 * The key prefix of a note of the sync's own removal in the index database's
 * `meta` table (`ownRemovalNotes.ts`). Its own module, so the schema can name
 * it: the note is bound to the file's sync row and goes with it
 * (`sync_state_own_removal_note_goes`).
 */
export const OWN_REMOVAL_NOTE_PREFIX = "sync-own-removal:";
