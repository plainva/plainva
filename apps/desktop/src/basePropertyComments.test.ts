import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The two ways from a database into a remark (finding 2026-09-04).
 *
 * The dot on a cell counted and did nothing, and there was no way at all to
 * start a remark on a property from the table - you had to open the entry and
 * find the property in its panel. Both ways now end in the shared jump the
 * overview and the notifications already use, which is the point: no third
 * mechanism, and the editor stays the only surface that composes a comment.
 *
 * SOURCE assertions, like the phone's wiring test above them: every piece is
 * covered by its own test (the jump, the thread lookup, the composer) and each
 * of them stayed green while the table offered nothing - the fault would live
 * in the four lines that connect them.
 */
const SRC = fileURLToPath(new URL(".", import.meta.url));
const read = (...p: string[]) => readFileSync(join(SRC, ...p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("a database opens and starts property comments", () => {
  const viewer = strip(read("components", "BaseViewer.tsx"));
  const cells = strip(read("components", "base", "useBaseCells.tsx"));
  const editor = strip(read("components", "Editor.tsx"));

  it("makes the cell's dot a button that hands its column to the host", () => {
    expect(cells).toMatch(/onOpenPropertyComments\?: \(path: string, col: string\) => void;/);
    expect(cells).toMatch(/onClick=\{\(e\) => \{ e\.stopPropagation\(\); onOpenPropertyComments\(path, col\); \}\}/);
    // Without a handler it stays the span it was - an embedded base has
    // nowhere to open an entry.
    expect(cells).toMatch(/onOpenPropertyComments \? \(/);
  });

  it("tells the row menu which column was right-clicked", () => {
    expect(cells).toMatch(/onRowContextMenu\?: \(path: string, ev: React\.MouseEvent, col\?: string\) => void;/);
    expect(cells).toMatch(/onContextMenu=\{\(e\) => \{ e\.stopPropagation\(\); onRowContextMenu\?\.\(path, e, col\); \}\}/);
  });

  it("offers the remark only where this device may write one", () => {
    expect(viewer).toMatch(/getWorkspaceCapabilities\(path\)/);
    expect(viewer).toMatch(/caps\?\.includes\("comment\.create"\)/);
    expect(viewer).toMatch(/rowMenu\.col && rowMenu\.canComment &&/);
    expect(viewer).toContain('data-testid="base-comment-property"');
    expect(viewer).toContain('t("workspaceSecurity.commentOnProperty")');
  });

  it("routes both ways through the shared jump, and opens the entry", () => {
    expect(viewer).toMatch(/const commentId = findPropertyCommentThread\(noteComments\.get\(path\) \?\? \[\], col,/);
    expect(viewer).toMatch(/requestCommentJump\(commentId \? \{ path, commentId \} : \{ path, property: col \}\)/);
    expect(viewer).toMatch(/requestCommentJump\(\{ path, property: col \}\)/);
    expect(viewer.match(/requestOpen\(path\);/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("lets the editor answer a jump that names a property instead of a card", () => {
    expect(editor).toMatch(/if \(jump\.commentId\) \{ setActiveCommentId\(jump\.commentId\); return; \}/);
    expect(editor).toMatch(/if \(jump\.property\) setPendingPropertyJump\(jump\.property\)/);
    // The composer quotes the value, so it waits for the note's text.
    expect(editor).toMatch(/if \(!pendingPropertyJump \|\| content\.length === 0\) return;/);
    expect(editor).toMatch(/requestPropertyComment\(pendingPropertyJump\)/);
  });
});
