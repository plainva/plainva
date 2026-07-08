import { z } from "zod";

export type FrontmatterValue =
  | string
  | number
  | boolean
  | null
  | Date
  | FrontmatterValue[]
  | { [key: string]: FrontmatterValue };

export const nonEmptyStringSchema = z
  .string()
  .refine((value) => value.trim().length > 0, "Expected a non-empty string");

/** Strict version literal for content Plainva writes (OKF spec version we target). */
export const okfVersionSchema = z.literal("0.1");

/**
 * Tolerant read-side schema: files declaring a newer/unknown okf_version must
 * stay readable ("permissive consumption", OKF SPEC §9/§11). Validation against
 * a specific spec version is the job of the versioned linter, not of parsing.
 */
export const okfVersionReadSchema = nonEmptyStringSchema;

export const OKF_VERSION = "0.1" as const;

export const frontmatterValueSchema: z.ZodType<FrontmatterValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.date(),
    z.array(frontmatterValueSchema),
    z.record(z.string(), frontmatterValueSchema)
  ])
);

const stringOrArrayToArray = z.preprocess((val) => {
  if (typeof val === 'string') {
    return val.split(',').map(s => s.trim()).filter(Boolean);
  }
  return val;
}, z.array(nonEmptyStringSchema).optional());

const commonFrontmatterFields = {
  title: z.string().optional(),
  description: z.string().optional(),
  resource: z.string().url().optional(),
  tags: stringOrArrayToArray,
  aliases: stringOrArrayToArray,
  timestamp: z.string().datetime({ offset: true }).optional(),
  okf_version: okfVersionReadSchema.optional()
};

export const readableFrontmatterSchema = z
  .object({
    type: z.string().optional(),
    ...commonFrontmatterFields
  })
  .catchall(frontmatterValueSchema);

export const okfConceptFrontmatterSchema = readableFrontmatterSchema.extend({
  type: nonEmptyStringSchema
});

export const plainvaCreatedFrontmatterSchema = okfConceptFrontmatterSchema.extend({
  okf_version: okfVersionSchema
});

export type ReadableFrontmatter = z.infer<typeof readableFrontmatterSchema>;
export type OkfConceptFrontmatter = z.infer<typeof okfConceptFrontmatterSchema>;
export type PlainvaCreatedFrontmatter = z.infer<typeof plainvaCreatedFrontmatterSchema>;

/**
 * Plainva-specific presentation metadata lives in a single nested namespace
 * key so the top-level property space stays reserved for OKF/Obsidian fields.
 * OKF consumers must tolerate and round-trip unknown keys (SPEC §4.1), so the
 * namespace is spec-safe; Obsidian keeps nested keys intact when files are
 * edited there.
 */
export const PLAINVA_NAMESPACE_KEY = "plainva" as const;

export interface PlainvaDocMeta {
  /** Emoji/grapheme, or an icon-set reference like "lucide:rocket". */
  icon?: string;
  /** Optional tint for icon-set icons (hex); ignored for emoji. */
  iconColor?: string;
  headerColor?: string;
}

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * Safe accessor for the `plainva` namespace of a parsed frontmatter object.
 * Malformed shapes (non-object namespace, non-string icon, invalid color)
 * yield an empty/partial result instead of an error — presentation metadata
 * must never make a document unreadable.
 */
export function getPlainvaMeta(
  frontmatter: Record<string, unknown> | null | undefined
): PlainvaDocMeta {
  if (!frontmatter) {
    return {};
  }
  const ns = frontmatter[PLAINVA_NAMESPACE_KEY];
  if (typeof ns !== "object" || ns === null || Array.isArray(ns)) {
    return {};
  }
  const record = ns as Record<string, unknown>;
  const meta: PlainvaDocMeta = {};
  if (typeof record.icon === "string" && record.icon.trim().length > 0) {
    meta.icon = record.icon.trim();
  }
  if (typeof record.icon_color === "string" && HEX_COLOR_RE.test(record.icon_color.trim())) {
    meta.iconColor = record.icon_color.trim();
  }
  if (typeof record.header_color === "string" && HEX_COLOR_RE.test(record.header_color.trim())) {
    meta.headerColor = record.header_color.trim();
  }
  return meta;
}
