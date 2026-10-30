/**
 * Anchor/href scheme allow-list. `.base` cell values, note bodies and other
 * content can come from a shared or synced vault, so a value rendered straight
 * into `<a href>` could carry an executable scheme (javascript:, data:,
 * vbscript:) that runs on click. safeHref keeps only schemes that are inert to
 * click-execution; relative, scheme-relative and fragment URLs (which have no
 * scheme) pass through unchanged.
 */
import { EXTERNAL_SCHEMES, urlAsTheBrowserReadsIt } from "./externalUrl";

const HAS_SCHEME = /^([a-z][a-z0-9+.-]*):/i;

/** Returns `url` if it is safe to use as an href, otherwise undefined (drop the
 * link so a hostile scheme cannot execute on click). The scheme is read as the
 * browser reads it — a leading control character or a tab inside
 * (`java\tscript:`) hid it from the check before (Sammelplan § 3.138) — and
 * judged by the one allowlist of `externalUrl.ts`. */
export function safeHref(url: string): string | undefined {
  const scheme = HAS_SCHEME.exec(urlAsTheBrowserReadsIt(url));
  if (!scheme) return url; // relative / #fragment / //host — no scheme to execute
  return EXTERNAL_SCHEMES.includes(`${scheme[1].toLowerCase()}:`) ? url : undefined;
}
