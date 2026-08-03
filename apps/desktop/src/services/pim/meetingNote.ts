// Moved to @plainva/ui (S27) so the phone creates the same note, with the same
// `plainva.pim` anchor. Re-exported here so existing imports keep working.
export {
  buildMeetingNoteContent,
  meetingNoteStem,
  resolveOrCreateMeetingNote,
  type MeetingNoteAdapter,
  type ResolveMeetingNoteOptions,
  type ResolveMeetingNoteResult,
} from "@plainva/ui";
