import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * "All inboxes" offers no bulk selection (S45).
 *
 * A selection there carries unified ids (account + mailbox + uid), which the
 * screen's `selectable` map — built from the open folder's rows — cannot
 * resolve. The bar therefore appeared with Mark read / Move / Delete all
 * enabled, and every one of them returned at `chosen.length === 0` without a
 * word. Move was the worst: it opened the destination picker, took the user's
 * answer, and dropped it.
 *
 * The context menu already carried the rule. The long press did not, and a long
 * press is how the selection is normally started.
 */
const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "screens", "MailListScreen.tsx"),
  "utf8",
);

describe("mail selection in the unified inbox", () => {
  it("cannot be started by a long press", () => {
    const press = src.slice(src.indexOf("const press = useLongPress"), src.indexOf("const press = useLongPress") + 400);
    expect(press).toContain("if (!unified)");
  });

  it("cannot be started by the context menu either", () => {
    expect(src).toContain("if (!unified) setSelection(new Set([m.id]));");
  });

  it("has no third way in", () => {
    // Every entry point must carry the guard; a new one that forgets it brings
    // the dead action bar straight back.
    const opens = [...src.matchAll(/setSelection\(new Set\(/g)];
    expect(opens).toHaveLength(2);
  });
});
