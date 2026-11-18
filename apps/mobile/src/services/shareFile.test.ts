import { beforeEach, describe, expect, it, vi } from "vitest";

/** A file handed to the share sheet is staged in parts (release list F54, the class of F51). */
const calls = vi.hoisted(() => ({ written: [] as number[], shared: [] as string[] }));
vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: () => "android", isNativePlatform: () => true }, registerPlugin: () => ({}) }));
vi.mock("@capacitor/share", () => ({ Share: { share: async (opts: { url: string }) => { calls.shared.push(opts.url); } } }));
vi.mock("@capacitor/filesystem", () => ({
  Directory: { Cache: "CACHE" }, Encoding: { UTF8: "utf8" },
  Filesystem: {
    mkdir: async () => {},
    writeFile: async (opts: { data: string }) => { calls.written.push(atob(opts.data).length); },
    appendFile: async (opts: { data: string }) => { calls.written.push(atob(opts.data).length); },
    getUri: async (opts: { path: string }) => ({ uri: `file:///cache/${opts.path}` }),
  },
}));

import { shareVaultFile } from "./shareFile";

beforeEach(() => { calls.written = []; calls.shared = []; });

describe("shareVaultFile", () => {
  it("stages a 3 MB picture in parts of at most one bridge part", async () => {
    const picture = new Uint8Array(3 * 1024 * 1024 + 11).fill(7);
    const vault = { files: { readBinaryFile: async () => picture } } as unknown as Parameters<typeof shareVaultFile>[0];
    await shareVaultFile(vault, "Attachments/photo.jpg");
    expect(Math.max(...calls.written)).toBeLessThanOrEqual(256 * 1024);
    expect(calls.written.reduce((a, b) => a + b, 0)).toBe(picture.length);
    expect(calls.shared).toEqual(["file:///cache/share/photo.jpg"]);
  });
});
