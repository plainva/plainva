import { describe, expect, it } from "vitest";
import { foldPathNormalization } from "../src/sync/pathIdentity.js";

/**
 * C23: two spellings of one folder name.
 *
 * macOS stores `Bücher` DECOMPOSED (u + combining diaeresis); the same word
 * typed on Windows is COMPOSED (ü as one code point). They render identically
 * and are one folder on disk, but a byte comparison calls them different — so
 * unfolding the bubble found no notes, and "+ Entry" offered to create a
 * folder that was already there.
 *
 * Folding NORMALIZATION only, not case, is the deliberate narrow choice:
 * `Bücher` and `bücher` look different, and on a case-sensitive file system
 * they are two folders. Folding case here would land a write in the wrong one.
 */

// Built from escapes rather than typed: the two literals are indistinguishable
// on screen, which is precisely the bug — a reader could not tell a test using
// the wrong one from a passing one.
const COMPOSED = "Bücher";
const DECOMPOSED = "Bücher";

describe("foldPathNormalization (C23)", () => {
  it("makes the two spellings of one folder compare equal", () => {
    expect(COMPOSED).not.toBe(DECOMPOSED); // different bytes...
    expect(foldPathNormalization(COMPOSED)).toBe(foldPathNormalization(DECOMPOSED)); // ...one name
  });

  it("still tells apart names that a reader can tell apart", () => {
    expect(foldPathNormalization("Bücher")).not.toBe(foldPathNormalization("bücher"));
    expect(foldPathNormalization("Notes")).not.toBe(foldPathNormalization("Notes 2"));
  });

  it("folds a prefix the same way, so a subfolder still matches its parent", () => {
    const parent = `${foldPathNormalization(DECOMPOSED)}/`;
    expect(foldPathNormalization(`${COMPOSED}/Sub/deep.md`).startsWith(parent)).toBe(true);
  });
});
