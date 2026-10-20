import { describe, expect, it, vi } from "vitest";

const writeFile = vi.fn(async (_options: unknown) => {});
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false }, registerPlugin: () => ({}) }));
vi.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA" },
  Encoding: { UTF8: "utf8" },
  Filesystem: { writeFile: (options: unknown) => writeFile(options) },
}));

import { atomicWriteBase64 } from "./atomicFile";

/**
 * The web shell — the platform the production-bundle tests run on — keeps
 * what it is handed and hands it back whatever a read asks for. Bytes kept as
 * their base64 string came back from a text read as that string: valid UTF-8,
 * a "text" no file ever held (finding 2026-10-11).
 */
describe("the web shell's byte write", () => {
  it("keeps bytes as bytes: a Blob, not the base64 string a text read would hand back", async () => {
    const bytes = [0x47, 0x72, 0xfc, 0x6e, 0x0d, 0x0a];
    await atomicWriteBase64("vault/Data.csv", btoa(String.fromCharCode(...bytes)));
    const options = writeFile.mock.calls[0][0] as { path: string; directory: string; data: unknown; encoding?: unknown };
    expect(options).toMatchObject({ path: "vault/Data.csv", directory: "DATA" });
    expect(options.encoding).toBeUndefined();
    expect(options.data).toBeInstanceOf(Blob);
    expect([...new Uint8Array(await (options.data as Blob).arrayBuffer())]).toEqual(bytes);
  });
});
