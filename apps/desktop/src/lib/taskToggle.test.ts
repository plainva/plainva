import { describe, it, expect } from "vitest";
import { toggleTaskAtIndex } from "@plainva/ui";

describe("toggleTaskAtIndex (read-mode checkbox toggle, P3.1)", () => {
  it("checks and unchecks by document order", () => {
    const src = "- [ ] eins\n- [x] zwei\n- [ ] drei";
    expect(toggleTaskAtIndex(src, 0, true).content).toBe("- [x] eins\n- [x] zwei\n- [ ] drei");
    expect(toggleTaskAtIndex(src, 1, false).content).toBe("- [ ] eins\n- [ ] zwei\n- [ ] drei");
    expect(toggleTaskAtIndex(src, 2, true).changed).toBe(true);
  });

  it("supports numbered lists, nesting, blockquotes and uppercase X", () => {
    const src = [
      "1. [ ] nummeriert",
      "  - [X] verschachtelt gross",
      "> - [ ] im zitat",
      "> > * [x] tief im zitat",
    ].join("\n");
    expect(toggleTaskAtIndex(src, 0, true).content).toContain("1. [x] nummeriert");
    expect(toggleTaskAtIndex(src, 1, false).content).toContain("  - [ ] verschachtelt gross");
    expect(toggleTaskAtIndex(src, 2, true).content).toContain("> - [x] im zitat");
    expect(toggleTaskAtIndex(src, 3, false).content).toContain("> > * [ ] tief im zitat");
  });

  it("skips task-looking lines inside fenced code blocks (the reader does too)", () => {
    const src = [
      "- [ ] echt",
      "```",
      "- [ ] nur code",
      "```",
      "- [ ] auch echt",
    ].join("\n");
    // Index 1 must hit "auch echt", not the code line.
    const r = toggleTaskAtIndex(src, 1, true);
    expect(r.content).toContain("- [x] auch echt");
    expect(r.content).toContain("- [ ] nur code");
  });

  it("does not treat plain brackets or paragraphs as tasks", () => {
    const src = "kein task [ ] hier\n- [ ] echter task";
    const r = toggleTaskAtIndex(src, 0, true);
    expect(r.content).toContain("- [x] echter task");
    expect(r.content).toContain("kein task [ ] hier");
  });

  it("returns changed=false for an out-of-range index", () => {
    const r = toggleTaskAtIndex("- [ ] eins", 5, true);
    expect(r.changed).toBe(false);
    expect(r.content).toBe("- [ ] eins");
  });

  it("keeps task text containing brackets intact", () => {
    const src = "- [ ] siehe [[Link]] und [md](x.md)";
    expect(toggleTaskAtIndex(src, 0, true).content).toBe("- [x] siehe [[Link]] und [md](x.md)");
  });
});
