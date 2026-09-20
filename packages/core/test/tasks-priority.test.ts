import { describe, expect, it } from "vitest";
import { readTasksPriority, setTasksPriority, stripTasksPriority } from "../src/vault/taskMetadata.js";
import { scanTasks } from "../src/vault/taskScan.js";

/**
 * Priority marks of the Tasks plugin (plan Aufgaben-Oberfläche, B3): read in
 * three ranks, written as one mark per rank, and only when somebody changes the
 * priority in Plainva — a vault written elsewhere is never reformatted.
 */
describe("task priority marks", () => {
  it("reads five marks as three ranks", () => {
    expect(readTasksPriority("Steuer 🔺 📅 2026-09-21")).toBe(1);
    expect(readTasksPriority("Steuer ⏫")).toBe(1);
    expect(readTasksPriority("Steuer 🔼 #kunde")).toBe(2);
    expect(readTasksPriority("Steuer 🔽")).toBe(3);
    expect(readTasksPriority("⏬ Steuer")).toBe(3);
    expect(readTasksPriority("Steuer")).toBe(0);
  });

  it("ignores a mark inside code or glued to a word", () => {
    expect(readTasksPriority("Taste `⏫` drücken")).toBe(0);
    expect(readTasksPriority("Pfeil⏫hoch")).toBe(0);
  });

  it("the scanner hands the rank on, and leaves tasks without one untouched", () => {
    const [high, none] = scanTasks("- [ ] Angebot ⏫ 📅 2026-09-21\n- [ ] Bericht");
    expect(high.priority).toBe(1);
    expect(high.due).toBe("2026-09-21");
    expect("priority" in none).toBe(false);
  });

  it("strips the marks for a view that draws a flag instead", () => {
    expect(stripTasksPriority("Angebot ⏫ 📅 2026-09-21")).toBe("Angebot 📅 2026-09-21");
    expect(stripTasksPriority("🔼 Angebot")).toBe("Angebot");
  });

  it("sets one mark, in front of the first dated field, and replaces what was there", () => {
    expect(setTasksPriority("Angebot 📅 2026-09-21", 1)).toBe("Angebot ⏫ 📅 2026-09-21");
    expect(setTasksPriority("Angebot 🔽 📅 2026-09-21 🔁 every week", 2)).toBe("Angebot 🔼 📅 2026-09-21 🔁 every week");
    expect(setTasksPriority("Angebot #kunde", 3)).toBe("Angebot #kunde 🔽");
    expect(setTasksPriority("Angebot ^block-1", 1)).toBe("Angebot ⏫ ^block-1");
    expect(setTasksPriority("Angebot 🔺 📅 2026-09-21", 0)).toBe("Angebot 📅 2026-09-21");
  });

  it("round-trips: what was set is what is read", () => {
    for (const rank of [1, 2, 3] as const) expect(readTasksPriority(setTasksPriority("Angebot 📅 2026-09-21", rank))).toBe(rank);
  });
});
