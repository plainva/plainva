import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { overBudgetInlineRanges } from "@plainva/core";

/**
 * The phone reads what of a note is read as text as the desktop does (L14):
 * its editor is the one shared session (`createEditorSession`, which holds the
 * stretches and draws nothing there), and the notice over the note is the one
 * the desktop shows (`ReadAsTextNotice`). The desktop's
 * `readAsTextDecision.test.ts` holds that the editor and the reading view
 * decide alike.
 */
describe("a note read partly as text, on the phone (L14)", () => {
  const host = readFileSync(new URL("./EditorHost.tsx", import.meta.url), "utf8");

  it("shows the notice over the note, from the shared building block, with a way to its first place", () => {
    expect(host).toMatch(/import \{[^}]*\bReadAsTextNotice\b[^}]*\} from "@plainva\/ui"/);
    expect(host).toMatch(/<ReadAsTextNotice content=\{noticeText\} onJump=/);
    expect(host).toMatch(/createEditorSession\(/);
  });

  it("decides on the same scan as the desktop", () => {
    const list = Array.from({ length: 20_000 }, (_, i) => `- [ ] item ${i} [[Note ${i}]]`).join("\n");
    const ranges = overBudgetInlineRanges(`# T\n\n${list}\n`);
    expect(ranges.some((range) => range.block)).toBe(true);
  });
});
