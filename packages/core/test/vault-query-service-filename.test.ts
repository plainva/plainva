import { describe, expect, it } from "vitest";
import { VaultQueryService } from "../src/vault/VaultQueryService.ts";
import { MockDatabaseAdapter } from "./mocks/MockDatabaseAdapter.ts";

/** Build-91 feedback, P3: the index lookup behind Obsidian's bare-basename embeds. */
describe("VaultQueryService.findByFileName", () => {
  it("asks for the basename at the vault root or under any folder, escaped", async () => {
    const db = new MockDatabaseAdapter();
    const qs = new VaultQueryService(db);
    db.mockedResults.push([{ path: "Anhänge/foto_1.png" }]);
    expect(await qs.findByFileName("foto_1.png")).toBe("Anhänge/foto_1.png");
    const q = db.queries.find((x) => x.query.includes("FROM files"))!;
    expect(q.params).toEqual(["foto_1.png", "%/foto\\_1.png"]);
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
    db.mockedResults.push([{ path: "Anhänge/foto.png" }, { path: "x/notfoto.png" }]);
    expect(await qs.findByFileName("foto.png")).toBe("Anhänge/foto.png");
    expect(await qs.findByFileName("../foto.png")).toBeNull();
    expect(await qs.findByFileName("")).toBeNull();
  });
});
