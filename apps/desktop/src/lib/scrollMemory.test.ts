import { describe, it, expect } from "vitest";
import {
  SCROLL_MEMORY_MAX,
  forgetScrollMemory,
  moveScrollMemory,
  recallLastOpen,
  recallScrollTop,
  rememberLastOpen,
  rememberScrollTop,
} from "@plainva/ui";

function storage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    size: () => m.size,
  };
}

describe("scroll memory (feedback round 2026-09-01, A5 + T6)", () => {
  it("remembers a position per file and vault, and forgets the top", () => {
    const s = storage();
    rememberScrollTop("v1", "a.md", 412.6, s);
    expect(recallScrollTop("v1", "a.md", s)).toBe(413);
    expect(recallScrollTop("v2", "a.md", s)).toBeNull();
    rememberScrollTop("v1", "a.md", 0, s);
    expect(recallScrollTop("v1", "a.md", s)).toBeNull();
  });

  it("follows a rename and caps the memory at the least recently touched files", () => {
    const s = storage();
    for (let i = 0; i < SCROLL_MEMORY_MAX + 5; i++) rememberScrollTop("v1", `n${i}.md`, 10 + i, s);
    expect(recallScrollTop("v1", "n0.md", s)).toBeNull();
    expect(recallScrollTop("v1", `n${SCROLL_MEMORY_MAX + 4}.md`, s)).toBe(SCROLL_MEMORY_MAX + 14);
    moveScrollMemory("v1", `n${SCROLL_MEMORY_MAX + 4}.md`, "renamed.md", s);
    expect(recallScrollTop("v1", "renamed.md", s)).toBe(SCROLL_MEMORY_MAX + 14);
  });

  it("keeps the last opened note per vault and drops everything with the vault", () => {
    const s = storage();
    rememberLastOpen("v1", "Projekte/Plan.md", s);
    rememberScrollTop("v1", "Projekte/Plan.md", 99, s);
    expect(recallLastOpen("v1", s)).toBe("Projekte/Plan.md");
    forgetScrollMemory("v1", s);
    expect(recallLastOpen("v1", s)).toBeNull();
    expect(recallScrollTop("v1", "Projekte/Plan.md", s)).toBeNull();
    expect(s.size()).toBe(0);
  });

  it("survives garbage in storage", () => {
    const s = storage();
    s.setItem("plainva-scroll-v1", "{{{");
    expect(recallScrollTop("v1", "a.md", s)).toBeNull();
    rememberScrollTop("v1", "a.md", 5, s);
    expect(recallScrollTop("v1", "a.md", s)).toBe(5);
  });
});
