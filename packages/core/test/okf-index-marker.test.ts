import { describe, it, expect } from "vitest";
import {
  generateIndexContent,
  isPlainvaManagedIndex,
  PLAINVA_INDEX_MARKER,
  stripPlainvaIndexMarker,
} from "../src/okf-index.js";

describe("managed index marker (plan UI-UX P11)", () => {
  it("appends the marker as an HTML comment (never frontmatter) when requested", () => {
    const content = generateIndexContent({
      folder: "Projekte",
      heading: "Projekte",
      files: [{ path: "Projekte/Alpha.md" }],
      subfolders: [],
      managedMarker: true,
    });
    expect(content.trimEnd().endsWith(PLAINVA_INDEX_MARKER)).toBe(true);
    expect(content.startsWith("---")).toBe(false);
    expect(isPlainvaManagedIndex(content)).toBe(true);
  });

  it("keeps the root frontmatter (okf_version) alongside the marker", () => {
    const content = generateIndexContent({
      folder: "",
      heading: "Vault",
      files: [],
      subfolders: [{ name: "Projekte" }],
      bundleRoot: true,
      managedMarker: true,
    });
    expect(content.startsWith('---\nokf_version: "0.1"\n---')).toBe(true);
    expect(isPlainvaManagedIndex(content)).toBe(true);
  });

  it("does not mark content without the option and tolerates CRLF when detecting", () => {
    const plain = generateIndexContent({ folder: "", heading: "V", files: [], subfolders: [] });
    expect(isPlainvaManagedIndex(plain)).toBe(false);
    const crlf = `# X\r\n\r\n${PLAINVA_INDEX_MARKER}\r\n`;
    expect(isPlainvaManagedIndex(crlf)).toBe(true);
  });

  it("stripPlainvaIndexMarker removes exactly the marker line", () => {
    const content = `# X\n\n* [A](A.md)\n\n${PLAINVA_INDEX_MARKER}\n`;
    const stripped = stripPlainvaIndexMarker(content);
    expect(isPlainvaManagedIndex(stripped)).toBe(false);
    expect(stripped).toContain("* [A](A.md)");
    expect(stripped).not.toContain("plainva:index");
  });
});
