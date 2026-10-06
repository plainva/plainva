import { describe, it, expect, beforeEach } from "vitest";
import {
  clearGoverningBaseCache, dirOf, forgetGoverningBases, governingBaseMemory, governingBasesBelongTo, isAncestorDir,
  rankCandidateBases, resolveGoverningBase,
} from "./baseSchema";

/**
 * "Is the answer current" and "what was the answer" are two things (finding
 * 2026-10-06). The one map that held both was emptied on every index update,
 * and whoever asked in between drew "no database" — the properties panel's
 * tags row flickered between two renderers on every save.
 */
describe("baseSchema.resolveGoverningBase — current and remembered", () => {
  const base = [
    "filters:", "  and:", '    - file.folder == "T"', "properties:", "  note.tags:", "    plainva:", "      input: multiselect", "views:",
    "  - type: table", "    name: Liste", "    order:", "      - file.name", "",
  ].join("\n");
  let queries = 0;
  let broken = false;
  let member = true;
  const queryService = {
    db: { query: async () => { if (broken) throw new Error("index busy"); return [{ path: "T/Liste.base" }]; } },
    queryDatabaseFiles: async () => { queries += 1; return member ? [{ "file.path": "T/n.md" }] : []; },
  };
  const adapter = { readTextFile: async () => base };

  beforeEach(() => {
    forgetGoverningBases();
    queries = 0;
    broken = false;
    member = true;
  });

  it("answers from the cache until the index moves, then asks again", async () => {
    const first = await resolveGoverningBase("T/n.md", queryService, adapter);
    expect(first?.basePath).toBe("T/Liste.base");
    expect(first?.columns.tags.input).toBe("multiselect");
    await resolveGoverningBase("T/n.md", queryService, adapter);
    expect(queries).toBe(1);
    clearGoverningBaseCache();
    await resolveGoverningBase("T/n.md", queryService, adapter);
    expect(queries).toBe(2);
  });

  it("an index update does not empty what is known: the last answer stays readable", async () => {
    await resolveGoverningBase("T/n.md", queryService, adapter);
    clearGoverningBaseCache();
    // Between the update and the new answer — the moment the flicker lived in.
    expect(governingBaseMemory.get("T/n.md")?.basePath).toBe("T/Liste.base");
  });

  it("an index that cannot be asked is not 'no database': the known answer is returned and nothing is overwritten", async () => {
    await resolveGoverningBase("T/n.md", queryService, adapter);
    clearGoverningBaseCache();
    broken = true;
    expect((await resolveGoverningBase("T/n.md", queryService, adapter))?.basePath).toBe("T/Liste.base");
    expect(governingBaseMemory.get("T/n.md")?.basePath).toBe("T/Liste.base");
    // ... and the next caller asks again instead of being served the failure.
    broken = false;
    member = false;
    expect(await resolveGoverningBase("T/n.md", queryService, adapter)).toBeNull();
    expect(governingBaseMemory.get("T/n.md")).toBeNull();
  });

  it("another vault knows nothing of this one's notes", async () => {
    governingBasesBelongTo("/vault-a");
    await resolveGoverningBase("T/n.md", queryService, adapter);
    governingBasesBelongTo("/vault-a");
    expect(governingBaseMemory.has("T/n.md")).toBe(true);
    governingBasesBelongTo("/vault-b");
    expect(governingBaseMemory.has("T/n.md")).toBe(false);
  });
});

describe("baseSchema.dirOf", () => {
  it("returns the folder of a path", () => {
    expect(dirOf("a/b/c.md")).toBe("a/b");
    expect(dirOf("root.md")).toBe("");
  });
});

describe("baseSchema.isAncestorDir", () => {
  it("treats the vault root as an ancestor of everything", () => {
    expect(isAncestorDir("", "a/b.md")).toBe(true);
  });
  it("matches only true ancestor folders", () => {
    expect(isAncestorDir("Calendar", "Calendar/Tagebuch/x.md")).toBe(true);
    expect(isAncestorDir("Calendar/Tagebuch", "Calendar/Tagebuch/x.md")).toBe(true);
    expect(isAncestorDir("Efforts", "Calendar/Tagebuch/x.md")).toBe(false);
    expect(isAncestorDir("Cal", "Calendar/x.md")).toBe(false); // prefix, not a folder boundary
  });
});

describe("baseSchema.rankCandidateBases", () => {
  it("keeps only ancestor bases, most-specific (deepest folder) first", () => {
    const bases = [
      "Calendar/Tagebuch_Liste.base",
      "Calendar/Tagebuch/Daily.base",
      "Efforts/Projekte.base",
      "Root.base",
    ];
    expect(rankCandidateBases(bases, "Calendar/Tagebuch/2026-06-23.md")).toEqual([
      "Calendar/Tagebuch/Daily.base",
      "Calendar/Tagebuch_Liste.base",
      "Root.base",
    ]);
  });
  it("excludes the note itself and non-ancestors", () => {
    expect(rankCandidateBases(["Other/x.base"], "Calendar/n.md")).toEqual([]);
  });
});
