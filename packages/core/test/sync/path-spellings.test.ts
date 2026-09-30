import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PathSpellings } from "../../src/sync/pathSpellings.js";
import { hasSpellingVariants, isTwinSpelling, toPathIdentity } from "../../src/sync/pathIdentity.js";
import { LocalVaultAdapter } from "../../src/vault/LocalVaultAdapter.js";

/**
 * ADR 0016: a path is identified by its NFC form; the spelling a store keeps
 * is resolved at each access and never renamed. These run on the CI's ext4,
 * a byte-exact file system, so both spellings can sit side by side exactly
 * as a WebDAV server or an Android sandbox would hold them.
 */

// Built by normalizing, so a tool that rewrites this file cannot silently turn
// the two spellings into one (the tests would then pass for nothing).
const NFC = "Neutralität".normalize("NFC");
const NFD = NFC.normalize("NFD");

describe("path identity helpers", () => {
  it("tells which names can be spelled two ways at all", () => {
    expect(NFC).not.toBe(NFD);
    expect(hasSpellingVariants(NFC)).toBe(true);
    expect(hasSpellingVariants(NFD)).toBe(true);
    expect(hasSpellingVariants("Notes/plain.md")).toBe(false);
    // A script without composed characters has one spelling only.
    expect(hasSpellingVariants("母/日本語.md".normalize("NFC"))).toBe(false);
    expect(toPathIdentity(`${NFD}/a.md`)).toBe(`${NFC}/a.md`);
    expect(isTwinSpelling(`${NFD}/a.md`)).toBe(true);
    expect(isTwinSpelling(`${NFC}/a.md`)).toBe(false);
  });
});

describe("PathSpellings", () => {
  it("names a decomposed listing by its composed identity and resolves back", async () => {
    const s = new PathSpellings();
    const ids = s.observe([NFD, `${NFD}/a.md`, "Plain/b.md"]);
    expect(ids.get(`${NFD}/a.md`)).toBe(`${NFC}/a.md`);
    expect(ids.get("Plain/b.md")).toBe("Plain/b.md");
    expect(s.resolveKnown(`${NFC}/a.md`)).toBe(`${NFD}/a.md`);
    // A new name inside the known folder: the folder as stored, the name composed.
    expect(s.resolveKnown(`${NFC}/Übersicht.md`)).toBe(`${NFD}/${"Übersicht.md".normalize("NFC")}`);
    expect(s.identityOfStored(`${NFD}/c.md`)).toBe(`${NFC}/c.md`);
  });

  it("keeps two spellings side by side apart: the composed one wins, the other is a twin", () => {
    const s = new PathSpellings();
    const ids = s.observe([`${NFD}/a.md`, `${NFC}/a.md`, `${NFD}/only-decomposed.md`]);
    expect(ids.get(NFC)).toBe(NFC);
    expect(ids.get(NFD)).toBe(NFD);
    expect(ids.get(`${NFC}/a.md`)).toBe(`${NFC}/a.md`);
    // Everything under the twin stays in the twin: its identity keeps the bytes.
    expect(ids.get(`${NFD}/a.md`)).toBe(`${NFD}/a.md`);
    expect(ids.get(`${NFD}/only-decomposed.md`)).toBe(`${NFD}/only-decomposed.md`);
    expect(isTwinSpelling(ids.get(`${NFD}/only-decomposed.md`)!)).toBe(true);
    expect(s.resolveKnown(`${NFC}/a.md`)).toBe(`${NFC}/a.md`);
    expect(s.resolveKnown(`${NFD}/a.md`)).toBe(`${NFD}/a.md`);
  });

  it("asks a folder listing only for a segment it has not seen, once per pass", async () => {
    const s = new PathSpellings();
    const asked: string[] = [];
    const source = {
      listNames: async (raw: string) => {
        asked.push(raw);
        return raw === "" ? [NFD, "Plain"] : raw === NFD ? ["a.md"] : null;
      },
    };
    const cache = new Map();
    expect(await s.resolve(`${NFC}/a.md`, source, cache)).toBe(`${NFD}/a.md`);
    expect(await s.resolve(`${NFC}/b.md`, source, cache)).toBe(`${NFD}/b.md`);
    expect(await s.resolve("Plain/x.md", source, cache)).toBe("Plain/x.md");
    expect(await s.resolve(`Neu/${NFC}/x.md`, source, cache)).toBe(`Neu/${NFC}/x.md`);
    // The root once, the known folder never again, an ASCII path never; a
    // new folder is asked about once, where its accented child would go.
    expect(asked).toEqual(["", "Neu"]);
  });

  it("forgets a spelling once the path is gone", () => {
    const s = new PathSpellings();
    s.observe([`${NFD}/a.md`]);
    s.forget(NFC);
    expect(s.resolveKnown(`${NFC}/a.md`)).toBe(`${NFC}/a.md`);
  });
});

describe("LocalVaultAdapter on a byte-exact disk", () => {
  let root: string;
  let vault: LocalVaultAdapter;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "plainva-spellings-"));
    vault = new LocalVaultAdapter(root);
    await vault.initialize();
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("lists a folder made in Finder under its composed identity and reads and writes through it", async () => {
    await mkdir(join(root, NFD));
    await writeFile(join(root, NFD, "Notiz.md"), "body");

    const listed = (await vault.listDir("", true)).map((e) => e.path).sort();
    expect(listed).toEqual([NFC, `${NFC}/Notiz.md`]);
    expect(await vault.exists(`${NFC}/Notiz.md`)).toBe(true);
    expect(await vault.readTextFile(`${NFC}/Notiz.md`)).toBe("body");
    expect((await vault.getFileInfo(`${NFC}/Notiz.md`)).path).toBe(`${NFC}/Notiz.md`);

    // A write into the folder lands in the folder that is there — no second,
    // identical-looking folder next to it. Nothing was renamed either.
    await vault.writeTextFile(`${NFC}/Neu.md`, "new");
    expect(await readdir(root)).toEqual([NFD]);
    expect((await readdir(join(root, NFD))).sort()).toEqual(["Neu.md", "Notiz.md"]);
  });

  it("names the backup inventory by identity too", async () => {
    await mkdir(join(root, NFD));
    await writeFile(join(root, NFD, "Notiz.md"), "body");
    const inventory = (await vault.listDirForBackup([".git"])).map((e) => e.path).sort();
    expect(inventory).toEqual([NFC, `${NFC}/Notiz.md`]);
  });

  it("creates new names composed, whichever spelling the caller typed", async () => {
    await vault.writeTextFile(`${NFD}/typed.md`, "x");
    await vault.createDir(`Ordner/${"Übersicht".normalize("NFD")}`);
    expect(await readdir(root)).toEqual(expect.arrayContaining([NFC, "Ordner"]));
    expect(await readdir(join(root, "Ordner"))).toEqual(["Übersicht".normalize("NFC")]);
    // The caller's spelling still reaches the file.
    expect(await vault.readTextFile(`${NFD}/typed.md`)).toBe("x");
  });

  it("keeps a real twin a twin: both spellings on disk stay two files", async () => {
    await mkdir(join(root, NFC));
    await mkdir(join(root, NFD));
    await writeFile(join(root, NFC, "a.md"), "composed");
    await writeFile(join(root, NFD, "a.md"), "decomposed");

    const listed = (await vault.listDir("", true)).filter((e) => !e.isDirectory).map((e) => e.path).sort();
    expect(listed).toEqual([`${NFC}/a.md`, `${NFD}/a.md`].sort());
    expect(await vault.readTextFile(`${NFC}/a.md`)).toBe("composed");
    expect(await vault.readTextFile(`${NFD}/a.md`)).toBe("decomposed");
  });

  it("renames and deletes through the stored spelling and follows an outside rename", async () => {
    await mkdir(join(root, NFD));
    await writeFile(join(root, NFD, "a.md"), "body");
    await vault.listDir("", true);

    await vault.renameItem(`${NFC}/a.md`, `${NFC}/b.md`);
    expect(await readdir(join(root, NFD))).toEqual(["b.md"]);
    await vault.deleteItem(`${NFC}/b.md`);
    expect(await readdir(join(root, NFD))).toEqual([]);
  });
});
