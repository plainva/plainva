/**
 * A failed write against a calendar or task provider, with its reason kept (K9).
 *
 * The adapters used to throw `new Error("graph create event 403")` - the
 * status alone. Graph and Google put the actual reason in the body
 * (`error.code` / `error.message`: an unconsented scope, a calendar that is
 * not writable, a malformed recurrence), and CalDAV servers write it as text.
 * Dropping that before the error leaves the adapter is how "could not block
 * in X" came to say nothing more for weeks. This reads the body once, never
 * throws while doing so, and carries the status for the shell to act on.
 */
export class PimRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null = null) {
    super(message);
    this.name = "PimRequestError";
  }
}

interface ErrorBodyShape {
  error?: { code?: unknown; message?: unknown; status?: unknown; errors?: Array<{ message?: unknown; reason?: unknown }> } | string;
  error_description?: unknown;
  message?: unknown;
}

function firstLine(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const line = value.split(/\r?\n/)[0]?.trim() ?? "";
  return line.length > 0 ? line.slice(0, 300) : null;
}

/** What a provider said about a failure, from JSON or plain text. */
export function parsePimErrorBody(body: string): { code: string | null; message: string | null } {
  const text = body.trim();
  if (!text) return { code: null, message: null };
  try {
    const parsed = JSON.parse(text) as ErrorBodyShape;
    if (typeof parsed.error === "string") return { code: parsed.error, message: firstLine(parsed.error_description) };
    const error = parsed.error;
    if (error && typeof error === "object") {
      const code = typeof error.code === "string" ? error.code : typeof error.status === "string" ? error.status : typeof error.errors?.[0]?.reason === "string" ? String(error.errors[0].reason) : null;
      const message = firstLine(error.message) ?? firstLine(error.errors?.[0]?.message);
      return { code, message };
    }
    return { code: null, message: firstLine(parsed.message) };
  } catch {
    // Not JSON: a CalDAV server's plain-text or HTML answer. Its first line
    // is usually the sentence that matters; markup is stripped so the toast
    // does not show tags.
    const line = firstLine(text.replace(/<[^>]+>/g, " "));
    return { code: null, message: line ? line.replace(/\s+/g, " ").trim() : null };
  }
}

export async function pimRequestError(label: string, res: { status: number; statusText?: string; text?: () => Promise<string> }): Promise<PimRequestError> {
  let body = "";
  try {
    body = res.text ? await res.text() : "";
  } catch {
    /* the status alone has to do */
  }
  const detail = parsePimErrorBody(body);
  const parts = [detail.code, detail.message].filter(Boolean).join(": ");
  const statusText = res.statusText ? ` ${res.statusText}` : "";
  return new PimRequestError(`${label}: ${res.status}${statusText}${parts ? ` — ${parts}` : ""}`, res.status, detail.code);
}
