import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * B20, fifth review: where the file is the text the screen loaded or last
 * wrote, a database change parses nothing and waits for nothing — one reading
 * to see that, one for the write, as `main` costs. Counted, not timed: the
 * calls of the parser the building block makes, and the readings.
 */
const parses = vi.hoisted(() => ({ count: 0 }));
vi.mock("../../../../packages/ui/src/base/baseFormat", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../../packages/ui/src/base/baseFormat")>();
  return {
    ...real,
    parseBaseConfig: (...args: Parameters<typeof real.parseBaseConfig>) => {
      parses.count += 1;
      return real.parseBaseConfig(...args);
    },
  };
});

import { loadBaseConfigText, serializeBaseConfig, writeBaseConfigChange } from "@plainva/ui";

const FULL = ["formulas:", "  f1: a + 1", "views:", "  - type: table", "    name: Offen", "    order:", "      - note.a", "  - type: cards", "    name: Karten", "    limit: 5", ""].join("\n");
const addView = (shown: any) => ({ ...shown, views: [...shown.views, { type: "list", name: "Neu" }] });

/** A storage without the chain's halves, and one with them: each counts its readings. */
function plain(text: string) {
  let now = text;
  let reads = 0;
  return {
    files: { readTextFile: async () => { reads += 1; return now; }, writeTextFile: async (_p: string, c: string) => { now = c; } },
    reads: () => reads,
    text: () => now,
  };
}
function halves(text: string) {
  let now = text;
  let reads = 0;
  return {
    files: {
      readTextFile: async () => { reads += 1; return now; },
      writeTextFile: async (_p: string, c: string) => { now = c; },
      readTextFileState: async () => { reads += 1; return { text: now, workingCopy: null }; },
      writeTextFileChange: async (_p: string, expected: { text: string }, next: { text: string | null }) => {
        if (expected.text !== now) return null;
        const before = now;
        now = next.text ?? now;
        return { before, text: now, changed: now !== before, conflict: null };
      },
    },
    reads: () => reads,
    text: () => now,
  };
}

describe("the text the screen knows is written at once (B20)", () => {
  beforeEach(() => { parses.count = 0; });

  it("over a storage without the chain's halves: two readings, nothing parsed", async () => {
    const shown = loadBaseConfigText(FULL);
    const next = addView(shown);
    const s = plain(FULL);
    parses.count = 0;
    await writeBaseConfigChange(s.files, "Tasks.base", shown, next);
    expect(s.text()).toBe(serializeBaseConfig(next));
    expect(s.reads()).toBe(2);
    expect(parses.count).toBe(0);
  });

  it("over the chain's halves: one reading, nothing parsed", async () => {
    const shown = loadBaseConfigText(FULL);
    const next = addView(shown);
    const s = halves(FULL);
    parses.count = 0;
    await writeBaseConfigChange(s.files, "Tasks.base", shown, next);
    expect(s.text()).toBe(serializeBaseConfig(next));
    expect(s.reads()).toBe(1);
    expect(parses.count).toBe(0);
  });
});
