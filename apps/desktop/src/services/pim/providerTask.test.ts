import { describe, it, expect, vi } from "vitest";
import { createProviderTask, readProviderTaskAnchor } from "@plainva/ui";
import { readFrontmatterPath } from "@plainva/core";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * C4/S16 — creating a task in Plainva that also exists at the provider.
 *
 * The interesting cases are the failures, because the note is already on disk
 * when this runs: a failed provider call must leave it alone, and a failed
 * anchor must be REPORTED, since the next sync would otherwise import the same
 * task a second time.
 */

const NOTE = `---
type: task
plainva:
  blocks:
    - uid: ev-1
      account: cal-1
      calendar: work
      start: 2026-08-14 09:00
---

# Buy milk
`;

function fakeAdapter(initial: Record<string, string>) {
  const files = { ...initial };
  return {
    files,
    readTextFile: vi.fn(async (p: string) => {
      if (!(p in files)) throw new Error(`missing ${p}`);
      return files[p];
    }),
    writeTextFile: vi.fn(async (p: string, c: string) => {
      files[p] = c;
    }),
  };
}

describe("createProviderTask", () => {
  it("creates the task and anchors the note with the four fields the reconciler reads", async () => {
    const adapter = fakeAdapter({ "T/buy-milk.md": NOTE });
    const createTask = vi.fn(async () => ({ uid: "task-42" }));

    const res = await createProviderTask({
      adapter,
      notePath: "T/buy-milk.md",
      accountId: "g1",
      listId: "@default",
      draft: { title: "Buy milk", due: "2026-08-20" },
      createTask,
    });

    expect(res).toEqual({ ok: true, uid: "task-42", accountId: "g1", listId: "@default", anchored: true });
    // A task is created open — nobody creates one in order to have it done.
    expect(createTask).toHaveBeenCalledWith("@default", {
      title: "Buy milk",
      due: "2026-08-20",
      completed: false,
    });

    const written = adapter.files["T/buy-milk.md"];
    expect(readFrontmatterPath(written, ["plainva", "pim", "kind"])).toBe("task");
    expect(readFrontmatterPath(written, ["plainva", "pim", "uid"])).toBe("task-42");
    expect(readFrontmatterPath(written, ["plainva", "pim", "account"])).toBe("g1");
    expect(readFrontmatterPath(written, ["plainva", "pim", "list"])).toBe("@default");
  });

  it("keeps a sibling plainva anchor instead of replacing the whole map", async () => {
    // upsertFrontmatterKeys would replace `plainva` wholesale and silently drop
    // the time block of a task someone had already scheduled.
    const adapter = fakeAdapter({ "T/buy-milk.md": NOTE });
    await createProviderTask({
      adapter,
      notePath: "T/buy-milk.md",
      accountId: "g1",
      listId: "@default",
      draft: { title: "Buy milk" },
      createTask: async () => ({ uid: "task-42" }),
    });
    const written = adapter.files["T/buy-milk.md"];
    expect(readFrontmatterPath(written, ["plainva", "blocks", "0", "uid"])).toBe("ev-1");
    expect(readFrontmatterPath(written, ["type"])).toBe("task");
  });

  it("leaves the note untouched when the provider refuses", async () => {
    const adapter = fakeAdapter({ "T/buy-milk.md": NOTE });
    const res = await createProviderTask({
      adapter,
      notePath: "T/buy-milk.md",
      accountId: "g1",
      listId: "@default",
      draft: { title: "Buy milk" },
      createTask: async () => {
        throw new Error("503");
      },
    });
    expect(res).toEqual({ ok: false, reason: "createFailed" });
    // The note is the deliverable; a failed network call must not cost it.
    expect(adapter.files["T/buy-milk.md"]).toBe(NOTE);
    expect(adapter.writeTextFile).not.toHaveBeenCalled();
  });

  it("reports a task that was created but could not be anchored", async () => {
    // Silence here is the expensive one: the task exists remotely, the note
    // does not point at it, and the next sync imports a SECOND note for it.
    const adapter = fakeAdapter({ "T/buy-milk.md": NOTE });
    adapter.writeTextFile.mockRejectedValueOnce(new Error("read-only vault"));
    const res = await createProviderTask({
      adapter,
      notePath: "T/buy-milk.md",
      accountId: "g1",
      listId: "@default",
      draft: { title: "Buy milk" },
      createTask: async () => ({ uid: "task-42" }),
    });
    expect(res).toEqual({ ok: true, uid: "task-42", accountId: "g1", listId: "@default", anchored: false });
  });

  it("omits due and notes rather than sending empty ones", async () => {
    const createTask = vi.fn(async () => ({ uid: "t" }));
    await createProviderTask({
      adapter: fakeAdapter({ "n.md": NOTE }),
      notePath: "n.md",
      accountId: "a",
      listId: "l",
      draft: { title: "Bare" },
      createTask,
    });
    expect(createTask).toHaveBeenCalledWith("l", { title: "Bare", completed: false });
  });
});

describe("readProviderTaskAnchor", () => {
  it("reads back what it wrote", async () => {
    const adapter = fakeAdapter({ "n.md": NOTE });
    await createProviderTask({
      adapter,
      notePath: "n.md",
      accountId: "g1",
      listId: "@default",
      draft: { title: "x" },
      createTask: async () => ({ uid: "u1" }),
    });
    expect(readProviderTaskAnchor(adapter.files["n.md"])).toEqual({
      kind: "task",
      uid: "u1",
      account: "g1",
      list: "@default",
    });
  });

  it("refuses a half-written or hand-edited anchor instead of throwing", async () => {
    // Frontmatter is a file a person may edit. An incomplete anchor is not an
    // anchor, and it must not crash the path that checks for one.
    for (const fm of [
      "---\nplainva:\n  pim:\n    kind: task\n    uid: u\n---\n",
      "---\nplainva:\n  pim:\n    kind: event\n    uid: u\n    account: a\n    list: l\n---\n",
      "---\nplainva:\n  pim: notamap\n---\n",
      "---\nplainva:\n  pim:\n    kind: task\n    uid: \"\"\n    account: a\n    list: l\n---\n",
      "---\ntype: note\n---\n",
      "no frontmatter at all\n",
    ]) {
      expect(readProviderTaskAnchor(fm), fm).toBeNull();
    }
  });
});

/**
 * The first caller `IPimTarget.createTask` has ever had — and it must be the
 * ONLY one. Read from the source rather than mocked: what matters is that
 * every way of creating a task takes the same route, because otherwise it
 * depends on WHERE a task was born whether it reaches the provider. That split
 * is the bug class the shared open rule (S13) was written against.
 */
describe("the desktop creation path", () => {
  const read = (p: string) => readFileSync(join(__dirname, "..", "..", p), "utf8");
  const service = read("services/pim/taskToProvider.ts");
  const tasks = read("components/tasks/TasksView.tsx");
  const mail = read("components/mail/MailView.tsx");

  it("asks the shared rule instead of reading the key itself", () => {
    expect(service).toMatch(/resolveTaskListTarget\(config, lists\.filter\(/);
    for (const [name, src] of [["TasksView", tasks], ["MailView", mail]] as const) {
      expect(src, `${name} must not read the stored key directly`).not.toMatch(/config\.taskList/);
    }
  });

  it("routes all three ways of creating a task through the one service", () => {
    // "+ New task", a promoted checkbox, a mail captured as a task.
    expect(tasks).toMatch(/sendToProvider\(taskDb, res\.notePath/);
    expect(tasks).toMatch(/sendToProvider\(db, res\.notePath/);
    expect(mail).toMatch(/sendTaskToProviderList\(\{/);
    for (const [name, src] of [["TasksView", tasks], ["MailView", mail]] as const) {
      expect(src, `${name} must not call the provider itself`).not.toMatch(/createProviderTask\(/);
    }
  });

  it("creates the note first and the remote task after", () => {
    // Checked per call site, not per file: TasksView has two, and a plain
    // file-order comparison would pass while one of them was pulled in front
    // of its note creation.
    const creators = /createTaskInDatabase\(\{|promoteTask\(\{/g;
    for (const [name, src, call] of [
      ["TasksView", tasks, /await sendToProvider\(/g],
      ["MailView", mail, /await sendTaskToProviderList\(\{/g],
    ] as const) {
      const notes = [...src.matchAll(creators)].map((m) => m.index ?? -1);
      const sends = [...src.matchAll(call)].map((m) => m.index ?? -1);
      expect(notes.length, `${name}: the note creation moved — re-point this guard`).toBeGreaterThan(0);
      expect(sends.length, `${name}: the provider call moved — re-point this guard`).toBeGreaterThan(0);
      for (const at of sends) {
        const preceding = notes.filter((n) => n < at && at - n < 3000);
        expect(preceding.length, `${name}: the note is the deliverable and must exist first`).toBeGreaterThan(0);
      }
    }
  });

  it("tells the user about both failure modes", () => {
    // A task that exists only locally, and a task that exists remotely without
    // an anchor, are different problems with different consequences.
    for (const [name, src] of [["TasksView", tasks], ["MailView", mail]] as const) {
      expect(src, `${name} swallows a failed creation`).toMatch(/tasks\.providerCreateFailed/);
      expect(src, `${name} swallows an unanchored task`).toMatch(/tasks\.providerAnchorFailed/);
    }
  });

  it("leaves no way of creating a task that skips the provider", () => {
    // The drift guard. Three call sites today; a fourth added without this
    // route would silently create tasks that never reach the list — and it
    // would look fine, because the note is there.
    const dir = join(__dirname, "..", "..");
    const files = [
      ...readdirSync(join(dir, "components"), { recursive: true, encoding: "utf8" })
        .filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"))
        .map((f) => join("components", String(f))),
    ];
    const creators: string[] = [];
    for (const rel of files) {
      const src = readFileSync(join(dir, rel), "utf8");
      if (/createTaskInDatabase\(\{|promoteTask\(\{/.test(src)) creators.push(rel);
    }
    expect(creators.length, "no creation call site found — re-point this guard").toBeGreaterThan(0);
    for (const rel of creators) {
      const src = readFileSync(join(dir, rel), "utf8");
      expect(src, `${rel} creates tasks without sending them to the provider list`).toMatch(
        /sendToProvider\(|sendTaskToProviderList\(/
      );
    }
  });

  it("never lets a provider failure cost the note", () => {
    // The note exists on disk when the service runs. Its own error path must
    // report, not rethrow into a caller that would treat the whole capture as
    // failed.
    expect(service).toMatch(/catch \(e\)[\s\S]{0,200}return "createFailed"/);
    expect(service, "a throw here would surface as 'capture failed'").not.toMatch(/\bthrow\b/);
  });
});
