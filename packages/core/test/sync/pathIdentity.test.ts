import { describe, it, expect } from "vitest";
import { foldPathForCollision, findCollidingPath } from "../../src/sync/pathIdentity.js";

describe("foldPathForCollision", () => {
  it("folds letter case", () => {
    expect(foldPathForCollision("Efforts/Pinboard/Mobile App.md")).toBe(
      foldPathForCollision("Efforts/Pinboard/mobile App.md")
    );
  });

  it("folds Unicode normalization (precomposed ü vs. u + combining diaeresis)", () => {
    const nfc = "Efforts/Verschlüsselung.md".normalize("NFC");
    const nfd = nfc.normalize("NFD");
    expect(nfc).not.toBe(nfd);
    expect(foldPathForCollision(nfc)).toBe(foldPathForCollision(nfd));
  });

  it("keeps genuinely different names apart", () => {
    expect(foldPathForCollision("a/Note.md")).not.toBe(foldPathForCollision("a/Notes.md"));
    expect(foldPathForCollision("a/Note.md")).not.toBe(foldPathForCollision("b/Note.md"));
  });
});

describe("findCollidingPath", () => {
  const candidates = ["Efforts/Pinboard/Mobile App.md", "Efforts/Pinboard/Sync.md"];

  it("finds the twin that only differs in case", () => {
    expect(findCollidingPath("Efforts/Pinboard/mobile App.md", candidates)).toBe(
      "Efforts/Pinboard/Mobile App.md"
    );
  });

  it("does not report the path itself as its own twin", () => {
    expect(findCollidingPath("Efforts/Pinboard/Sync.md", candidates)).toBeNull();
  });

  it("returns null when nothing collides", () => {
    expect(findCollidingPath("Efforts/Pinboard/Other.md", candidates)).toBeNull();
  });
});
