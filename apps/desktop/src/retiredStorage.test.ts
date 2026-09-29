// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { removeRetiredStorage } from "@plainva/ui";

/**
 * The task trace is gone (plan Befunde 2026-09-24, E13) — and so is what it
 * left on a device whose switch stayed on: provider task rows with ids, dates
 * and the start of every title. Both shells sweep those keys at start.
 */

function memoryStorage(entries: Record<string, string>) {
  const data = new Map(Object.entries(entries));
  return {
    data,
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (k: string) => void data.delete(k),
  };
}

describe("retired storage", () => {
  it("removes the task trace's flag and buffer, and nothing else", () => {
    const storage = memoryStorage({
      "plainva-pim-trace": "on",
      "plainva-pim-trace-log": JSON.stringify([{ provider: "google", rows: [{ id: "t1", title: "Zahnarzt anr" }] }]),
      "plainva-pim-accounts": "keep",
      "plainva-task-dupes-seen-vault": "keep",
    });
    expect(removeRetiredStorage(storage).sort()).toEqual(["plainva-pim-trace", "plainva-pim-trace-log"]);
    expect([...storage.data.keys()].sort()).toEqual(["plainva-pim-accounts", "plainva-task-dupes-seen-vault"]);
    // A second start finds nothing to do.
    expect(removeRetiredStorage(storage)).toEqual([]);
  });

  it("survives a storage that cannot be read", () => {
    expect(removeRetiredStorage(null)).toEqual([]);
    const broken = { get length(): number { throw new Error("blocked"); }, key: () => null, removeItem: () => {} };
    expect(removeRetiredStorage(broken)).toEqual([]);
  });

  it("runs at start in both shells", () => {
    for (const shell of ["desktop", "mobile"]) {
      const main = readFileSync(join(__dirname, "..", "..", shell, "src", "main.tsx"), "utf8");
      expect(main, `${shell} main.tsx`).toMatch(/removeRetiredStorage\(\);/);
      expect(main, `${shell} main.tsx`).not.toMatch(/initPimTrace/);
    }
  });
});
