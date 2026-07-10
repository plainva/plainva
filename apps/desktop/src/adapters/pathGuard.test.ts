import { describe, it, expect } from "vitest";
import { isWithinRoot, resolveVaultRelative } from "@plainva/ui";

describe("isWithinRoot (vault path traversal guard)", () => {
  it("accepts a path equal to the root", () => {
    expect(isWithinRoot("/vault", "/vault", "/")).toBe(true);
  });

  it("accepts a direct child", () => {
    expect(isWithinRoot("/vault", "/vault/note.md", "/")).toBe(true);
  });

  it("accepts a deeply nested child", () => {
    expect(isWithinRoot("/vault", "/vault/sub/dir/note.md", "/")).toBe(true);
  });

  it("rejects a sibling directory that shares the root as a prefix", () => {
    // The classic prefix pitfall: must not be fooled by "/vault-evil".
    expect(isWithinRoot("/vault", "/vault-evil/secret.md", "/")).toBe(false);
  });

  it("rejects a path completely outside the root", () => {
    expect(isWithinRoot("/vault", "/etc/passwd", "/")).toBe(false);
  });

  it("rejects a parent of the root", () => {
    expect(isWithinRoot("/vault/sub", "/vault", "/")).toBe(false);
  });

  it("handles a root that already ends with a separator", () => {
    expect(isWithinRoot("/vault/", "/vault/note.md", "/")).toBe(true);
    expect(isWithinRoot("/vault/", "/vault-evil/x", "/")).toBe(false);
  });

  it("works with Windows backslash separators", () => {
    expect(isWithinRoot("C:\\vault", "C:\\vault", "\\")).toBe(true);
    expect(isWithinRoot("C:\\vault", "C:\\vault\\note.md", "\\")).toBe(true);
    expect(isWithinRoot("C:\\vault", "C:\\vault-evil\\note.md", "\\")).toBe(false);
  });
});

describe("resolveVaultRelative (read-mode embed target guard, P1.13)", () => {
  it("passes normal vault-relative references through", () => {
    expect(resolveVaultRelative("img/photo.png")).toBe("img/photo.png");
    expect(resolveVaultRelative("Ordner/Unter/bild.webp")).toBe("Ordner/Unter/bild.webp");
    expect(resolveVaultRelative("bild.png")).toBe("bild.png");
  });

  it("normalizes redundant segments and backslashes", () => {
    expect(resolveVaultRelative("./img//photo.png")).toBe("img/photo.png");
    expect(resolveVaultRelative("img\\sub\\photo.png")).toBe("img/sub/photo.png");
    expect(resolveVaultRelative("a/b/../photo.png")).toBe("a/photo.png");
  });

  it("rejects everything that escapes the vault or is absolute", () => {
    expect(resolveVaultRelative("../secret.png")).toBeNull();
    expect(resolveVaultRelative("a/../../secret.png")).toBeNull();
    expect(resolveVaultRelative("/etc/passwd")).toBeNull();
    expect(resolveVaultRelative("\\\\server\\share\\x.png")).toBeNull();
    expect(resolveVaultRelative("C:/Users/x/secret.png")).toBeNull();
    expect(resolveVaultRelative("C:\\Users\\x\\secret.png")).toBeNull();
    expect(resolveVaultRelative("file:///etc/passwd")).toBeNull();
    expect(resolveVaultRelative("")).toBeNull();
    expect(resolveVaultRelative("..")).toBeNull();
  });
});
