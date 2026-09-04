import { describe, expect, it } from "vitest";
import { fileRowActions, mailRowActions, newEntries, NEW_ITEM_ORDER, pickRowActions, ROW_ACTION_IDS, taskRowActions } from "@plainva/ui";

/**
 * The one list per row kind (Design-Runde Bedienung 2026-09-04, E2) and the
 * one "New …" catalog (E4). What these tests pin is the CONTRACT both shells
 * rely on: an entry exists only where its handler does, the order is the
 * list's, the words change with state but the ids do not.
 */
const t = (key: string, opts?: Record<string, unknown>) => (opts?.defaultValue as string) ?? key;
const noop = () => {};

describe("mail row actions", () => {
  it("builds only what the surface can do, in the list's order", () => {
    const list = mailRowActions(t, { markRead: noop, delete: noop, move: noop });
    expect(list.map((a) => a.id)).toEqual(["read", "move", "delete"]);
  });

  it("names the state: unflag on a flagged row, deleteForever in the trash, notJunk in the junk folder", () => {
    const flagged = mailRowActions(t, { flagged: true, flag: noop, unflag: noop });
    expect(flagged.map((a) => a.id)).toEqual(["unflag"]);
    const trash = mailRowActions(t, { inTrash: true, delete: noop });
    expect(trash[0].label).toBe("Endgültig löschen");
    const junk = mailRowActions(t, { junkDirection: "restore", junk: noop });
    expect(junk[0].label).toBe("Kein Spam");
  });

  it("marks the swipe and bulk subsets without changing the order", () => {
    const all = mailRowActions(t, {
      open: noop, markRead: noop, markUnread: noop, flag: noop, move: noop, snooze: noop, junk: noop, delete: noop,
    });
    expect(all.map((a) => a.id)).toEqual(["open", "read", "unread", "flag", "move", "snooze", "junk", "delete"]);
    expect(all.filter((a) => a.swipe).map((a) => a.id)).toEqual(["snooze", "junk", "delete"]);
    // Opening is what a tap does — never a bulk action.
    expect(all.find((a) => a.id === "open")?.bulk).toBeFalsy();
    expect(all.filter((a) => a.bulk).map((a) => a.id)).toEqual(["read", "unread", "flag", "move", "snooze", "junk", "delete"]);
  });

  it("keeps the destructive entry last", () => {
    for (const list of [
      mailRowActions(t, { delete: noop, markRead: noop, junk: noop }),
      fileRowActions(t, { delete: noop, rename: noop, move: noop }),
    ]) {
      expect(list[list.length - 1].id).toBe("delete");
      expect(list.filter((a) => a.danger).map((a) => a.id)).toEqual(["delete"]);
    }
  });
});

describe("task row actions", () => {
  it("toggle reads the state, the rest follows the handlers", () => {
    const open = taskRowActions(t, { done: false, toggle: noop, block: noop });
    expect(open.map((a) => [a.id, a.label])).toEqual([["toggle", "Erledigt"], ["block", "Zeit blocken"]]);
    const done = taskRowActions(t, { done: true, toggle: noop, promote: noop, repeat: noop });
    expect(done.map((a) => a.id)).toEqual(["toggle", "promote", "repeat"]);
    expect(done[0].label).toBe("Offen");
  });
});

describe("file row actions", () => {
  it("the bookmark entry names the direction when the shell knows it, the toggle when it does not", () => {
    expect(fileRowActions(t, { bookmark: noop })[0].label).toBe("Lesezeichen");
    expect(fileRowActions(t, { bookmark: noop, bookmarked: true })[0].label).toBe("Lesezeichen entfernen");
    expect(fileRowActions(t, { bookmark: noop, bookmarked: false })[0].label).toBe("Lesezeichen hinzufügen");
  });

  it("picks a subset in the list's order, whatever order was asked for", () => {
    const list = fileRowActions(t, { rename: noop, move: noop, duplicate: noop, delete: noop, copyPath: noop });
    expect(pickRowActions(list, ["delete", "rename", "copyPath"]).map((a) => a.id)).toEqual(["rename", "copyPath", "delete"]);
  });

  it("the id catalog matches what the builders can produce", () => {
    const every = fileRowActions(t, {
      openNewTab: noop, openSplitRight: noop, openSplitDown: noop, rename: noop, duplicate: noop, move: noop, overview: noop, bookmark: noop,
      versionHistory: noop, resolveConflict: noop, reveal: noop, copyPath: noop, removeFromList: noop, delete: noop,
    });
    expect(every.map((a) => a.id)).toEqual([...ROW_ACTION_IDS.file]);
    const task = taskRowActions(t, { done: false, toggle: noop, promote: noop, repeat: noop, block: noop });
    expect(task.map((a) => a.id)).toEqual([...ROW_ACTION_IDS.task]);
  });
});

describe("the New catalog", () => {
  it("groups by where the thing lands, content first, and drops empty groups", () => {
    const groups = newEntries(t, { note: noop, folder: noop, base: noop, daily: noop });
    expect(groups.map((g) => g.id)).toEqual(["content"]);
    expect(groups[0].items.map((i) => i.id)).toEqual(["note", "daily", "folder", "base"]);
    const both = newEntries(t, { note: noop, task: noop });
    expect(both.map((g) => [g.id, g.items.map((i) => i.id)])).toEqual([["content", ["note"]], ["pim", ["task"]]]);
  });

  it("the flat order is the grouped order", () => {
    expect([...NEW_ITEM_ORDER]).toEqual(["note", "noteFromTemplate", "daily", "folder", "base", "template", "event", "task"]);
  });
});
