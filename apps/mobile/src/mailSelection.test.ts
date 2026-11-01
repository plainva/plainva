import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Selection in "All inboxes" (plan P1, open-items plan 3.110 no. 1).
 *
 * It was kept out (S45): the selection was built from the open folder's rows
 * by a selection id of its own, and a row of the merged list — whose id is an
 * address — could not be found in it. The bar appeared with every action
 * enabled and every action did nothing; and a hold opened no sheet, so read
 * and the star on such a row were reached only through the opened message.
 *
 * Now every row of every list is named by its address, the selection holds
 * the rows of the list on screen by that id — the merged list's included —
 * and every action reads the folder and the mailbox off the row. What a
 * selection across mailboxes cannot do (move, spam, delete: each needs a
 * folder of ONE mailbox) the bar does not offer there, as on the desktop.
 */
const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "screens", "MailListScreen.tsx"),
  "utf8",
);

describe("mail selection in the unified inbox", () => {
  it("holds the merged list's rows by their address", () => {
    expect(src).toContain("if (unified) for (const m of unifiedRows) out.set(m.id, m);");
    // No selection id of its own any more: that was where the open account was
    // put in front of an address.
    expect(src).not.toMatch(/\bselId\b/);
  });

  it("can be started from the sheet and from the context menu there too", () => {
    expect(src).toContain("useLongPress<string>((id) => setRowSheet(id))");
    const sheet = src.slice(src.indexOf("{rowSheet && (() => {"));
    expect(sheet).not.toMatch(/\.\.\.\(unified\s*\?\s*\[\]\s*:/);
    expect(src).not.toContain("if (!unified) setSelection(new Set([m.id]));");
  });

  it("offers in the merged list only what works across mailboxes", () => {
    const bar = src.slice(src.indexOf('className="m-selectbar m-selectbar--mail"'));
    const gated = bar.slice(bar.indexOf("{!unified && ("));
    expect(gated.indexOf("bulkMove")).toBeGreaterThan(-1);
    expect(gated.indexOf("bulkDelete")).toBeGreaterThan(-1);
    // Read and unread stand before the gate.
    expect(bar.indexOf("onClick={bulkSeen}")).toBeLessThan(bar.indexOf("{!unified && ("));
  });

  it("acts per account and folder read off each row, never off the screen", () => {
    expect(src).toMatch(/groupByOrigin\(ids, accountById\)/);
    expect(src).not.toMatch(/bulkTargets\(/);
  });
});
