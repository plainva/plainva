import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("@capacitor/core", () => ({ registerPlugin: () => ({}) }));
import { readPackageText } from "./localModels";

/** A tokenizer of 11 to 33 MB never comes back in one answer (release list F54, the class of F51). */
describe("readPackageText", () => {
  const PART = 256 * 1024;
  const file = (bytes: Uint8Array) => {
    const sizes: number[] = [];
    const readPart = async ({ offset, length }: { offset: number; length: number }) => {
      const part = bytes.subarray(offset, offset + Math.min(length, PART));
      sizes.push(part.length);
      let bin = "";
      for (let i = 0; i < part.length; i += 0x8000) bin += String.fromCharCode(...part.subarray(i, i + 0x8000));
      return { data: btoa(bin), size: bytes.length };
    };
    return { readPart, sizes };
  };

  it("reads a large tokenizer part by part and decodes characters cut at a part's edge", async () => {
    // "日" is three bytes: 262 144 is no multiple of three, so parts cut characters.
    const text = `{"vocab":"${"日本語".repeat(400_000)}"}`;
    const { readPart, sizes } = file(new TextEncoder().encode(text));
    expect(await readPackageText(readPart)).toBe(text);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(PART);
    expect(sizes.length).toBeGreaterThan(10);
  });

  it("reads an empty file and refuses one that changes size", async () => {
    expect(await readPackageText(file(new Uint8Array(0)).readPart)).toBe("");
    let size = PART * 3;
    const growing = async ({ offset }: { offset: number; length: number }) => ({ data: btoa("x".repeat(Math.min(PART, size - offset))), size: (size += 1) - 1 });
    await expect(readPackageText(growing)).rejects.toThrow("changed");
  });

  it("asks the plugin for parts, on both platforms", () => {
    const java = readFileSync(new URL("../../../android/app/src/main/java/com/plainva/app/LocalModelPlugin.java", import.meta.url), "utf8");
    const swift = readFileSync(new URL("../../../ios/App/App/LocalModelPlugin.swift", import.meta.url), "utf8");
    for (const source of [java, swift]) {
      expect(source).toMatch(/readPart/);
      expect(source).not.toMatch(/readText/);
    }
  });
});
