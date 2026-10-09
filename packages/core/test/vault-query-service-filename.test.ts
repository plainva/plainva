import { describe, expect, it } from "vitest";
import { VaultQueryService } from "../src/vault/VaultQueryService.ts";
import { MockDatabaseAdapter } from "./mocks/MockDatabaseAdapter.ts";

/**
 * Build-91 feedback, P3: the index lookup behind Obsidian's bare-basename embeds.
 *
 * The answer is the link rule's since 2026-10-09, read from its one corpus. A
 * query of its own stood behind it before: it folded A to Z only, looked at
 * fifty rows at most and left two paths of one length to the order the
 * database handed them out — the desktop's pictures followed it while the
 * phone's and the graph followed the rule.
 */
describe("VaultQueryService.findByFileName", () => {
  it("finds the basename at the vault root or under any folder, and takes a `_` in it literally", async () => {
    const db = new MockDatabaseAdapter();
    const qs = new VaultQueryService(db);
    db.mockedResults.push([{ path: "Anhänge/fotoX1.png" }, { path: "Anhänge/foto_1.png" }]);
    expect(await qs.findByFileName("foto_1.png")).toBe("Anhänge/foto_1.png");
    // One read of the files a link can lead to — no query of its own.
    expect(db.queries).toHaveLength(1);
    expect(db.queries[0].query).toContain("FROM files WHERE is_deleted IS NULL OR is_deleted = 0");
  });

  it("prefers the note's own folder, then the shortest path", async () => {
    const db = new MockDatabaseAdapter();
    const qs = new VaultQueryService(db);
    db.mockedResults.push([{ path: "a/foto.png" }, { path: "Tagebuch/foto.png" }]);
    expect(await qs.findByFileName("foto.png", "Tagebuch/26.08.31.md")).toBe("Tagebuch/foto.png");
    db.mockedResults.push([{ path: "a/foto.png" }, { path: "Tagebuch/foto.png" }]);
    expect(await qs.findByFileName("foto.png", "x.md")).toBe("a/foto.png");
  });

  it("matches a decomposed folder name and drops LIKE false positives", async () => {
    const db = new MockDatabaseAdapter();
    const qs = new VaultQueryService(db);
    db.mockedResults.push([{ path: "Anhänge/foto.png" }, { path: "x/notfoto.png" }]);
    expect(await qs.findByFileName("foto.png")).toBe("Anhänge/foto.png");
    expect(await qs.findByFileName("../foto.png")).toBeNull();
    expect(await qs.findByFileName("")).toBeNull();
  });

  /** One question against a vault of these files. */
  async function ask(paths: string[], basename: string, nearPath?: string): Promise<string | null> {
    const db = new MockDatabaseAdapter();
    db.mockedResults.push(paths.map((path) => ({ path })));
    return new VaultQueryService(db).findByFileName(basename, nearPath);
  }

  it("answers two paths of one length the same, whichever the index names first", async () => {
    expect(await ask(["b/foto.png", "a/foto.png"], "foto.png", "x.md")).toBe("a/foto.png");
    expect(await ask(["a/foto.png", "b/foto.png"], "foto.png", "x.md")).toBe("a/foto.png");
  });

  it("reads a letter beyond A to Z without regard to case, and a decomposed name as the composed one", async () => {
    expect(await ask(["Bilder/Übersicht.png"], "übersicht.png")).toBe("Bilder/Übersicht.png");
    // macOS and the iOS Files app hand names out decomposed.
    const decomposed = `${"Anhänge".normalize("NFD")}/${"Käse.png".normalize("NFD")}`;
    expect(decomposed).not.toBe("Anhänge/Käse.png");
    expect(await ask([decomposed, "x/notKäse.png"], "Käse.png")).toBe(decomposed);
  });

  it("answers a bare file name only", async () => {
    expect(await ask(["Anhänge/foto.png"], "Anhänge/foto.png")).toBeNull();
    expect(await ask(["Anhänge/foto.png"], "bild.png")).toBeNull();
  });
});
