/**
 * What the calendar targets ask a provider for at sign-in. Kept apart from the targets, so a screen that only names
 * the scopes (the sign-in's consent text) does not load a target and its HTML reading (performance plan L5).
 */
export const GOOGLE_CALENDAR_SCOPES =
  "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/tasks openid email";
// User.Read only feeds the account label (/me); calendar/tasks are the point.
export const GRAPH_CALENDAR_SCOPES = "User.Read Calendars.ReadWrite Tasks.ReadWrite offline_access";
