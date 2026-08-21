import {
  okfConceptFrontmatterSchema,
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

  it("coerces a bare YAML number okf_version instead of failing the whole parse", () => {
    // `okf_version: 1` (unquoted) parses as a number; a hand-written note must
    // not silently lose all indexed properties/tags over the missing quotes.
    const result = readableFrontmatterSchema.parse({
      okf_version: 1,
      tags: ["kept"],
      status: "active"
    });
    expect(result.okf_version).toBe("1");
    expect(result).toMatchObject({ tags: ["kept"], status: "active" });
    // Decimals keep their numeric string form.
    expect(readableFrontmatterSchema.parse({ okf_version: 0.1 }).okf_version).toBe("0.1");
    // Non-coercible shapes still fail (tolerance is for numbers only).
    expect(readableFrontmatterSchema.safeParse({ okf_version: true }).success).toBe(false);
  });

  it("reads the OKF v0.2 trust-signal keys tolerantly (form-checked later, never rejected)", () => {
    // The spec forbids rejecting a document over a field's shape, and Plainva's
    // task databases use `status` with their own values — so the parse keeps
    // every shape and leaves the form check to parseOkfTrustSignals.
    const result = readableFrontmatterSchema.parse({
      type: "Note",
      generated: { by: "plainva-import/0.6.7", at: "2026-08-21T10:00:00Z" },
      verified: { by: "human:marco", at: "2026-08-21T11:00:00Z" },
      sources: [{ resource: "https://example.org/x", title: "X" }],
      stale_after: "2026-12-31",
      status: "Offen"
    });
    expect(result.status).toBe("Offen");
    expect(result.verified).toEqual({ by: "human:marco", at: "2026-08-21T11:00:00Z" });
    expect(result.stale_after).toBe("2026-12-31");
    expect(readableFrontmatterSchema.safeParse({ generated: "not a mapping", verified: 42 }).success).toBe(true);
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
