/**
 * Reading the reason out of a failed OAuth token request.
 *
 * Every provider answers a rejected token request with a JSON body carrying
 * `error` and usually `error_description` — the difference between "your
 * sign-in was revoked, connect again" and "your client is misconfigured" lives
 * entirely in there. Microsoft's token path has read it since the connect
 * flows were built; Google's threw away everything but the HTTP status, so a
 * calendar that had lost its authorisation reported
 *
 *     Drive token refresh failed: 400 Bad Request
 *
 * which names neither the cause nor anything the user could do about it
 * (maintainer finding 2026-07-28).
 *
 * The `error` code is kept verbatim in the message on purpose: it survives the
 * trip through the PIM cache, where failures are stored as plain strings, and
 * lets the UI classify an error it did not catch itself.
 */

/** The machine-readable part of a token error, as far as the body reveals it. */
export interface OAuthErrorDetail {
  /** OAuth 2.0 error code, e.g. `invalid_grant`, `invalid_client`. */
  code?: string;
  /** First line of the human-readable description, if the provider sent one. */
  description?: string;
}

/** Parses an error body; tolerates non-JSON and unexpected shapes. */
export function parseOAuthErrorBody(body: unknown): OAuthErrorDetail {
  if (!body || typeof body !== "object") return {};
  const raw = body as { error?: unknown; error_description?: unknown; error_summary?: unknown };
  const code = typeof raw.error === "string" && raw.error ? raw.error : undefined;
  // Dropbox puts its detail in `error_summary` and its `error` is an OBJECT,
  // not a code — reading only the OAuth 2.0 fields there would drop the one
  // part that says what went wrong. Harmless for the others: they never send it.
  const raw_desc =
    typeof raw.error_description === "string" && raw.error_description
      ? raw.error_description
      : typeof raw.error_summary === "string" && raw.error_summary
        ? raw.error_summary
        : undefined;
  const description = raw_desc ? raw_desc.split(/[\r\n]/)[0] : undefined;
  return { ...(code ? { code } : {}), ...(description ? { description } : {}) };
}

/**
 * Builds the message for a failed token request: what failed, the HTTP status,
 * and — when the provider said so — the code and its description.
 */
export function formatOAuthError(label: string, status: number, statusText: string, detail: OAuthErrorDetail): string {
  const parts = [detail.code, detail.description].filter(Boolean).join(": ");
  return `${label}: ${status} ${statusText}${parts ? ` — ${parts}` : ""}`;
}

/** Reads a failed token response and turns it into one message. Never throws. */
export async function oauthErrorMessage(
  label: string,
  res: { status: number; statusText: string; json: () => Promise<unknown> }
): Promise<string> {
  let detail: OAuthErrorDetail = {};
  try {
    detail = parseOAuthErrorBody(await res.json());
  } catch {
    /* body was not JSON — status alone has to do */
  }
  return formatOAuthError(label, res.status, res.statusText, detail);
}
