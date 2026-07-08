import {
  okfConceptFrontmatterSchema,
  plainvaCreatedFrontmatterSchema,
  readableFrontmatterSchema
} from "../src/metadata.ts";
import { describe, expect, it } from "vitest";

describe("readableFrontmatterSchema", () => {
  it("accepts existing Obsidian-compatible frontmatter without OKF fields", () => {
    const result = readableFrontmatterSchema.parse({
      aliases: ["Project Alpha"],
      cssclasses: ["dashboard"],
      private: {
        rating: 5,
        archived: false,
        notes: null
      },
      tags: ["plainva/core", "phase-1"]
    });

    expect(result).toMatchObject({
      aliases: ["Project Alpha"],
      cssclasses: ["dashboard"],
      tags: ["plainva/core", "phase-1"]
    });
  });
});

describe("okfConceptFrontmatterSchema", () => {
  it("accepts valid OKF v0.1 concept frontmatter and preserves unknown keys", () => {
    const result = okfConceptFrontmatterSchema.parse({
      type: "Reference",
      title: "Markdown roundtrip notes",
      description: "A short note about the Phase 0 roundtrip spike.",
      resource: "https://plainva.com/docs/roundtrip",
      tags: ["markdown", "roundtrip"],
      timestamp: "2026-06-23T10:15:00Z",
      okf_version: "0.1",
      plainva_reviewed: true
    });

    expect(result).toMatchObject({
      type: "Reference",
      okf_version: "0.1",
      plainva_reviewed: true
    });
  });

  it("rejects missing or blank OKF type values", () => {
    expect(okfConceptFrontmatterSchema.safeParse({ title: "Missing type" }).success).toBe(false);
    expect(okfConceptFrontmatterSchema.safeParse({ type: "   " }).success).toBe(false);
  });

  it("rejects malformed known metadata fields", () => {
    // tags: "plainva" is now valid due to stringOrArrayToArray
    expect(okfConceptFrontmatterSchema.safeParse({ type: "Reference", resource: "not a url" }).success).toBe(false);
    expect(okfConceptFrontmatterSchema.safeParse({ type: "Reference", timestamp: "23.06.2026" }).success).toBe(false);
  });
});

describe("plainvaCreatedFrontmatterSchema", () => {
  it("requires Plainva-created notes to carry the supported OKF version", () => {
    expect(
      plainvaCreatedFrontmatterSchema.safeParse({
        type: "Meeting Note",
        okf_version: "0.1"
      }).success
    ).toBe(true);

    expect(plainvaCreatedFrontmatterSchema.safeParse({ type: "Meeting Note" }).success).toBe(false);
    expect(
      plainvaCreatedFrontmatterSchema.safeParse({
        type: "Meeting Note",
        okf_version: "1.0"
      }).success
    ).toBe(false);
  });
});
