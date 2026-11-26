import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The sync's modules load on demand (performance plan L5). A start checks its generation (`generation !==
 * startGeneration`) before it builds a worker: a load awaited between the check and the build would let a start that
 * was stopped in that moment build its worker after all (review of L5, 2026-11-25). Each start loads its modules
 * first, and builds from them without waiting again.
 */
const SOURCE = readFileSync(join(__dirname, "syncService.ts"), "utf8");
const body = (name: string) => {
  const at = SOURCE.indexOf(`async function ${name}(`);
  const next = SOURCE.indexOf("\nasync function ", at + 1);
  const nextExport = SOURCE.indexOf("\nexport ", at + 1);
  return SOURCE.slice(at, Math.min(...[next, nextExport].filter((i) => i > at)));
};

describe("the phone's sync start", () => {
  it("loads its modules before its checks, and never in between", () => {
    expect.hasAssertions();
    for (const name of ["startWorker", "startSettingsOnly"]) {
      const text = body(name);
      expect(text, name).toMatch(/\{\s*(?:\/\/[^\n]*\n\s*)*const sync = await syncModules\(\);/);
      expect([...text.matchAll(/await syncModules\(\)|await workspaceModule\(\)/g)].length, name).toBeLessThanOrEqual(2);
      expect(text, name).not.toMatch(/\(await (?:syncModules|workspaceModule)\(\)\)\./);
    }
  });
});
