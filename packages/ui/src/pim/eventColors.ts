/**
 * Shared per-event colour palette (2026-07-18) for the calendar colour picker
 * on desktop and mobile. These are Google Calendar's fixed 11 event colours as
 * hex, so a colour round-trips exactly through Google's colorId; CalDAV writes
 * the hex to the RFC 7986 COLOR property. An empty colour means "use the
 * calendar's colour" (the default). Microsoft Graph has no per-event colour,
 * so the field is a no-op there.
 */
export const EVENT_COLOR_PALETTE: readonly string[] = [
  "#7986cb", // Lavender
  "#33b679", // Sage
  "#039be5", // Peacock
  "#0b8043", // Basil
  "#f6bf26", // Banana
  "#f4511e", // Tangerine
  "#e67c73", // Flamingo
  "#d50000", // Tomato
  "#8e24aa", // Grape
  "#3f51b5", // Blueberry
  "#616161", // Graphite
];
