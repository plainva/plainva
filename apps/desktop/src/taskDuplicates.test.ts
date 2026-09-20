import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { findDuplicateTaskNotes, removableTaskCopies } from "@plainva/ui";
import type { TaskAnchorRecord } from "@plainva/core";

/**
 * Finding 2026-09-20 (plan A7): 63 provider tasks were claimed by more than one
 * note. The reconciler maintains ONE of them; the copies stay frozen at "open",
 * which read as "ticked off at Google, still open here".
 */

const DB = { dueKey: "Fällig", completion: { kind: "status" as const, status: { key: "Status", open: "Offen", done: "Erledigt", options: ["Offen", "In Arbeit", "Erledigt"] } } };

function note(title: string, status: string, due: string | null, body = "", uid = "u1"): string {
  return [
    "---",
    "plainva:",
    "  pim:",
    "    kind: task",
    "    provider: google",
    "    list: L1",
    `    uid: ${uid}`,
    `Status: ${status}`,
    ...(due ? [`Fällig: ${due}`] : []),
    "---",
    `# ${title}`,
    ...(body ? ["", body] : []),
    "",
  ].join("\n");
}

function anchors(paths: string[], uid = "u1", list = "L1"): Map<string, TaskAnchorRecord[]> {
  return new Map([[uid, paths.map((path, i) => ({ path, uid, list, provider: "google", ctime: 1000 + i }))]]);
}

describe("findDuplicateTaskNotes", () => {
  it("keeps the note the reconciler maintains and lets go only what carries nothing of its own", async () => {
    const files: Record<string, string> = {
      "Aufgaben/Blumen gießen.md": note("Blumen gießen", "Offen", "2026-09-21"),
      "Aufgaben/Blumen gießen 2.md": note("Blumen gießen", "Erledigt", "2026-08-14"),
      "Aufgaben/Blumen gießen 7.md": note("Blumen gießen", "Offen", "2026-09-21"),
      "Aufgaben/Blumen gießen 9.md": note("Blumen gießen", "Offen", "2026-08-02"),
      "Aufgaben/Blumen gießen 11.md": note("Blumen gießen", "Offen", "2026-09-21", "Den Farn nicht vergessen — er steht jetzt im Flur."),
    };
    const groups = await findDuplicateTaskNotes({
      anchorsByUid: anchors(Object.keys(files)),
      boundPath: () => "Aufgaben/Blumen gießen.md",
      readTextFile: async (p) => files[p],
      db: DB,
    });

    expect(groups).toHaveLength(1);
    expect(groups[0].notes.map((n) => [n.path.replace("Aufgaben/Blumen gießen", "…"), n.verdict])).toEqual([
      ["….md", "kept"],
      ["… 11.md", "ownText"],   // text of its own: a person has to look
      ["… 2.md", "removable"],  // done
      ["… 7.md", "removable"],  // same fields as the kept note
      ["… 9.md", "differs"],    // open with another date: says something the kept note does not
    ]);
    expect(removableTaskCopies(groups).sort()).toEqual(["Aufgaben/Blumen gießen 2.md", "Aufgaben/Blumen gießen 7.md"]);
  });

  it("without a state row picks the note the reconciler would adopt: the original name, not the oldest file", async () => {
    const files: Record<string, string> = {
      "Aufgaben/Steuern einreichen 2.md": note("Steuern einreichen", "Offen", null),
      "Aufgaben/Steuern einreichen.md": note("Steuern einreichen", "Offen", null),
    };
    const groups = await findDuplicateTaskNotes({
      // The copy is listed first AND older — path order and age must both lose to the name.
      anchorsByUid: anchors(Object.keys(files)),
      boundPath: () => null,
      readTextFile: async (p) => files[p],
      db: DB,
    });
    expect(groups[0].notes[0]).toMatchObject({ path: "Aufgaben/Steuern einreichen.md", verdict: "kept" });
    expect(removableTaskCopies(groups)).toEqual(["Aufgaben/Steuern einreichen 2.md"]);
  });

  it("treats the same uid in two lists as two tasks, and a single note as no duplicate", async () => {
    const files: Record<string, string> = { "a.md": note("A", "Offen", null), "b.md": note("A", "Offen", null) };
    const byUid = new Map<string, TaskAnchorRecord[]>([
      ["u1", [
        { path: "a.md", uid: "u1", list: "L1", ctime: 1 },
        { path: "b.md", uid: "u1", list: "L2", ctime: 2 },
      ]],
    ]);
    const groups = await findDuplicateTaskNotes({ anchorsByUid: byUid, boundPath: () => null, readTextFile: async (p) => files[p], db: DB });
    expect(groups).toEqual([]);
  });

  it("leaves a whole group alone when the kept note cannot be read, and marks an unreadable copy", async () => {
    const files: Record<string, string> = { "x.md": note("X", "Offen", null) };
    const read = async (p: string) => { if (!(p in files)) throw new Error("gone"); return files[p]; };
    expect(await findDuplicateTaskNotes({ anchorsByUid: anchors(["missing.md", "x.md"]), boundPath: () => "missing.md", readTextFile: read, db: DB })).toEqual([]);
    const groups = await findDuplicateTaskNotes({ anchorsByUid: anchors(["x.md", "missing.md"]), boundPath: () => "x.md", readTextFile: read, db: DB });
    expect(groups[0].notes.map((n) => n.verdict)).toEqual(["kept", "unreadable"]);
    expect(removableTaskCopies(groups)).toEqual([]);
  });
});

describe("both shells clear copies the same way", () => {
  // The rule is one hook; what the shells own is the DELETE they hand it. It
  // must be the plain note delete (snapshot, index, sync queue) — the task
  // deletion orders exist to make the provider's task follow, and a copy is
  // not the task. Guarded at the source, for both shells.
  const shells = [
    { file: join(__dirname, "components/tasks/TaskDuplicatesNotice.tsx"), plainDelete: /deleteItem\(path, false, \{ confirmed: true \}\)/ },
    { file: join(__dirname, "../../mobile/src/screens/TasksScreen.tsx"), plainDelete: /vaultOps\.remove\(vault, path, \{ confirmed: true \}\)/ },
  ];
  for (const { file, plainDelete } of shells) {
    it(`${basename(file)} drives the shared hook with a plain note delete`, () => {
      const source = readFileSync(file, "utf8");
      const hook = source.slice(source.indexOf("useTaskDuplicates({"));
      const call = hook.slice(0, hook.indexOf("});"));
      expect(call).toMatch(plainDelete);
      expect(call).not.toMatch(/queueTaskDeletion|taskDeletion|cascade/i);
    });
  }
});
