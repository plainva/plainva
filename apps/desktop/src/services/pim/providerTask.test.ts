import { describe, it, expect, vi } from "vitest";
import { anchorMatchesTask, createProviderTask, readProviderTaskAnchor, taskAnchorIdentity, type ProviderTaskAnchor } from "@plainva/ui";
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

  it("accepts an anchor without the legacy account id", () => {
    // The shape a reconnect-proof anchor has. Requiring `account` made exactly
    // this read as "no anchor", and the caller then created a SECOND remote
    // task for a note that already had one.
    expect(
      readProviderTaskAnchor("---\nplainva:\n  pim:\n    kind: task\n    uid: u1\n    list: l1\n    provider: google\n---\n")
    ).toEqual({ kind: "task", uid: "u1", list: "l1", provider: "google" });
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

describe("the anchor after a reconnect", () => {
  it("writes the stable pair and KEEPS the legacy id for an older shell", async () => {
    // E6: desktop and phone ship separately. A phone that dropped `account`
    // would be unreadable to a desktop that still requires it — and that
    // desktop would create a second remote task. So the field stays written
    // until both sides read the new shape.
    const adapter = fakeAdapter({ "n.md": NOTE });
    await createProviderTask({
      adapter,
      notePath: "n.md",
      accountId: "random-id-7",
      listId: "l1",
      provider: "google",
      identity: "google:me@example.com",
      draft: { title: "x" },
      createTask: async () => ({ uid: "u1" }),
    });
    const anchor = readFrontmatterPath(adapter.files["n.md"], ["plainva", "pim"]) as Record<string, unknown>;
    expect(anchor).toMatchObject({ provider: "google", identity: "google:me@example.com", account: "random-id-7" });
    // And the sibling anchor of a time-blocked task survives — the whole reason
    // this path uses setFrontmatterPath instead of replacing the namespace.
    expect(readFrontmatterPath(adapter.files["n.md"], ["plainva", "blocks"])).toBeTruthy();
  });

  it("derives the identity only where the provider verified one", () => {
    expect(taskAnchorIdentity({ config: { plainvaVerifiedProviderIdentity: { issuer: "Google", subject: "me@example.com" } } }))
      .toBe("google:me@example.com");
    // CalDAV has no profile to verify against — no identity, and that is fine.
    expect(taskAnchorIdentity({ config: {} })).toBeUndefined();
    expect(taskAnchorIdentity(null)).toBeUndefined();
  });

  it("never puts a NUL byte in a note", () => {
    // The Map key for a verified identity joins with a NUL byte. A note carrying
    // one counts as binary to git and grep — this project has repaired that
    // exact damage before.
    const id = taskAnchorIdentity({
      config: { plainvaVerifiedProviderIdentity: { issuer: "google", subject: "me@example.com" } },
    });
    expect(id).not.toContain(String.fromCharCode(0));
  });
});

describe("anchorMatchesTask", () => {
  const anchor = { uid: "u1", list: "l1" };

  it("matches on uid and list, which is what a reconnect leaves intact", () => {
    expect(anchorMatchesTask(anchor, { uid: "u1", list: "l1" })).toBe(true);
    expect(anchorMatchesTask(anchor, { uid: "u1", list: "other" })).toBe(false);
    expect(anchorMatchesTask(anchor, { uid: "other", list: "l1" })).toBe(false);
  });

  it("adopts a legacy anchor that knows neither provider nor identity", () => {
    // Every note in an existing vault looks like this. Refusing them would
    // leave the duplicates unadoptable — the situation the fix exists to end.
    const legacy: ProviderTaskAnchor = { kind: "task", uid: "u1", list: "l1", account: "old-random" };
    expect(anchorMatchesTask(legacy, { uid: "u1", list: "l1", provider: "google" })).toBe(true);
  });

  it("refuses a task from a different provider", () => {
    // A CalDAV list id is an href that looks the same for two accounts on one
    // server, and a VTODO uid travels through export and import.
    expect(anchorMatchesTask({ ...anchor, provider: "caldav" }, { uid: "u1", list: "l1", provider: "google" })).toBe(false);
  });

  it("refuses a task from a different account of the SAME provider", () => {
    expect(
      anchorMatchesTask(
        { ...anchor, provider: "google", identity: "google:work@example.com" },
        { uid: "u1", list: "l1", provider: "google", identity: "google:private@example.com" }
      )
    ).toBe(false);
  });

  it("adopts the same note no matter which connect wrote its anchor", () => {
    // The maintainer's vault, in one line: three anchors for one task, each
    // from a different connect. All three describe it, so all three match.
    for (const account of ["first-connect", "second-connect", "third-connect"]) {
      const written: ProviderTaskAnchor = { kind: "task", uid: "u1", list: "l1", account };
      expect(anchorMatchesTask(written, { uid: "u1", list: "l1" })).toBe(true);
    }
  });

  it("cannot be given an account to compare — the rule is enforced by the source", () => {
    // A runtime test cannot hold this: `anchorMatchesTask` takes no account,
    // so re-introducing the comparison would simply never fire. What has to
    // stay true is that nothing in the matcher READS one, because the field
    // changes on every reconnect and was the original cause of the duplicates.
    const src = readFileSync(
      join(__dirname, "../../../../../packages/ui/src/pim/providerTask.ts"),
      "utf8"
    );
    const matcher = src.slice(src.indexOf("export function anchorMatchesTask"));
    const body = matcher.slice(0, matcher.indexOf("\n}"));
    expect(body, "the matcher must not consult the local account id again").not.toMatch(/\.account\b/);
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
  /** The shared rule — one copy for both shells (S17). */
  const shared = readFileSync(
    join(__dirname, "../../../../../packages/ui/src/pim/taskToProvider.ts"),
    "utf8"
  );
  /** The desktop's adapter onto it: runtime wiring only, no decisions. */
  const adapter = read("services/pim/taskToProvider.ts");
  const tasks = read("components/tasks/TasksView.tsx");
  const mail = read("components/mail/MailView.tsx");

  it("asks the shared rule instead of reading the key itself", () => {
    expect(shared).toMatch(/resolveTaskListTarget\(config, lists\.filter\(/);
    // The adapter hands over runtime access; it must not decide anything, or
    // the phone would be free to decide differently.
    expect(adapter, "the desktop adapter must not resolve the target itself").not.toMatch(
      /resolveTaskListTarget|parseBaseConfig/
    );
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

  // The only assertion in this file that reads the component tree from disk, so
  // the only one that outgrows the 5 s default under the full suite's load
  // (2026-08-24). The rest are pure and stay on the default.
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
  }, 30_000);

  it("never lets a provider failure cost the note", () => {
    // The note exists on disk when the service runs. Its own error path must
    // report, not rethrow into a caller that would treat the whole capture as
    // failed. Checked on both layers — the adapter awaits provider calls too.
    expect(shared).toMatch(/catch \(e\)[\s\S]{0,200}return "createFailed"/);
    for (const [name, src] of [["the shared rule", shared], ["the desktop adapter", adapter]] as const) {
      expect(src, `a throw in ${name} would surface as 'capture failed'`).not.toMatch(/\bthrow\b/);
    }
  });
});
