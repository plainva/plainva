/**
 * Why an Android Google sign-in failed — as a class, not as a sentence.
 *
 * On Android Google signs in through Play services (`AuthorizationClient`),
 * which identifies the app by its package name and the signing certificate of
 * the installed build. Every way that can go wrong used to arrive as one text,
 * "Google authorization cancelled": a registration Google does not know, a
 * dead network, an account that is not on the phone and a sheet the user
 * closed were indistinguishable, on the screen and in the diagnostics.
 *
 * The native plugin now rejects with a stable code and, as data, where the
 * failure happened and what Play services answered. This module is the pure
 * half: it reads such a rejection, names it, and writes the one diagnostics
 * line — no address, no scope, no token.
 */

export const GOOGLE_AUTHORIZATION_CODES = [
  "CANCELLED",
  "DEVELOPER_ERROR",
  "NETWORK_ERROR",
  "TIMEOUT",
  "SIGN_IN_REQUIRED",
  "INVALID_ACCOUNT",
  "INTERNAL_ERROR",
  "PLAY_SERVICES_UNAVAILABLE",
  "CONSENT_REQUIRED",
  "INTERRUPTED",
  "BUSY",
  "AUTH_FAILED",
] as const;

export type GoogleAuthorizationCode = (typeof GOOGLE_AUTHORIZATION_CODES)[number];

export interface GoogleAuthorizationFailure {
  code: GoogleAuthorizationCode;
  /** The Play services status number, when there was one. */
  status?: number;
  statusName?: string;
  /** `request` (before any dialog), `launch`, `result` (after the dialog) or `token`. */
  stage?: string;
  /** The activity result code: 0 is "cancelled", -1 is "ok". */
  resultCode?: number;
  /** Whether the activity result carried an intent at all. */
  hadIntent?: boolean;
  /** Play services' own short text, already stripped by the plugin. */
  detail?: string;
  /** The Java class of a failure that was not a Play services status. */
  exception?: string;
}

const MARKER = "google_authorization";
const MARKER_PATTERN = /google_authorization:([A-Z_]+)(?::(-?\d+))?/;

function isCode(value: unknown): value is GoogleAuthorizationCode {
  return typeof value === "string" && (GOOGLE_AUTHORIZATION_CODES as readonly string[]).includes(value);
}

function numberOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : undefined;
}

/** Letters, digits and a few separators — a status name or a class name, never free text. */
function wordOf(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const word = value.replace(/[^A-Za-z0-9_.$-]/g, "").slice(0, 60);
  return word || undefined;
}

/** A second strip on this side: the line goes into an export people share. */
function detailOf(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => (part.includes("@") ? "<address>" : part.includes("://") ? "<link>" : part))
    .join(" ")
    .slice(0, 160);
  return text || undefined;
}

/**
 * Reads what the native plugin rejected with. Anything it does not recognise
 * is `AUTH_FAILED` — an unknown code must never read as a cancel.
 */
export function readGoogleAuthorizationFailure(error: unknown): GoogleAuthorizationFailure {
  const raw = (error ?? {}) as { code?: unknown; data?: unknown };
  const data = (raw.data && typeof raw.data === "object" ? raw.data : {}) as Record<string, unknown>;
  const failure: GoogleAuthorizationFailure = { code: isCode(raw.code) ? raw.code : "AUTH_FAILED" };
  const status = numberOf(data.status);
  if (status !== undefined) failure.status = status;
  const statusName = wordOf(data.statusName);
  if (statusName) failure.statusName = statusName;
  const stage = wordOf(data.stage);
  if (stage) failure.stage = stage;
  const resultCode = numberOf(data.resultCode);
  if (resultCode !== undefined) failure.resultCode = resultCode;
  if (typeof data.hadIntent === "boolean") failure.hadIntent = data.hadIntent;
  const detail = detailOf(data.detail);
  if (detail) failure.detail = detail;
  const exception = wordOf(data.exception);
  if (exception) failure.exception = exception;
  return failure;
}

/**
 * The failure as an `Error` the rest of the app can pass around. Its message
 * is a marker (`google_authorization:DEVELOPER_ERROR:10`), because the screens
 * keep a failure as a string and translate it later; `code` stays for the
 * callers that only ask whether the user cancelled.
 */
export class GoogleAuthorizationError extends Error {
  readonly code: GoogleAuthorizationCode;
  readonly status?: number;
  constructor(readonly failure: GoogleAuthorizationFailure, options?: { cause?: unknown }) {
    super(failure.status === undefined ? `${MARKER}:${failure.code}` : `${MARKER}:${failure.code}:${failure.status}`, options);
    this.name = "GoogleAuthorizationError";
    this.code = failure.code;
    this.status = failure.status;
  }
}

/** Finds the marker in an error or in the string a screen kept of it. */
export function googleAuthorizationMarker(error: unknown): { code: GoogleAuthorizationCode; status?: number } | null {
  const text = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const match = MARKER_PATTERN.exec(text);
  if (!match || !isCode(match[1])) return null;
  return { code: match[1], ...(match[2] === undefined ? {} : { status: Number(match[2]) }) };
}

/** Whether this is the user closing Google's sheet — the one failure that is not an error. */
export function isGoogleAuthorizationCancelled(error: unknown): boolean {
  return googleAuthorizationMarker(error)?.code === "CANCELLED";
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The sentence for a marked failure, or null when the error is not one.
 * `CONSENT_REQUIRED` is not here on purpose: the wrapper turns it into
 * `invalid_grant`, which already has its sentence.
 */
export function googleAuthorizationMessage(error: unknown, t: Translate): string | null {
  const marker = googleAuthorizationMarker(error);
  if (!marker) return null;
  switch (marker.code) {
    case "CANCELLED":
      return t("settings.oauthCancelled");
    case "DEVELOPER_ERROR":
      return t("connection.googleBuildNotRegistered");
    case "NETWORK_ERROR":
    case "TIMEOUT":
      return t("connection.googleUnreachable");
    case "SIGN_IN_REQUIRED":
    case "INVALID_ACCOUNT":
      return t("connection.googleAccountNotOnDevice");
    case "CONSENT_REQUIRED":
      return t("connection.needsConsent");
    case "INTERRUPTED":
    case "BUSY":
      return t("connection.loginFailed");
    default:
      return t("connection.googlePlayServicesFailed", { code: marker.status ?? marker.code });
  }
}

/** Which services a scope string asks for — the names, never the scopes. */
export function googleServicesOfScope(scope: string): string {
  const parts = scope.split(/\s+/).filter(Boolean);
  const services: string[] = [];
  if (parts.some((p) => p.includes("/auth/drive"))) services.push("files");
  if (parts.some((p) => p.includes("/auth/calendar") || p.includes("/auth/tasks"))) services.push("calendar");
  if (parts.some((p) => p.includes("mail.google.com") || p.includes("/auth/gmail"))) services.push("mail");
  return services.length ? services.join("+") : "identity";
}

/**
 * The one diagnostics line of a failed attempt. It answers, without a device
 * log: was a dialog shown (`stage`), what did the activity return
 * (`resultCode`, `intent`), and what did Play services say (`status`).
 */
export function googleAuthorizationDiagnostic(
  failure: GoogleAuthorizationFailure,
  attempt: { services: string; interactive: boolean; account: "named" | "chooser" },
): string {
  const parts = [
    `${attempt.services} sign-in failed: ${failure.code}`,
    attempt.interactive ? "interactive" : "background",
    `account ${attempt.account}`,
  ];
  if (failure.stage) parts.push(`stage ${failure.stage}`);
  if (failure.status !== undefined) parts.push(`status ${failure.status}${failure.statusName ? ` ${failure.statusName}` : ""}`);
  if (failure.resultCode !== undefined) parts.push(`resultCode ${failure.resultCode}`);
  if (failure.hadIntent !== undefined) parts.push(failure.hadIntent ? "intent present" : "intent missing");
  if (failure.exception) parts.push(`exception ${failure.exception}`);
  if (failure.detail) parts.push(`detail: ${failure.detail}`);
  return parts.join(", ");
}

/** A result that arrived while no call was waiting (the activity was rebuilt under the dialog). */
export function googleOrphanResultDiagnostic(orphan: unknown): string | null {
  if (!orphan || typeof orphan !== "object") return null;
  const failure = readGoogleAuthorizationFailure({ code: "INTERRUPTED", data: orphan });
  const parts = ["a sign-in result arrived with no call waiting"];
  if (failure.resultCode !== undefined) parts.push(`resultCode ${failure.resultCode}`);
  if (failure.hadIntent !== undefined) parts.push(failure.hadIntent ? "intent present" : "intent missing");
  return parts.join(", ");
}
