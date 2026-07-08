import { describe, it, expect } from "vitest";
import { indexDbFileName, hashVaultPath } from "./indexDbPath";

describe("indexDbPath (WP5 5b)", () => {
  it("is deterministic for the same vault path", async () => {
    expect(await indexDbFileName("C:/Users/x/Vaults/wiki")).toBe(await indexDbFileName("C:/Users/x/Vaults/wiki"));
  });

  it("normalizes slashes, case and a trailing slash to the same file", async () => {
    const a = await indexDbFileName("C:\\Users\\x\\Vaults\\wiki");
    const b = await indexDbFileName("c:/users/x/vaults/wiki/");
    expect(a).toBe(b);
  });

  it("distinguishes same-named vaults in different folders", async () => {
    const a = await indexDbFileName("C:/A/wiki");
    const b = await indexDbFileName("C:/B/wiki");
    expect(a).not.toBe(b);
    expect(a.startsWith("wiki-")).toBe(true);
    expect(b.startsWith("wiki-")).toBe(true);
  });

  it("sanitizes the basename and ends with .db", async () => {
    expect(await indexDbFileName("/home/u/My Vault (2024)!")).toMatch(/^My_Vault__2024__-[0-9a-f]{16}\.db$/);
  });

  it("hashVaultPath is 16 lowercase hex chars", async () => {
    expect(await hashVaultPath("/x/y")).toMatch(/^[0-9a-f]{16}$/);
  });

  it("falls back to 'vault' for a root path", async () => {
    expect((await indexDbFileName("/")).startsWith("vault-")).toBe(true);
  });
});
