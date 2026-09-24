import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * A parent of an `ON DELETE CASCADE` is never written with REPLACE (finding
 * 2026-09-24).
 *
 * SQLite's REPLACE resolves a conflict by DELETING the old row and inserting a
 * new one — and with foreign keys on, that delete cascades. `pim_accounts` was
 * upserted that way, so every re-save of an account (the connect wizard right
 * after connecting, every settings sync, every profile import) emptied its
 * calendars and task lists. They came back on the next pull, all selected
 * again, and task lists the person had switched off were imported into the
 * vault once more. The wizard said "0 calendars found".
 *
 * The parents are read from the schema itself, so a new cascade is covered the
 * day it is added.
 */

const REPO = resolve(__dirname, "../../..");
const SCHEMA = join(REPO, "packages/core/src/db/Schema.ts");
const ROOTS = ["packages/core/src", "packages/ui/src", "apps/desktop/src", "apps/mobile/src"];

/** Writes that are meant to drop the children, each with its reason. */
const ALLOWED: Record<string, string> = {
  // The parse-failure fallback of the indexer: the file's content could not be
  // parsed, so the links, tags and properties derived from its OLD content must
  // go with the old row — they are rebuilt from the file on the next index.
  "packages/core/src/vault/VaultIndexer.ts:files": "derived rows are rebuilt from the file",
};

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function cascadeParents(schema: string): Set<string> {
  const parents = new Set<string>();
  for (const m of schema.matchAll(/REFERENCES\s+(\w+)\s*\([^)]*\)\s*ON\s+DELETE\s+CASCADE/gi)) parents.add(m[1]);
  return parents;
}

describe("cascade parents", () => {
  it("are found in the schema", () => {
    expect([...cascadeParents(readFileSync(SCHEMA, "utf8"))].sort()).toEqual(expect.arrayContaining(["files", "pim_accounts"]));
  });

  it("are never written with INSERT OR REPLACE / REPLACE INTO", () => {
    const parents = cascadeParents(readFileSync(SCHEMA, "utf8"));
    const findings: string[] = [];
    const allowedHit = new Set<string>();
    for (const root of ROOTS) {
      for (const file of sourceFiles(join(REPO, root))) {
        const rel = relative(REPO, file).replace(/\\/g, "/");
        const source = readFileSync(file, "utf8");
        for (const m of source.matchAll(/(?:INSERT\s+OR\s+REPLACE|REPLACE)\s+INTO\s+(\w+)/gi)) {
          if (!parents.has(m[1])) continue;
          const key = `${rel}:${m[1]}`;
          if (ALLOWED[key]) allowedHit.add(key);
          else findings.push(`${key}: ${m[0]}`);
        }
      }
    }
    expect(
      findings,
      "REPLACE deletes the old row, and the delete cascades to its children. Use INSERT … ON CONFLICT(id) DO UPDATE.\n  " +
        findings.join("\n  "),
    ).toEqual([]);
    expect(Object.keys(ALLOWED).filter((key) => !allowedHit.has(key)), "stale entries in ALLOWED").toEqual([]);
  });
});
