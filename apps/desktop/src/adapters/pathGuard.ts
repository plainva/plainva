/**
 * Pure decision for the vault path-traversal guard: is `normalizedPath` inside
 * (or equal to) `normalizedRoot`?
 *
 * Both inputs are expected to be already normalized (collapsing of "." / ".."
 * segments is the caller's job, e.g. the platform path API). Isolating this logic
 * keeps the security-critical prefix/separator/sibling decision unit-testable
 * without the Tauri runtime.
 *
 * Guards against the sibling-prefix pitfall — root "/vault" must NOT accept
 * "/vault-evil/secret" — by requiring either an exact match or a match on
 * `root + separator`.
 */
export function isWithinRoot(normalizedRoot: string, normalizedPath: string, separator: string): boolean {
  if (normalizedPath === normalizedRoot) return true;
  const rootWithSeparator = normalizedRoot.endsWith(separator)
    ? normalizedRoot
    : `${normalizedRoot}${separator}`;
  return normalizedPath.startsWith(rootWithSeparator);
}

/**
 * Purely lexical resolution of a vault-relative reference (wiki embeds,
 * markdown image targets) for SYNC contexts like the read-mode renderer,
 * where the async platform path API is unavailable.
 *
 * Returns the normalized, `/`-joined relative path — or `null` when the
 * reference is absolute (leading slash, drive letter, UNC) or escapes the
 * vault via `..`. Note content is potentially foreign (synced vaults), so an
 * escaping reference must never be turned into a loadable local file path.
 */
export function resolveVaultRelative(target: string): string | null {
  if (!target) return null;
  // Absolute forms: "/etc/x", "\\server\share", "C:/…", "C:\…", "file://…"
  if (/^[/\\]/.test(target) || /^[a-zA-Z]:[/\\]/.test(target) || /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(target)) {
    return null;
  }
  const stack: string[] = [];
  for (const segment of target.split(/[/\\]+/)) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (stack.length === 0) return null; // would escape the vault root
      stack.pop();
      continue;
    }
    stack.push(segment);
  }
  if (stack.length === 0) return null;
  return stack.join("/");
}
