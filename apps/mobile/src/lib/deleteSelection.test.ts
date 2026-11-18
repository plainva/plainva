import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deleteSelectedFiles } from "./deleteSelection";

/**
 * A database view after deleting its selection (review of release 0.9.0): a
 * run that failed half-way answered `[]`, the view did not ask again and kept
 * the selection, although some of the files were gone.
 */
describe("deleteSelectedFiles", () => {
  const harness = (confirm: () => Promise<string[]>) => {
    const log: string[] = [];
    const run = {
      confirm,
      refresh: () => void log.push("refresh"),
      onDeleted: (deleted: string[]) => void log.push(`deleted:${deleted.join(",")}`),
      onError: (error: unknown) => void log.push(`error:${(error as Error).message}`),
    };
    return { log, run };
  };

  it("asks the view again after an error, where some files may already be gone", async () => {
    const { log, run } = harness(async () => {
      throw new Error("b.md: device busy");
    });
    await deleteSelectedFiles(["a.md", "b.md"], run);
    expect(log).toEqual(["error:b.md: device busy", "refresh"]);
  });

  it("hands on what went and asks again; a cancelled run changes nothing", async () => {
    const done = harness(async () => ["a.md"]);
    await deleteSelectedFiles(["a.md", "b.md"], done.run);
    expect(done.log).toEqual(["deleted:a.md", "refresh"]);
    const cancelled = harness(async () => []);
    await deleteSelectedFiles(["a.md"], cancelled.run);
    expect(cancelled.log).toEqual([]);
  });

  it("is what the database view deletes its selection with", () => {
    const screen = readFileSync(resolve("src/screens/base/BaseScreen.tsx"), "utf8");
    expect(screen).toMatch(/await deleteSelectedFiles\(paths, \{\n\s*confirm: \(\) => confirmDeleteFiles\(vault, paths, t\),/);
  });
});
