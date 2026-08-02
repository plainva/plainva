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
  searching: false,
  error: null as string | null,
};

describe("mail list view", () => {
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
    // Search returns its full result set.
    expect(mailListView({ ...base, searching: true, rows: ["a"], total: 5 }).showsLoadMore).toBe(false);
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
