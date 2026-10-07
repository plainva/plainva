import { AI_HIDDEN_ROOTS } from "../hiddenPaths.js";

/**
 * Which file of the vault an agent means (plan KI-Harness P4.6).
 *
 * An agent names files the way the protocol demands: as absolute paths on
 * this computer. Plainva's own code knows a vault's files by their path in
 * the vault. This is the one place the first becomes the second — or does
 * not: a path outside the vault, one that could mean something else than it
 * says on some file system, and Plainva's own folders are no files of the
 * vault for an agent. The rules for the part inside the vault are those of
 * the MCP server's native path check (`src-tauri/src/mcp/paths.rs`).
 *
 * This is no wall against the agent itself. It runs with the user's rights
 * and opens any file on its own; the rule decides what Plainva hands over
 * and takes when it is asked.
 */

export type AcpPathProblem =
  /** Not an absolute path. */
  | "not-absolute"
  /** Absolute, and not in the vault. */
  | "outside"
  /** In the vault by its letters, and not a name Plainva takes: `..`, a trailing dot, a colon. */
  | "unsafe"
  /** One of Plainva's own folders, or another tool's. */
  | "hidden";

export type AcpVaultPath = { ok: true; path: string } | { ok: false; problem: AcpPathProblem };

const DRIVE = /^[A-Za-z]:\//;

/** A Windows path in one spelling: forward slashes, without the prefix that only says "take this literally". */
function windowsForm(raw: string): string | null {
  let path = raw.replace(/\\/g, "/");
  if (path.startsWith("//?/UNC/")) path = `//${path.slice(8)}`;
  else if (path.startsWith("//?/")) path = path.slice(4);
  return DRIVE.test(path) || (path.startsWith("//") && path.length > 2 && path[2] !== "/") ? path : null;
}

function withoutTrailingSlashes(path: string): string {
  let end = path.length;
  while (end > 1 && path[end - 1] === "/") end--;
  return path.slice(0, end);
}

/** The part of a path inside the vault, by the rules a vault path has; null where it breaks one. */
function safeRelative(relative: string): AcpVaultPath {
  if (relative.length === 0 || relative.length > 1024 || relative.includes(":") || relative.includes("\\")) return { ok: false, problem: "unsafe" };
  const parts = relative.split("/");
  for (const part of parts) {
    if (part === "" || part === "." || part === "..") return { ok: false, problem: "unsafe" };
    // Windows drops trailing dots and spaces: "Private./x" would open "Private/x".
    if (part.endsWith(".") || part.endsWith(" ")) return { ok: false, problem: "unsafe" };
    for (let i = 0; i < part.length; i++) {
      const code = part.charCodeAt(i);
      if (code < 0x20 || code === 0x7f) return { ok: false, problem: "unsafe" };
    }
  }
  // Case-blind on every system: `.PLAINVA` syncs onto `.plainva` the moment the vault reaches another device.
  if ((AI_HIDDEN_ROOTS as readonly string[]).includes(parts[0]!.normalize("NFC").toLowerCase())) return { ok: false, problem: "hidden" };
  return { ok: true, path: parts.join("/").normalize("NFC") };
}

/**
 * The vault path of an absolute path, where it has one. `root` is the vault's
 * folder as the system writes it; it decides whether paths are read the
 * Windows way (a drive letter or a share, either slash, case ignored) or the
 * way of every other system.
 */
export function acpVaultPath(root: string, absolute: string): AcpVaultPath {
  const windowsRoot = windowsForm(root);
  if (windowsRoot !== null) {
    const path = windowsForm(absolute);
    if (path === null) return { ok: false, problem: "not-absolute" };
    const base = withoutTrailingSlashes(windowsRoot);
    if (path.length <= base.length + 1 || path.slice(0, base.length).toLowerCase() !== base.toLowerCase() || path[base.length] !== "/") return { ok: false, problem: "outside" };
    return safeRelative(path.slice(base.length + 1));
  }
  if (!root.startsWith("/")) return { ok: false, problem: "outside" };
  if (!absolute.startsWith("/")) return { ok: false, problem: "not-absolute" };
  const base = withoutTrailingSlashes(root).normalize("NFC");
  const path = absolute.normalize("NFC");
  if (base === "/") return safeRelative(path.slice(1));
  if (path.length <= base.length + 1 || !path.startsWith(`${base}/`)) return { ok: false, problem: "outside" };
  return safeRelative(path.slice(base.length + 1));
}

/** A file of the vault as an address an agent can open: `file:///…`, every part escaped. */
export function acpFileUri(root: string, vaultPath: string): string {
  const windowsRoot = windowsForm(root);
  const base = withoutTrailingSlashes(windowsRoot ?? root);
  const parts = `${base}/${vaultPath}`.split("/").filter((part, index) => part !== "" || index === 0);
  const escaped = parts.map((part, index) => (windowsRoot !== null && index === 0 && /^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part)));
  if (windowsRoot !== null && windowsRoot.startsWith("//")) return `file://${escaped.filter((part) => part !== "").join("/")}`;
  return windowsRoot !== null ? `file:///${escaped.join("/")}` : `file://${escaped.join("/")}`;
}

/** The absolute path of a file of the vault, in the spelling of the vault's own folder — what an agent is told a file is called. */
export function acpAbsolutePath(root: string, vaultPath: string): string {
  const windows = windowsForm(root) !== null;
  const separator = windows && root.includes("\\") ? "\\" : "/";
  let base = root;
  while (base.length > 1 && (base.endsWith("/") || base.endsWith("\\"))) base = base.slice(0, -1);
  return `${base}${separator}${windows && separator === "\\" ? vaultPath.replace(/\//g, "\\") : vaultPath}`;
}
