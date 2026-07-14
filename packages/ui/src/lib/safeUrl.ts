/**
 * Anchor/href scheme allow-list. `.base` cell values, note bodies and other
 * content can come from a shared or synced vault, so a value rendered straight
 * into `<a href>` could carry an executable scheme (javascript:, data:,
 * vbscript:) that runs on click. safeHref keeps only schemes that are inert to
 * click-execution; relative, scheme-relative and fragment URLs (which have no
 * scheme) pass through unchanged.
 */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const SAFE_SCHEME = /^(?:https?|mailto|tel):/i;

/** Returns `url` if it is safe to use as an href, otherwise undefined (drop the
 * link so a hostile scheme cannot execute on click). */
export function safeHref(url: string): string | undefined {
  const u = url.trim();
  if (!HAS_SCHEME.test(u)) return url; // relative / #fragment / //host — no scheme to execute
  return SAFE_SCHEME.test(u) ? url : undefined;
}
