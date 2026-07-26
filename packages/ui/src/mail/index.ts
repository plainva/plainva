/**
 * Shared mail core (feinplan G0.1) — everything above the platform seam:
 * account model, backend branching, folder logic, MIME/reply building,
 * sanitising and the compose text operations. Exposed as its own subpath
 * (`@plainva/ui/mail`) rather than through the main barrel so that a shell
 * which does not use mail never pulls in DOMPurify & friends.
 *
 * A shell must call `setMailPlatform({ transport, http })` before the first
 * mail call.
 */

export * from "./types";
export * from "./transport";
export * from "./mailAccounts";
export * from "./mailClient";
export * from "./graphMail";
export * from "./mailOut";
export * from "./mailSanitize";
export * from "./inviteIcs";
export * from "./composeMarkdown";
export * from "./composeSession";
export * from "./mailCapture";
export * from "./net/socket";
export * from "./net/mime";
export * from "./net/mimeBuild";
export * from "./net/imap";
export * from "./net/smtp";
export * from "./net/socketTransport";
