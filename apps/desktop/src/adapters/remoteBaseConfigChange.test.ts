import { describe, expect, it } from "vitest";
import type { IVaultAdapter, TextFileChange, TextFileState } from "@plainva/core";
import { loadBaseConfigText, writeBaseConfigChange } from "@plainva/ui";
import { RemoteVaultAdapter } from "./RemoteVaultAdapter";
import type { WindowBus } from "../services/windowBus";

/**
 * B20, fourth review: a database view in a second window writes through the
 * main window's chain over the bus — read the file's state, write the texts
 * made of it only if the file still is that. Another writer that starts
 * between the two halves makes the write come back unwritten; the reading
 * after that may be a file it has written only in part. That reading must
 * never be merged: the change starts over and waits until the file holds
 * still, as in the main window.
 */
const START = ["formulas:", "  f1: a + 1", "views:", "  - type: table", "    name: Offen", "    order:", "      - note.a", "  - type: cards", "    name: Karten", "    limit: 5", ""].join("\n");
/** What a sync made of the file before the screen's change: another valid version. */
const SYNCED = START.replace("limit: 5", "limit: 7").replace("  f1: a + 1\n", "  f1: a + 1\n  f2: b * 2\n");
/** What the other writer writes next — for a while only the part before the last view is there. */
const WHOLE = SYNCED.replace("limit: 7", "limit: 9");
const CUT = WHOLE.slice(0, WHOLE.indexOf("  - type: cards"));

/** The main window's chain behind the bus, over a file another writer starts on when the first write arrives. */
function mainWindow() {
  let written: string | null = null;
  let since: number | null = null;
  const now = () => written ?? (since === null ? SYNCED : Date.now() - since < 100 ? CUT : WHOLE);
  let writes = 0;
  const bus = {
    request: async (type: string, payload: any) => {
      if (type === "update-read") return { text: now(), workingCopy: null } satisfies TextFileState;
      if (type === "update-write") {
        // The other writer starts as the first write arrives.
        if (since === null) since = Date.now();
        const { expected, next } = payload as { expected: TextFileState; next: TextFileChange };
        if (now() !== expected.text) return null;
        const text = next.text ?? expected.text;
        written = text;
        writes += 1;
        return { before: expected.text, text, changed: text !== expected.text, conflict: null };
      }
      throw new Error(`unexpected request ${type}`);
    },
  } as unknown as WindowBus;
  const reads = { readTextFile: async () => now() } as unknown as IVaultAdapter;
  return { remote: new RemoteVaultAdapter(reads, bus, "/vault"), file: now, writes: () => writes };
}

describe("a database change from a second window (B20)", () => {
  it("never merges a reading the other writer has cut: the change waits until the file holds still and lands on it whole", async () => {
    const w = mainWindow();
    const shown = loadBaseConfigText(START);
    const next = { ...shown, views: [...shown.views, { type: "list", name: "Neu" }] };
    await writeBaseConfigChange(w.remote, "Tasks.base", shown, next);
    const out = loadBaseConfigText(w.file());
    expect(out.views.map((v: any) => v.name)).toEqual(["Offen", "Karten", "Neu"]);
    expect(w.file()).toContain("limit: 9");
    expect(w.file()).toContain("f2: b * 2");
    expect(w.writes()).toBe(1);
  });
});
