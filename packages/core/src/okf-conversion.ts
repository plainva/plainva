import { parse as parseYaml } from "yaml";
import {
  ensureOkfFrontmatter,
  renameFrontmatterKey,
  FrontmatterSurgicalError,
} from "./frontmatter-surgical.js";
import { OKF_VERSION } from "./metadata.js";

/**
 * OKF conformance scan + conversion (OKF SPEC v0.1 §9), used by the desktop
 * conversion wizard and the settings badge. The scan checks the three hard
 * conformance rules; everything else in the spec is soft guidance and stays
 * out of scope here (deeper structure linting belongs to modes B/C).
 */

export type OkfViolationKind =
  | "missing-frontmatter"
  | "unparseable-frontmatter"
  | "missing-type"
  | "empty-type"
  | "non-string-type"
  | "reserved-name-concept";

export interface OkfViolation {
  path: string;
  kind: OkfViolationKind;
}

export interface OkfScanResult {
  /** Files actually checked (after exclusions). */
  scanned: number;
  violations: OkfViolation[];
  /** Non-reserved, parseable files — the conversion sweep operates on these. */
  convertiblePaths: string[];
  /** Files that already carry a valid string `type` (relevant for the rename strategy). */
  typedPaths: string[];
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export function isReservedOkfName(path: string): boolean {
  const base = path.split(/[/\\]/).pop()?.toLowerCase();
  return base === "index.md" || base === "log.md";
}

/** True for paths inside dot-folders (.obsidian, .plainva, …), `.trash` or an excluded folder. */
export function isExcludedFromOkfScan(path: string, excludeFolders: string[] = []): boolean {
  const segments = path.split(/[/\\]/);
  if (segments.slice(0, -1).some((s) => s.startsWith(".") || s.toLowerCase() === ".trash")) return true;
  if (segments[segments.length - 1]?.startsWith(".")) return true;
  const normalized = path.replace(/\\/g, "/");
  return excludeFolders.some((folder) => {
    const f = folder.replace(/\\/g, "/").replace(/\/+$/, "");
    return f !== "" && (normalized === f || normalized.startsWith(`${f}/`));
  });
}

function parseFrontmatterBlock(content: string): { block: string | null; data: unknown; parseError: boolean } {
  const match = content.match(FM_RE);
  if (!match) return { block: null, data: null, parseError: false };
  try {
    return { block: match[1], data: parseYaml(match[1]), parseError: false };
  } catch {
    return { block: match[1], data: null, parseError: true };
  }
}

/** Classifies one file against the hard OKF conformance rules. Returns null when conform. */
export function classifyOkfFile(path: string, content: string, vaultRootIndexPath = "index.md"): OkfViolationKind | null {
  const { block, data, parseError } = parseFrontmatterBlock(content);

  if (isReservedOkfName(path)) {
    // Reserved files must not be concept documents. index.md/log.md without
    // frontmatter are fine; the bundle-root index.md may carry exactly
    // `okf_version` (SPEC §11 — the sole frontmatter exception).
    if (block === null) return null;
    if (parseError) return "reserved-name-concept";
    if (
      path === vaultRootIndexPath &&
      typeof data === "object" &&
      data !== null &&
      !Array.isArray(data) &&
      Object.keys(data as Record<string, unknown>).every((k) => k === "okf_version")
    ) {
      return null;
    }
    return "reserved-name-concept";
  }

  if (block === null) return "missing-frontmatter";
  if (parseError) return "unparseable-frontmatter";
  if (typeof data !== "object" || data === null || Array.isArray(data)) return "unparseable-frontmatter";

  const type = (data as Record<string, unknown>).type;
  if (type === undefined || type === null) return "missing-type";
  if (typeof type !== "string") return "non-string-type";
  if (type.trim() === "") return "empty-type";
  return null;
}

export interface OkfScanInput {
  /** Relative markdown file paths (forward slashes). */
  paths: string[];
  readTextFile(path: string): Promise<string>;
  /** Folders whose contents are skipped entirely (e.g. the template folder). */
  excludeFolders?: string[];
}

export async function scanOkfConformance(input: OkfScanInput): Promise<OkfScanResult> {
  const violations: OkfViolation[] = [];
  const convertiblePaths: string[] = [];
  const typedPaths: string[] = [];
  let scanned = 0;

  for (const path of input.paths) {
    if (!path.toLowerCase().endsWith(".md")) continue;
    if (isExcludedFromOkfScan(path, input.excludeFolders)) continue;
    let content: string;
    try {
      content = await input.readTextFile(path);
    } catch {
      continue; // unreadable file: not a conformance statement
    }
    scanned++;
    const kind = classifyOkfFile(path, content);
    if (kind) violations.push({ path, kind });

    if (!isReservedOkfName(path) && kind !== "unparseable-frontmatter") {
      convertiblePaths.push(path);
      if (kind === null) {
        const { data } = parseFrontmatterBlock(content);
        const type = (data as Record<string, unknown> | null)?.type;
        if (typeof type === "string" && type.trim() !== "") typedPaths.push(path);
      }
    }
  }

  return { scanned, violations, convertiblePaths, typedPaths };
}

export interface OkfConversionOptions {
  /** `type` value for files without a valid one. */
  defaultType: string;
  okfVersion?: string;
  /**
   * "keep" (default): existing non-empty string types are already valid OKF
   * types and stay untouched. "rename": move them to `renameTo` and set
   * defaultType — for vaults whose `type` semantics collide with OKF.
   */
  existingTypeStrategy?: "keep" | "rename";
  renameTo?: string;
}

export interface OkfFileConversionResult {
  content: string;
  changed: boolean;
  setType: boolean;
  setOkfVersion: boolean;
  renamedType: boolean;
}

/**
 * Converts one document to the OKF minimum (surgical edits only — untouched
 * keys, comments and the body stay byte-identical). Throws
 * FrontmatterSurgicalError on documents that cannot be edited safely.
 */
export function convertFileToOkf(content: string, options: OkfConversionOptions): OkfFileConversionResult {
  const okfVersion = options.okfVersion ?? OKF_VERSION;
  const strategy = options.existingTypeStrategy ?? "keep";
  const renameTo = options.renameTo?.trim() || "type_original";

  let current = content;
  let renamedType = false;

  const { data, parseError } = parseFrontmatterBlock(current);
  if (parseError) {
    throw new FrontmatterSurgicalError("Frontmatter is not parseable YAML");
  }
  const existingType = (data as Record<string, unknown> | null)?.type;
  const isValidString = typeof existingType === "string" && existingType.trim() !== "";
  const isNonString = existingType !== undefined && existingType !== null && typeof existingType !== "string";

  // Non-string types violate the spec and must move aside; valid string types
  // move only when the user explicitly chose the rename strategy.
  if (isNonString || (isValidString && strategy === "rename")) {
    const renamed = renameFrontmatterKey(current, "type", renameTo);
    if (renamed === current) {
      // Should not happen (type exists) — treat defensively as unchanged.
    } else {
      current = renamed;
      renamedType = true;
    }
  }

  const ensured = ensureOkfFrontmatter(current, { type: options.defaultType, okfVersion });
  return {
    content: ensured.content,
    changed: ensured.changed || renamedType,
    setType: ensured.setType,
    setOkfVersion: ensured.setOkfVersion,
    renamedType,
  };
}
