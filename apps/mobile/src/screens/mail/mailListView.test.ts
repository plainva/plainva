import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mailListView } from "./mailListView";

const base = {
  unified: false,
  unifiedRows: [] as string[],
  rows: [] as string[],
  total: 0,
  loading: false,
  error: null as string | null,
};

describe("mail list view", () => {
  it("keeps paging available when unknown attachment metadata leaves no confirmed matches", () => {
    const rows: Array<{ id: string; hasAttachments?: boolean }> = [{ id: "unknown" }, { id: "no", hasAttachments: false }];
    const view = mailListView({ ...base, rows, unifiedRows: [], total: 8, attachmentsOnly: true, hasAttachment: row => row.hasAttachments === true });
    expect(view.listRows).toEqual([]);
    expect(view.isEmptyByFilter).toBe(true);
    expect(view.showsLoadMore).toBe(true);
  });
  it("shows the merged inboxes when 'all inboxes' is on", () => {
    const view = mailListView({ ...base, unified: true, unifiedRows: ["a", "b"], rows: [] });
    expect(view.listRows).toEqual(["a", "b"]);
  });

  it("does not call the merged view empty while it has mail", () => {
    // The defect: the empty state asked `rows` (the open FOLDER) while the
    // merged list was on screen, so "all inboxes" reported "folder is empty"
    // with mail right there — and archiving from that state is one tap away.
    const view = mailListView({ ...base, unified: true, unifiedRows: ["a"], rows: [] });
    expect(view.isEmpty).toBe(false);
  });

  it("still reports an empty merged view as empty", () => {
    expect(mailListView({ ...base, unified: true }).isEmpty).toBe(true);
  });

  it("says nothing about emptiness while loading or after an error", () => {
    expect(mailListView({ ...base, loading: true }).isEmpty).toBe(false);
    expect(mailListView({ ...base, error: "no connection" }).isEmpty).toBe(false);
  });

  it("offers 'load more' only for the paged folder list", () => {
    expect(mailListView({ ...base, rows: ["a"], total: 5 }).showsLoadMore).toBe(true);
    // Merged view: fetched whole, and paging would extend the folder list that
    // is not even on screen — a button that could only ever do nothing.
    expect(mailListView({ ...base, unified: true, rows: ["a"], total: 5 }).showsLoadMore).toBe(false);
    // Search returns its full result set, and so does the flagged query.
    expect(mailListView({ ...base, searchRows: ["x"], rows: ["a"], total: 5 }).showsLoadMore).toBe(false);
    expect(mailListView({ ...base, flaggedRows: ["x"], rows: ["a"], total: 5 }).showsLoadMore).toBe(false);
    expect(mailListView({ ...base, rows: ["a", "b"], total: 2 }).showsLoadMore).toBe(false);
  });

  it("is the only place the screen decides these three things", () => {
    // The bug was not the rule but the SECOND rule: the screen rendered one
    // list and questioned another. Keeping the decisions in one place is what
    // makes them impossible to disagree again — so the screen must ask.
    const screen = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "MailListScreen.tsx"),
      "utf8",
    );
    expect(screen).toContain("mailListView({");
    expect(screen).toContain("view.isEmpty");
    expect(screen).toContain("view.showsLoadMore");
    expect(screen).not.toMatch(/rows\.length === 0 && !loading/);
    expect(screen).not.toMatch(/!searching && rows\.length < total/);
  });
});

/**
 * The unread filter (S29). It narrows what is loaded; the pager has to stay
 * reachable, and an empty result must be distinguishable from an empty folder.
 */
describe("unread filter", () => {
  const rows = [
    { id: "1", seen: false },
    { id: "2", seen: true },
    { id: "3", seen: false },
  ];
  const base = { unified: false, unifiedRows: [], total: 9, loading: false, error: null };
  const isUnread = (m: { seen: boolean }) => !m.seen;

  it("keeps only the unread rows when it is on", () => {
    const v = mailListView({ ...base, rows, unreadOnly: true, isUnread });
    expect(v.listRows.map((m) => m.id)).toEqual(["1", "3"]);
    // Narrowing the page must not hide the way to load the rest of the folder.
    expect(v.showsLoadMore).toBe(true);
  });

  it("leaves the list alone when it is off", () => {
    expect(mailListView({ ...base, rows, unreadOnly: false, isUnread }).listRows).toHaveLength(3);
  });

  it("says the filter emptied the list, not the folder", () => {
    const allRead = [{ id: "1", seen: true }];
    const v = mailListView({ ...base, rows: allRead, unreadOnly: true, isUnread });
    expect(v.isEmpty).toBe(true);
    expect(v.isEmptyByFilter).toBe(true);
  });

  it("does not blame the filter for a genuinely empty folder", () => {
    const v = mailListView({ ...base, rows: [], total: 0, unreadOnly: true, isUnread });
    expect(v.isEmpty).toBe(true);
    expect(v.isEmptyByFilter).toBe(false);
  });
});

/**
 * The search (TestFlight 02.10.2026: "the search field in the mails does not
 * seem to work"). Its hits were written INTO the folder's list, so every
 * background reload of the folder replaced them — and three other states never
 * showed them at all. Which list is on screen is decided here.
 */
describe("search hits", () => {
  const folder = ["inbox-1", "inbox-2", "inbox-3"];

  it("stand where the folder would", () => {
    const view = mailListView({ ...base, rows: folder, total: 40, searchRows: ["hit-9"] });
    expect(view.listRows).toEqual(["hit-9"]);
    expect(view.replaced).toBe(true);
  });

  it("survive a reload of the folder underneath them", () => {
    // The defect: sync finished, the screen reloaded the folder - and with one
    // shared list the hits were gone while the search field still showed the
    // question. The folder's list may change as it likes now.
    const before = mailListView({ ...base, rows: folder, total: 40, searchRows: ["hit-9"] });
    const after = mailListView({ ...base, rows: ["inbox-0", ...folder], total: 41, searchRows: ["hit-9"] });
    expect(after.listRows).toEqual(before.listRows);
  });

  it("win over the flagged filter instead of hiding behind it", () => {
    const view = mailListView({ ...base, rows: folder, total: 40, flaggedRows: ["star-1"], searchRows: ["hit-9"] });
    expect(view.listRows).toEqual(["hit-9"]);
    // Without a search the flagged messages are the answer on screen.
    expect(mailListView({ ...base, rows: folder, total: 40, flaggedRows: ["star-1"], searchRows: null }).listRows).toEqual(["star-1"]);
  });

  it("a search without a hit is not an empty folder", () => {
    const view = mailListView({ ...base, rows: folder, total: 40, searchRows: [] });
    expect(view.listRows).toEqual([]);
    expect(view.isEmpty).toBe(true);
    expect(view.isEmptyBySearch).toBe(true);
    expect(view.isEmptyByFilter).toBe(false);
    // ...and an empty folder is not a search without a hit.
    expect(mailListView({ ...base, rows: [], total: 0 }).isEmptyBySearch).toBe(false);
  });

  it("hits the unread filter hides are hidden by the FILTER", () => {
    const view = mailListView({
      ...base,
      unifiedRows: [] as Array<{ id: string; seen: boolean }>,
      rows: [] as Array<{ id: string; seen: boolean }>,
      searchRows: [{ id: "hit", seen: true }],
      unreadOnly: true,
      isUnread: (m) => !m.seen,
    });
    expect(view.isEmptyByFilter).toBe(true);
    expect(view.isEmptyBySearch).toBe(false);
  });

  it("never stand in the merged view, which has no folder to ask", () => {
    const view = mailListView({ ...base, unified: true, unifiedRows: ["all-1"], rows: folder, searchRows: ["hit-9"], flaggedRows: ["star-1"] });
    expect(view.listRows).toEqual(["all-1"]);
    expect(view.replaced).toBe(false);
  });

  it("names the rows a selection or a count may refer to", () => {
    expect(mailListView({ ...base, rows: folder, searchRows: ["hit-9"] }).sourceRows).toEqual(["hit-9"]);
    expect(mailListView({ ...base, rows: folder }).sourceRows).toEqual(folder);
  });

  it("the screen keeps the hits in a list of their own", () => {
    const screen = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "MailListScreen.tsx"),
      "utf8",
    );
    // Not into the folder's list ...
    expect(screen).not.toMatch(/setRows\(hits\)/);
    expect(screen).toMatch(/setSearchRows\(hits\)/);
    // ... and the view is handed both, instead of a list chosen at the call site.
    expect(screen).toMatch(/rows,\s+searchRows,\s+flaggedRows,/);
    expect(screen).not.toMatch(/rows: flaggedRows \?\? rows/);
    // The merged view offers no search, like it offers no flagged filter.
    expect(screen).toMatch(/searchOpen && !unified && \(/);
  });
});
