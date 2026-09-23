import { describe, expect, it } from "vitest";
import {
  buildWidgetSnapshot,
  parseWidgetSnapshot,
  serializeWidgetSnapshot,
  usableWidgetActions,
  WIDGET_SNAPSHOT_MAX_ROWS,
  WIDGET_SNAPSHOT_VERSION,
  type PlannerRow,
  type WidgetLabels,
  type WidgetSnapshotInput,
} from "@plainva/ui";

/**
 * What a home-screen widget gets to see (plan Widgets, W1/E2).
 *
 * A widget can compute nothing — there is no JavaScript running when the app
 * is closed — so everything it shows has to be written down while the app was
 * last open. These pin the three rules that follow from that: a week of
 * supply, no note text and no path, and locked means empty.
 */

const LABELS: WidgetLabels = {
  today: "Heute",
  overdue: "Überfällig",
  empty: "Nichts fällig",
  locked: "Gesperrt — in Plainva öffnen",
  pending: "wird beim Öffnen übernommen",
  newTask: "Aufgabe",
  newJournal: "Journal",
};

const NOW = new Date(2026, 8, 23, 10, 0); // 2026-09-23

function task(over: Partial<PlannerRow> & { due: string | null }): PlannerRow {
  return {
    id: `t:${over.due}:${over.title ?? ""}`,
    source: "database",
    path: `Aufgaben/${over.title ?? "Eine Aufgabe"}.md`,
    title: "Eine Aufgabe",
    state: "open",
    dueMinutes: null,
    priority: 0,
    tags: [],
    ...over,
  } as PlannerRow;
}

const full = (over: Partial<WidgetSnapshotInput> = {}) =>
  buildWidgetSnapshot({ vaultName: "Notizen", labels: LABELS, now: NOW, ...over });
const build = (over: Partial<WidgetSnapshotInput> = {}) => full(over).snapshot;

describe("what travels", () => {
  it("carries a week of supply, so a phone left alone still says something true", () => {
    const snapshot = build({
      tasks: [
        task({ due: "2026-09-23", title: "Heute" }),
        task({ due: "2026-09-27", title: "In vier Tagen" }),
        task({ due: "2026-09-30", title: "In sieben Tagen" }),
        task({ due: "2026-10-01", title: "Zu weit" }),
      ],
    });
    expect(snapshot.rows.map((r) => r.title)).toEqual(["Heute", "In vier Tagen", "In sieben Tagen"]);
  });

  it("counts what is overdue and never lists it", () => {
    const snapshot = build({
      tasks: [
        task({ due: "2026-09-20", title: "Längst fällig" }),
        task({ due: "2026-09-22", title: "Gestern" }),
        task({ due: "2026-09-23", title: "Heute" }),
      ],
    });
    expect(snapshot.overdue).toBe(2);
    // A number, never a list: the overdue rows themselves stay out.
    expect(snapshot.rows.map((r) => r.title)).toEqual(["Heute"]);
  });

  it("leaves closed tasks and undated ones out entirely", () => {
    const snapshot = build({
      tasks: [
        task({ due: "2026-09-23", title: "Offen" }),
        task({ due: "2026-09-23", title: "Erledigt", state: "done" }),
        task({ due: "2026-09-23", title: "Verworfen", state: "cancelled" }),
        task({ due: null, title: "Ohne Datum" }),
      ],
    });
    expect(snapshot.rows.map((r) => r.title)).toEqual(["Offen"]);
  });

  it("carries no note text and no path — only an index a tap can name", () => {
    const snapshot = build({ tasks: [task({ due: "2026-09-23", title: "Miete überweisen" })] });
    const raw = serializeWidgetSnapshot(snapshot);
    expect(raw).not.toContain("Aufgaben/");
    expect(Object.keys(snapshot.rows[0])).toEqual(["kind", "title", "day", "minutes", "priority", "index"]);
    expect(snapshot.rows[0].index).toBe(0);
  });

  it("hands the paths back separately, aligned row for row", () => {
    // The app keeps these in its OWN storage, so a tap still reaches a note
    // without the widget's file ever having held one.
    const { snapshot, refs } = full({
      tasks: [task({ due: "2026-09-23", title: "Miete" })],
      events: [{ title: "Zahnarzt", day: "2026-09-23", minutes: 540 }],
    });
    expect(refs).toHaveLength(snapshot.rows.length);
    const taskRow = snapshot.rows.find((r) => r.kind === "task")!;
    const eventRow = snapshot.rows.find((r) => r.kind === "event")!;
    expect(refs[taskRow.index]).toEqual({ path: "Aufgaben/Miete.md" });
    // An appointment lives at the provider, not in a note.
    expect(refs[eventRow.index]).toBeNull();
  });

  it("carries a checkbox's ordinal, because its path alone names the note not the line", () => {
    const { refs } = full({ tasks: [task({ due: "2026-09-23", title: "Kasten", source: "note", ordinal: 4 })] });
    expect(refs[0]).toEqual({ path: "Aufgaben/Kasten.md", ordinal: 4 });
  });

  it("hands back no paths at all for a sealed vault", () => {
    const { refs } = full({ locked: true, tasks: [task({ due: "2026-09-23", title: "Geheim" })] });
    expect(refs).toEqual([]);
  });
});

describe("the order someone glancing at a home screen wants", () => {
  it("puts timed things before untimed, then priority, then tasks before appointments", () => {
    const snapshot = build({
      tasks: [
        task({ due: "2026-09-23", title: "Ohne Zeit, wichtig", priority: 3 }),
        task({ due: "2026-09-23", title: "Ohne Zeit", priority: 0 }),
        task({ due: "2026-09-23", title: "Um neun", dueMinutes: 540 }),
      ],
      events: [
        { title: "Termin um neun", day: "2026-09-23", minutes: 540 },
        { title: "Ganztägig", day: "2026-09-23", minutes: null },
      ],
    });
    expect(snapshot.rows.map((r) => r.title)).toEqual([
      "Um neun",          // timed, and a task beats an appointment at the same minute
      "Termin um neun",
      "Ohne Zeit, wichtig",
      "Ohne Zeit",
      "Ganztägig",
    ]);
  });

  it("sorts before it cuts, so the ceiling drops the far end of the week", () => {
    const many = Array.from({ length: 80 }, (_unused, i) =>
      task({ due: i < 40 ? "2026-09-29" : "2026-09-23", title: `Nr ${i}` }),
    );
    const snapshot = build({ tasks: many });
    expect(snapshot.rows).toHaveLength(WIDGET_SNAPSHOT_MAX_ROWS);
    // Today survived; the far day is what got cut.
    expect(snapshot.rows[0].day).toBe("2026-09-23");
    expect(snapshot.rows.filter((r) => r.day === "2026-09-23")).toHaveLength(40);
    // And the indices are still 0..n, because a tap names a position.
    expect(snapshot.rows.map((r) => r.index)).toEqual(snapshot.rows.map((_r, i) => i));
  });
});

describe("what a device may withhold", () => {
  it("drops every title when the device asked for counters only", () => {
    const snapshot = build({
      tasks: [task({ due: "2026-09-23", title: "Arzttermin vorbereiten" })],
      showTitles: false,
    });
    expect(snapshot.rows[0].title).toBe("");
    expect(serializeWidgetSnapshot(snapshot)).not.toContain("Arzttermin");
    // The row itself stays, so the widget can still say how many there are.
    expect(snapshot.rows).toHaveLength(1);
  });

  it("leaves appointments out when the device asked for tasks only", () => {
    const snapshot = build({
      tasks: [task({ due: "2026-09-23", title: "Aufgabe" })],
      events: [{ title: "Zahnarzt", day: "2026-09-23", minutes: 600 }],
      showEvents: false,
    });
    expect(snapshot.rows.map((r) => r.kind)).toEqual(["task"]);
    expect(serializeWidgetSnapshot(snapshot)).not.toContain("Zahnarzt");
  });

  it("writes an EMPTY snapshot when the workspace is locked, not a hidden one", () => {
    const snapshot = build({
      locked: true,
      tasks: [task({ due: "2026-09-23", title: "Geheim" })],
      events: [{ title: "Auch geheim", day: "2026-09-23", minutes: 600 }],
    });
    expect(snapshot.locked).toBe(true);
    expect(snapshot.rows).toEqual([]);
    expect(snapshot.overdue).toBe(0);
    // A file that never held the titles cannot leak them.
    const raw = serializeWidgetSnapshot(snapshot);
    expect(raw).not.toContain("Geheim");
    expect(raw).not.toContain("Auch geheim");
  });
});

describe("reading it back", () => {
  it("survives the round trip", () => {
    const snapshot = build({ tasks: [task({ due: "2026-09-23", title: "Hin und zurück" })] });
    expect(parseWidgetSnapshot(serializeWidgetSnapshot(snapshot))).toEqual(snapshot);
  });

  it("refuses a file it does not understand, instead of guessing", () => {
    expect(parseWidgetSnapshot("nicht json")).toBeNull();
    expect(parseWidgetSnapshot("null")).toBeNull();
    expect(parseWidgetSnapshot(JSON.stringify({ version: WIDGET_SNAPSHOT_VERSION + 1, rows: [] }))).toBeNull();
    expect(parseWidgetSnapshot(JSON.stringify({ version: WIDGET_SNAPSHOT_VERSION }))).toBeNull();
  });
});

describe("a tick made on the home screen", () => {
  const snapshot = build({
    tasks: [
      task({ due: "2026-09-23", title: "Erste" }),
      task({ due: "2026-09-23", title: "Zweite" }),
    ],
    events: [{ title: "Termin", day: "2026-09-23", minutes: 700 }],
  });
  const at = snapshot.writtenAt;
  // Read the positions off the snapshot rather than guessing them: the order
  // is the one a home screen wants, and the timed appointment sorts above the
  // two undated tasks.
  const taskIndex = snapshot.rows.find((r) => r.kind === "task")!.index;
  const eventIndex = snapshot.rows.find((r) => r.kind === "event")!.index;

  it("is applied when it names the snapshot it was made against", () => {
    const usable = usableWidgetActions([{ index: taskIndex, snapshotAt: at, at: at + 10 }], snapshot);
    expect(usable.map((a) => a.index)).toEqual([taskIndex]);
  });

  it("is dropped when the app has written a newer snapshot since", () => {
    // The index would now point at a different row, and ticking the wrong task
    // is worse than doing nothing.
    expect(usableWidgetActions([{ index: taskIndex, snapshotAt: at - 1, at }], snapshot)).toEqual([]);
  });

  it("is dropped when it names an appointment, or no row at all", () => {
    // An appointment is not something one ticks off.
    expect(usableWidgetActions([{ index: eventIndex, snapshotAt: at, at }], snapshot)).toEqual([]);
    expect(usableWidgetActions([{ index: 99, snapshotAt: at, at }], snapshot)).toEqual([]);
  });

  it("counts a row tapped twice as one tick", () => {
    const twice = [
      { index: taskIndex, snapshotAt: at, at },
      { index: taskIndex, snapshotAt: at, at: at + 5 },
    ];
    expect(usableWidgetActions(twice, snapshot)).toHaveLength(1);
  });

  it("has nothing to apply without a snapshot", () => {
    expect(usableWidgetActions([{ index: taskIndex, snapshotAt: at, at }], null)).toEqual([]);
  });
});
