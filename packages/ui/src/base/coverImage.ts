import { resolveVaultRelative } from "../adapters/pathGuard";

/**
 * Gallery cover resolution (plan "Vorlagen-Überarbeitung + Plainva-Tour", P1.4).
 *
 * The gallery used to drop the cover value straight into `<img src>`, which only
 * works for a URL the WebView can fetch — an `http(s):`/`blob:`/`data:` source.
 * A vault-relative path (`Anhänge/cover.svg`), which is what a local vault
 * actually stores, resolved to nothing: the WebView has no access to the file
 * system. Pinboard cards already solve this by reading the file through the
 * vault adapter and handing the `<img>` a blob URL; covers now take the same
 * route.
 *
 * This module is the pure part of that decision, so the classification is
 * testable without a DOM or an adapter.
 */

export type CoverSource =
  /** Use verbatim as `<img src>` — an already-fetchable URL. */
  | { kind: "url"; url: string }
  /** Read through the vault adapter; try the candidates in order. */
  | { kind: "vault"; candidates: string[] }
  /** Nothing renderable (empty, or a scheme an image must never carry). */
  | null;

/** Schemes an `<img>` may be pointed at directly. */
const SAFE_URL = /^(?:https?:|blob:|data:image\/)/i;
/** Any `scheme:` prefix — used to tell a URL from a path. */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Classifies a cover property value.
 *
 * A value carrying a scheme is only accepted when that scheme is fetchable and
 * harmless; anything else (`javascript:`, `file:`, `vbscript:` …) is refused
 * rather than passed through — a foreign vault must not be able to put an
 * arbitrary scheme into the app's markup. A value WITHOUT a scheme is treated
 * as a vault path and resolved against the vault root first, then relative to
 * the note's own folder (the order pinboard cards use).
 */
export function resolveCoverSource(raw: unknown, notePath?: string): CoverSource {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return null;

  if (HAS_SCHEME.test(value)) {
    return SAFE_URL.test(value) ? { kind: "url", url: value } : null;
  }

  // A wiki embed (`![[cover.svg]]`) is what a note body would carry; accept the
  // inner target so a column filled by copying from a note still works.
  const embed = /^!?\[\[([^\]|#]+)/.exec(value);
  const target = (embed ? embed[1] : value).trim();
  if (!target) return null;

  const noteDir = notePath && notePath.includes("/") ? notePath.slice(0, notePath.lastIndexOf("/")) : "";
  const candidates = [
    resolveVaultRelative(target),
    noteDir ? resolveVaultRelative(`${noteDir}/${target}`) : null,
  ].filter((p): p is string => !!p);

  return candidates.length > 0 ? { kind: "vault", candidates } : null;
}
