import i18n from "../i18n";
import { logDiagnostic } from "../services/diagnosticsLog";
import { toast } from "../services/toastStore";

/**
 * Which addresses Plainva hands to the system — one rule for both shells
 * (review 2026-10-22, Sammelplan § 3.138).
 *
 * The desktop's opener plugin only ever allowed web, mail and phone addresses
 * (Tauri capability `opener:default`). The phone's opener handed everything
 * that was not a web address to `window.open` inside its WebView, and several
 * callers passed values straight from a note — a URL property in a database
 * cell, a link in a mail, a journal line. A `javascript:` or `intent:` value
 * from a synced vault or a guest's note reached the WebView that way.
 *
 * The check therefore lives in the SINK: both shells register their
 * `openExternal` through `guardedExternalOpener`, and every caller reaches the
 * system only through that registration (a source guard in the desktop tests
 * keeps the direct ways closed). Anything else is refused with one sentence,
 * the same in both shells — an allowlist rather than a list of dangerous
 * schemes, so a scheme nobody thought of stays closed too. Links into other
 * apps (`obsidian://`, `shortcuts://`) are refused with it: a decision for
 * safety over reach (maintainer, 2026-10-30).
 */
export const EXTERNAL_SCHEMES: readonly string[] = ["http:", "https:", "mailto:", "tel:"];

/**
 * The address as a browser reads it: the URL standard drops leading and
 * trailing C0 control characters and spaces, and removes every tab and line
 * break inside — so `java\nscript:` IS `javascript:` to the WebView, and
 * must be judged that way.
 */
export function urlAsTheBrowserReadsIt(url: string): string {
  let start = 0;
  let end = url.length;
  while (start < end && url.charCodeAt(start) <= 0x20) start += 1;
  while (end > start && url.charCodeAt(end - 1) <= 0x20) end -= 1;
  let out = "";
  for (let i = start; i < end; i += 1) {
    const code = url.charCodeAt(i);
    if (code === 0x09 || code === 0x0a || code === 0x0d) continue;
    out += url[i];
  }
  return out;
}

/**
 * The address to hand to the system, or `null` when Plainva does not open it:
 * no scheme (a relative value), a scheme outside `EXTERNAL_SCHEMES`, or a
 * value the URL parser refuses. Case does not matter (`HTTPS:`); a scheme
 * hidden behind percent-encoding is no scheme at all and is refused.
 */
export function externalUrlToOpen(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const cleaned = urlAsTheBrowserReadsIt(url);
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(cleaned);
  if (!scheme) return null;
  if (!EXTERNAL_SCHEMES.includes(`${scheme[1].toLowerCase()}:`)) return null;
  try {
    new URL(cleaned);
  } catch {
    return null;
  }
  return cleaned;
}

/**
 * The address a contact property opens — the same in a database cell and a
 * note's properties, in both shells: an e-mail address as `mailto:`, a phone
 * number as `tel:`, a URL as written, or as a web address when it is written
 * without a scheme (`plainva.com`). Whether it then opens is the sink's to
 * say; `null` when there is nothing to open.
 */
export function contactPropertyHref(input: string, value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (raw === "") return null;
  if (input === "email") return `mailto:${raw}`;
  if (input === "phone") return `tel:${raw}`;
  if (input === "url") return /^[a-z][a-z0-9+.-]*:/i.test(urlAsTheBrowserReadsIt(raw)) ? raw : `https://${raw}`;
  return null;
}

/** The scheme a refused address names, for the diagnostics trail — never the address itself. */
function schemeOf(url: unknown): string {
  if (typeof url !== "string") return "(none)";
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(urlAsTheBrowserReadsIt(url));
  return match ? `${match[1].toLowerCase()}:` : "(none)";
}

/**
 * Wraps a shell's opener so it only ever receives an address
 * `externalUrlToOpen` allows. A refused address never reaches `open`; the
 * person is told once, and the call resolves — callers' own error toasts are
 * for an opener that failed, not for a link Plainva declined.
 */
export function guardedExternalOpener(open: (url: string) => Promise<void>): (url: string) => Promise<void> {
  return async (url: string) => {
    const allowed = externalUrlToOpen(url);
    if (allowed === null) {
      logDiagnostic("open-external", `refused a link with the scheme ${schemeOf(url)}`);
      toast.warning(i18n.t("dialogs.linkSchemeBlocked"));
      return;
    }
    await open(allowed);
  };
}
