import { describe, expect, it } from "vitest";
import { NotTextFileError, VaultFileNotFoundError, isNotTextFileError, type IVaultAdapter } from "@plainva/core";
import { RemoteVaultAdapter } from "./RemoteVaultAdapter";
import type { WindowBus } from "../services/windowBus";

/**
 * An auxiliary window reads the vault itself (multi-window P0) — not through
 * the main window's chain. So the chain's answer for a file whose bytes are
 * not UTF-8 has to be this adapter's too (finding 2026-10-11): an editor in a
 * second window called a `.csv` in Windows-1252 missing, because the reader
 * below refuses such bytes with an error of its own, while the main window
 * shows it as "not text".
 */
const utf8 = (text: string) => new TextEncoder().encode(text);
const TABLE = new Uint8Array([0x69, 0x64, 0x0d, 0x0a, 0x47, 0x72, 0xfc, 0x6e, 0x0d, 0x0a]); // "id", "Grün" in Windows-1252

/** The desktop's reader: Rust gives no text for bytes that are not UTF-8. */
function desktopReads(files: Record<string, Uint8Array>): IVaultAdapter {
  const bytes = async (path: string) => {
    const found = files[path];
    if (!found) throw new VaultFileNotFoundError(path);
    return found;
  };
  return {
    readBinaryFile: bytes,
    readTextFile: async (path: string) => {
      const found = await bytes(path);
      try {
        return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(found);
      } catch {
        throw new Error("cannot read text file: stream did not contain valid UTF-8");
      }
    },
  } as unknown as IVaultAdapter;
}

const bus = { request: async () => { throw new Error("this test writes nothing"); } } as unknown as WindowBus;

describe("an auxiliary window's read of a text file", () => {
  it("hands out the text of a file, and refuses one whose bytes are not UTF-8 — as the main window's chain does", async () => {
    const remote = new RemoteVaultAdapter(desktopReads({ "Note.md": utf8("# Note\n"), "Data.csv": TABLE }), bus, "/vault");
    expect(await remote.readTextFile("Note.md")).toBe("# Note\n");
    const refusal = await remote.readTextFile("Data.csv").then(() => null, (error: unknown) => error);
    expect(refusal).toBeInstanceOf(NotTextFileError);
    expect(isNotTextFileError(refusal)).toBe(true);
    // A missing file stays a missing file: the editor looks for it.
    await expect(remote.readTextFile("Gone.md")).rejects.toBeInstanceOf(VaultFileNotFoundError);
  });
});
