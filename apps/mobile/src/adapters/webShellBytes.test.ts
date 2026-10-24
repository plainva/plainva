import { describe, expect, it, vi } from "vitest";
import { NotTextFileError, readExactText } from "@plainva/core";

const native = vi.hoisted(() => ({ read: vi.fn(), stat: vi.fn(), list: vi.fn() }));
vi.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA" }, Encoding: { UTF8: "utf8" },
  Filesystem: { readFile: native.read, stat: native.stat, readdir: native.list },
}));
vi.mock("../platform/atomicFile", () => ({ atomicWriteText: vi.fn(), atomicWriteBase64: vi.fn() }));

import { CapacitorVaultAdapter } from "./CapacitorVaultAdapter";

/**
 * The web shell — the phone's production bundle in a browser, where its end-to-
 * end tests run — keeps a file laid down as bytes as a Blob, and hands that
 * Blob back for a text read as well. Read the way Android's reader reads it —
 * every byte that is not UTF-8 replaced —, a file in another encoding is in
 * the browser what it is on a phone, and the vault's read refuses it there
 * too (finding 2026-10-11).
 */
describe("the web shell's storage and a file laid down as bytes", () => {
  it("reads it as Android does, keeps its bytes, and the vault's read refuses it", async () => {
    const bytes = new Uint8Array([0x47, 0x72, 0xfc, 0x6e]); // "Grün" in Windows-1252
    native.read.mockResolvedValue({ data: new Blob([bytes]) });
    native.stat.mockResolvedValue({ type: "file", size: bytes.length, mtime: 1 });
    const adapter = new CapacitorVaultAdapter("vault");
    expect(await adapter.readTextFile("Data.csv")).toBe(`Gr${String.fromCharCode(0xfffd)}n`);
    expect([...await adapter.readBinaryFile("Data.csv")]).toEqual([...bytes]);
    await expect(readExactText(adapter, "Data.csv")).rejects.toBeInstanceOf(NotTextFileError);
  });

  it("leaves a file laid down as text as it was", async () => {
    native.read.mockResolvedValue({ data: "# Note\n" });
    native.stat.mockResolvedValue({ type: "file", size: 7, mtime: 1 });
    expect(await new CapacitorVaultAdapter("vault").readTextFile("Note.md")).toBe("# Note\n");
  });

  // A file the app wrote as text, read as bytes — a skill's approval hashes them, the memory reads its files so: the
  // read threw, and the file was missing to whoever asked (finding 2026-10-24, AI harness). Its bytes are its UTF-8.
  it("hands a file laid down as text out as its UTF-8 bytes, and one laid down as base64 as the bytes it names", async () => {
    native.stat.mockResolvedValue({ type: "file", size: 12, mtime: 1 });
    const adapter = new CapacitorVaultAdapter("vault");
    native.read.mockResolvedValue({ data: "- Grün <!-- plainva: by=user -->\n" });
    expect(new TextDecoder().decode(await adapter.readBinaryFile(".agent/MEMORY.md"))).toBe("- Grün <!-- plainva: by=user -->\n");
    // What a fixture or an earlier build laid down without an encoding: base64, as the plugin demands of such a write.
    native.read.mockResolvedValue({ data: btoa("# Plan\n") });
    expect(new TextDecoder().decode(await adapter.readBinaryFile("Plan.md"))).toBe("# Plan\n");
  });
});
