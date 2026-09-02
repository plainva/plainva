import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A structural file operation must land the editor's pending text first (S2).
 *
 * The save coordinator holds typed text for up to a second and writes it
 * asynchronously. Rename, move or delete a note in that window and the write
 * settles AFTERWARDS — against the path as it was. The note reappears at the
 * old path, the sync queue pushes that ghost to the cloud, and nothing on
 * screen says so. Duplicating is the same bug with a different face: the copy
 * is taken from the last SAVED text, so it silently misses the newest lines.
 *
 * Reading the source is the honest instrument here. `vaultService` imports the
 * Capacitor filesystem, the SQLite adapter and the sync service; a test that
 * mocked all of them would assert against its own mocks, and what actually
 * goes wrong is a missing call in a function someone adds later. That is what
 * this catches. The flush SEMANTICS — pending work is written before the
 * promise resolves, an in-flight write is awaited — is covered for real in
 * saveCoordinator.test.ts.
 */

const read = (name: string) => readFileSync(join(__dirname, name), "utf-8");

/** The body of `async <name>(...)` up to the next top-level method. */
function methodBody(source: string, name: string): string {
  const start = source.indexOf(`async ${name}(`);
  expect(start, `${name} must exist`).toBeGreaterThan(-1);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(open, i);
    }
  }
  throw new Error(`could not delimit ${name}`);
}

/** Is the first flush call ahead of the first file access? */
function flushesFirst(body: string, flush: RegExp): boolean {
  const f = body.search(flush);
  if (f < 0) return false;
  const touch = body.search(/v\.files\.|vaultOps\.|renameFileWithLinkUpdates\(/);
  return touch < 0 || f < touch;
}

describe("vaultOps: pending saves land before a path changes", () => {
  const source = read("vaultService.ts");

  it.each(["rename", "moveNote", "duplicateNote", "remove"])(
    "%s flushes that note before touching the file",
    (name) => {
      expect(flushesFirst(methodBody(source, name), /noteSaver\.flush\(/)).toBe(true);
    },
  );

  it.each(["renameFolder", "removeFolder"])(
    "%s flushes the whole queue — the affected child paths are unknown",
    (name) => {
      expect(flushesFirst(methodBody(source, name), /noteSaver\.flushAll\(/)).toBe(true);
    },
  );

  it("does not flush inside save itself — that is the coordinator's own write", () => {
    // A flush here would call back into the coordinator that is writing, so
    // the guard above must never be "extended" to cover this one.
    expect(methodBody(source, "save")).not.toMatch(/noteSaver\.flush/);
  });
});

describe("the two callers that rewrite notes they do not own", () => {
  it("the cascade lands pending saves before cleaning up references", () => {
    // The cleanup rewrites SURVIVING notes; a late save would put the link to
    // the deleted note straight back.
    const body = read("cascadeDelete.ts");
    const cascade = body.slice(body.indexOf("export async function executeMobileCascade"));
    const flush = cascade.search(/noteSaver\.flushAll\(/);
    expect(flush, "the cascade must flush").toBeGreaterThan(-1);
    expect(flush).toBeLessThan(cascade.search(/removeRelationLinksToNoteShared\(/));
  });

  it("promoting a conflict copy lands the original's pending save first", () => {
    // The original is open and edited — that is what produced the conflict.
    // Since P2 (feedback round 2026-09-01) the promotion lives in the shared
    // conflict sheet, reached from the folder banner and the note's banner.
    const sheet = readFileSync(join(__dirname, "..", "components", "ConflictCompareSheet.tsx"), "utf-8");
    const adopt = sheet.slice(sheet.indexOf("const adopt = async () => {"));
    const flush = adopt.search(/noteSaver\.flush\(originalPath\)/);
    expect(flush, "adopt must flush the original").toBeGreaterThan(-1);
    expect(flush).toBeLessThan(adopt.search(/vaultOps\.save\(/));
  });
});
