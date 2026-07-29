import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PROFILE_FIELDS, travellingAreas, type ProfileFieldArea } from "@plainva/ui";

/**
 * Documentation drift guard (sync-transparency plan P1, step S13).
 *
 * The handbook tells people what the settings sync carries. That promise is
 * only worth something while it matches the code — and the 2026-07-28 finding
 * started exactly there: a list written once by hand, then quietly outgrown.
 * The prose is for the reader; the marker beside it is the machine-readable
 * half, so a field added to the catalog cannot go undocumented in silence.
 *
 * It is deliberately checked in EVERY language: a table that is right in
 * English and stale in Japanese is the same failure, one language further away
 * from anyone who would notice.
 */

const DOCS_USER = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "user");
const MARKER = /<!--\s*plainva:profile-areas\s+([^>]*?)\s*-->/;

function languages(): string[] {
  return readdirSync(DOCS_USER).filter((e) => statSync(join(DOCS_USER, e)).isDirectory()).sort();
}

function documentedAreas(lang: string): string[] {
  const page = readFileSync(join(DOCS_USER, lang, "Sync_Setup.md"), "utf8");
  const match = MARKER.exec(page);
  if (!match) return [];
  return match[1].split(/\s+/).filter(Boolean);
}

describe("settings-sync documentation", () => {
  it("documents exactly the areas the desktop carries, in every language", () => {
    const expected = travellingAreas("desktop");
    for (const lang of languages()) {
      expect(documentedAreas(lang), `docs/user/${lang}/Sync_Setup.md`).toEqual(expected);
    }
  });

  it("gives every catalog field a documented area", () => {
    // A field whose area is missing from the table is a promise nobody made.
    const documented = new Set(documentedAreas("en"));
    for (const field of PROFILE_FIELDS) {
      expect(documented, `${field.logical} (area ${field.area})`).toContain(field.area as ProfileFieldArea);
    }
  });

  it("lists one table row per area, so the marker cannot drift from the prose", () => {
    for (const lang of languages()) {
      const page = readFileSync(join(DOCS_USER, lang, "Sync_Setup.md"), "utf8");
      const after = page.slice(page.search(MARKER));
      const rows = after.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| ---"));
      // header row + one row per area
      expect(rows.length, `docs/user/${lang}/Sync_Setup.md`).toBe(documentedAreas(lang).length + 1);
    }
  });
});
