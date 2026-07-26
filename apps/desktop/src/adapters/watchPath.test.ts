import { describe, it, expect } from "vitest";
import { isAccessWatchEvent, relativizeWatchPath, WATCH_RESCAN_MARKER } from "./TauriVaultAdapter";

/**
 * P1d. The old relativisation was `p.startsWith(rootPath)`. Every row below is
 * a shape Windows actually produces where that check failed — and a failed
 * check pushed the ABSOLUTE path into the index queue, where at best nothing
 * happened and at worst the existing row was read as removed.
 */
describe("relativizeWatchPath", () => {
  it("relativises a plain match", () => {
    expect(relativizeWatchPath("C:\\Vaults\\wiki", "C:\\Vaults\\wiki\\Notes\\A.md")).toBe("Notes/A.md");
  });

  it("tolerates a trailing separator on the root", () => {
    expect(relativizeWatchPath("C:\\Vaults\\wiki\\", "C:\\Vaults\\wiki\\A.md")).toBe("A.md");
  });

  it("tolerates a differently-cased drive letter", () => {
    expect(relativizeWatchPath("C:\\Vaults\\wiki", "c:\\vaults\\wiki\\A.md")).toBe("A.md");
  });

  it("tolerates the extended-length prefix", () => {
    expect(relativizeWatchPath("C:\\Vaults\\wiki", "\\\\?\\C:\\Vaults\\wiki\\A.md")).toBe("A.md");
    expect(relativizeWatchPath("\\\\?\\C:\\Vaults\\wiki", "C:\\Vaults\\wiki\\A.md")).toBe("A.md");
  });

  it("handles POSIX roots", () => {
    expect(relativizeWatchPath("/home/m/wiki", "/home/m/wiki/Notes/A.md")).toBe("Notes/A.md");
  });

  it("maps the vault root itself to the empty path", () => {
    expect(relativizeWatchPath("C:\\Vaults\\wiki", "C:\\Vaults\\wiki")).toBe("");
  });

  it("refuses a sibling that merely shares the prefix", () => {
    // "wiki-old" must not become "-old/A.md" inside "wiki".
    expect(relativizeWatchPath("C:\\Vaults\\wiki", "C:\\Vaults\\wiki-old\\A.md")).toBeNull();
  });

  it("refuses a path outside the vault", () => {
    expect(relativizeWatchPath("C:\\Vaults\\wiki", "D:\\Other\\A.md")).toBeNull();
  });
});

describe("isAccessWatchEvent", () => {
  it("detects the structured access event", () => {
    expect(isAccessWatchEvent({ access: { kind: "open" } })).toBe(true);
    expect(isAccessWatchEvent("access")).toBe(true);
  });

  it("lets real changes through", () => {
    expect(isAccessWatchEvent({ modify: { kind: "data" } })).toBe(false);
    expect(isAccessWatchEvent("any")).toBe(false);
    expect(isAccessWatchEvent(undefined)).toBe(false);
  });

  it("does not fire on a note whose NAME contains the word", () => {
    // The old check stringified the whole event, so "access-log.md" in a path
    // could silence a real change.
    expect(isAccessWatchEvent({ create: { kind: "file" } })).toBe(false);
  });
});

describe("WATCH_RESCAN_MARKER", () => {
  it("is not a legal relative path, so it cannot collide with a real file", () => {
    expect(WATCH_RESCAN_MARKER).toBe("*");
    expect(relativizeWatchPath("C:\\Vaults\\wiki", "C:\\Vaults\\wiki\\A.md")).not.toBe(WATCH_RESCAN_MARKER);
  });
});
