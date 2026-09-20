// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseJournal } from "@plainva/core";
import {
  JournalCaptureField, JournalDayList, JournalDaySection, toast, toastStore, useJournalActions, useJournalFeed,
  type JournalActions, type JournalDay, type JournalFeedDeps, type JournalFeedState, type JournalFiles,
} from "@plainva/ui";
import en from "../../../packages/ui/src/locales/en.json";

/**
 * The journal's shared surfaces (plan Journal, J4/J5): the day list, the capture
 * field, the "journal of this day" section and the two hooks behind them. The
 * desktop tab, the phone screen, the sidebar section and the Today section are
 * wiring around exactly these — what is pinned here holds in both shells.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("react-i18next", async () => {
  const data = (await import("../../../packages/ui/src/locales/en.json")).default;
  const lookup = (key: string): unknown => key.split(".").reduce<unknown>((obj, k) => (obj as Record<string, unknown>)?.[k], data);
  return { initReactI18next: { type: "3rdParty", init() {} }, useTranslation: () => ({ i18n: { language: "en" },
    t: (key: string, vars?: Record<string, unknown>) => {
      const plural = typeof vars?.count === "number" ? lookup(`${key}_${vars.count === 1 ? "one" : "other"}`) : undefined;
      const value = plural ?? lookup(key);
      return Object.entries(vars ?? {}).reduce((text, [k, v]) => text.split(`{{${k}}}`).join(String(v)), typeof value === "string" ? value : key);
    },
  }) };
});

const HEADING = "Journal";
const NOTE = "# Sunday\n\n## Journal\n\n- 09:12 Called the workshop #client\n- [ ] 10:30 Order the spare part\n- 14:05 Router is in the basement\n\n## Notes\n\nkeep me\n";

function dayOf(key: string, raw: string, path = `${key}.md`): JournalDay {
  const [y, m, d] = key.split("-").map(Number);
  return { key, date: new Date(y, m - 1, d), path, entries: parseJournal(raw, { heading: HEADING }).entries };
}

const mounted: Array<{ root: Root; host: HTMLDivElement }> = [];
afterEach(async () => {
  for (const { root, host } of mounted.splice(0)) { await act(async () => root.unmount()); host.remove(); }
  toast.clearAll();
});
async function mount(node: React.ReactNode): Promise<{ host: HTMLDivElement; root: Root }> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  await act(async () => { root.render(node); });
  return { host, root };
}
const all = (host: HTMLElement, testId: string) => [...host.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`)];
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

/** Types into a controlled field the way React hears it. */
async function type(field: HTMLInputElement | HTMLTextAreaElement, text: string) {
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function press(field: HTMLElement, key: string, init: KeyboardEventInit = {}) {
  await act(async () => { field.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init })); });
}

const listProps = {
  onToggleTask: vi.fn(), onOpenNote: vi.fn(), onOpenEntry: vi.fn(), onMenu: vi.fn(),
};

describe("JournalDayList", () => {
  it("draws a day with its count, the newest entry on top, and a box only where the entry is a task", async () => {
    const day = dayOf("2026-09-20", NOTE);
    const { host } = await mount(<JournalDayList days={[day]} todayKey="2026-09-20" {...listProps} />);
    const section = all(host, "journal-day");
    expect(section).toHaveLength(1);
    expect(section[0].getAttribute("data-day")).toBe("2026-09-20");
    expect(section[0].textContent).toContain(`${en.journal.today} · `);
    expect(section[0].textContent).toContain("3 entries");

    const rows = all(host, "journal-entry");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Router is in the basement"),
      expect.stringContaining("Order the spare part"),
      expect.stringContaining("Called the workshop"),
    ]);
    expect(rows.map((row) => row.getAttribute("data-task"))).toEqual([null, "open", null]);
    expect(all(host, "journal-entry-toggle")).toHaveLength(1);
    // The time leads every line — a column down the day; the box of a task entry stands between it and the text.
    expect([...host.querySelectorAll("time")].map((node) => node.getAttribute("datetime"))).toEqual(["14:05", "10:30", "09:12"]);
    expect([...rows[1].querySelector(".pv-journal-line")!.children].map((node) => node.className)).toEqual(["pv-journal-time", "pv-journal-box", "pv-journal-body"]);
    expect([...rows[0].querySelector(".pv-journal-line")!.children].map((node) => node.className)).toEqual(["pv-journal-time", "pv-journal-body"]);
    // The text is Markdown: a tag is the pill the editor draws.
    expect(host.querySelector('.pv-tag-pill[data-tag="client"]')).not.toBeNull();
  });

  it("names yesterday, and writes the year only for a day of another year", async () => {
    const { host } = await mount(
      <JournalDayList days={[dayOf("2026-09-19", NOTE), dayOf("2025-12-31", NOTE)]} todayKey="2026-09-20" {...listProps} />,
    );
    const [yesterday, lastYear] = all(host, "journal-day");
    expect(yesterday.textContent).toContain(`${en.journal.yesterday} · `);
    expect(yesterday.textContent).not.toContain("2026");
    expect(lastYear.textContent).toContain("2025");
  });

  it("keeps the phone's heading to one line: a short date and no count", async () => {
    const { host } = await mount(<JournalDayList compact days={[dayOf("2026-09-20", NOTE)]} todayKey="2026-09-20" {...listProps} />);
    const heading = all(host, "journal-day")[0].textContent!;
    expect(heading).toContain(`${en.journal.today} · Sun, 09/20`);
    expect(heading).not.toContain("entries");
    expect(all(host, "journal-open-note")).toHaveLength(1);
  });

  it("reads the time of an entry the note spells its own way", async () => {
    const raw = "## Journal\n\n- 9:05 early\n- 14:05:30 with seconds\n";
    const { host } = await mount(<JournalDayList days={[dayOf("2026-09-20", raw)]} todayKey="2026-09-20" {...listProps} />);
    expect([...host.querySelectorAll("time")].map((node) => node.getAttribute("datetime"))).toEqual(["14:05", "09:05"]);
  });

  it("folds a long entry, and More opens it", async () => {
    const long = `## Journal\n\n- 08:00 ${"word ".repeat(120).trim()}\n`;
    const { host } = await mount(<JournalDayList days={[dayOf("2026-09-20", long)]} todayKey="2026-09-20" {...listProps} />);
    expect(host.querySelector(".pv-journal-fold")).not.toBeNull();
    const more = all(host, "journal-entry-more")[0];
    expect(more.textContent).toBe(en.journal.showMore);
    await act(async () => { more.click(); });
    expect(host.querySelector(".pv-journal-fold")).toBeNull();
    expect(all(host, "journal-entry-more")[0].textContent).toBe(en.journal.showLess);
  });

  it("puts the editor in the place of the one entry that is being edited", async () => {
    const day = dayOf("2026-09-20", NOTE);
    const target = day.entries.find((entry) => entry.time === "10:30")!;
    const { host } = await mount(
      <JournalDayList
        days={[day]} todayKey="2026-09-20" {...listProps}
        editing={{ path: day.path, line: target.line }}
        renderEditor={(_, entry) => <p data-testid="probe">{entry.text}</p>}
      />,
    );
    expect(all(host, "journal-entry")).toHaveLength(2);
    expect(all(host, "journal-entry-editing")).toHaveLength(1);
    expect(all(host, "probe")[0].textContent).toBe("Order the spare part");
  });

  it("leaves the day heading out when the surface brings its own", async () => {
    const { host } = await mount(<JournalDayList headless days={[dayOf("2026-09-20", NOTE)]} todayKey="2026-09-20" {...listProps} />);
    expect(all(host, "journal-open-note")).toHaveLength(0);
    expect(all(host, "journal-entry")).toHaveLength(3);
  });

  it("asks the shell for the menu on a right click and on the more button — neither opens the entry", async () => {
    const onMenu = vi.fn();
    const onOpenEntry = vi.fn();
    const onToggleTask = vi.fn();
    const day = dayOf("2026-09-20", NOTE);
    const { host } = await mount(<JournalDayList days={[day]} todayKey="2026-09-20" {...listProps} onMenu={onMenu} onOpenEntry={onOpenEntry} onToggleTask={onToggleTask} />);
    const row = all(host, "journal-entry")[0];
    await act(async () => { row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 60 })); });
    expect(onMenu).toHaveBeenLastCalledWith(day, expect.objectContaining({ time: "14:05" }), { x: 40, y: 60 });
    await act(async () => { all(row, "journal-entry-menu")[0].click(); });
    expect(onMenu).toHaveBeenCalledTimes(2);
    await act(async () => { all(host, "journal-entry-toggle")[0].click(); });
    expect(onToggleTask).toHaveBeenCalledWith(day, expect.objectContaining({ time: "10:30" }));
    expect(onOpenEntry).not.toHaveBeenCalled();
    // The row itself opens the entry.
    await act(async () => { row.click(); });
    expect(onOpenEntry).toHaveBeenCalledWith(day, expect.objectContaining({ time: "14:05" }));
  });

  it("opens a tag through the shell's handler, not the entry behind it", async () => {
    const onOpenTag = vi.fn();
    const onOpenEntry = vi.fn();
    const { host } = await mount(<JournalDayList days={[dayOf("2026-09-20", NOTE)]} todayKey="2026-09-20" {...listProps} onOpenEntry={onOpenEntry} links={{ onOpenTag }} />);
    await act(async () => { (host.querySelector(".pv-tag-pill") as HTMLElement).click(); });
    expect(onOpenTag).toHaveBeenCalledWith("client");
    expect(onOpenEntry).not.toHaveBeenCalled();
  });
});

describe("JournalCaptureField", () => {
  const base = { value: "", onChange: vi.fn(), asTask: false, onAsTask: vi.fn(), onSubmit: vi.fn() };

  it("saves on Enter, breaks the line on Shift+Enter, discards on Escape — and never saves nothing", async () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    const { host, root } = await mount(<JournalCaptureField {...base} value="" onSubmit={onSubmit} onCancel={onCancel} />);
    const field = () => all(host, "journal-capture-input")[0];
    await press(field(), "Enter");
    expect(onSubmit).not.toHaveBeenCalled();
    await act(async () => { root.render(<JournalCaptureField {...base} value="a thought" onSubmit={onSubmit} onCancel={onCancel} />); });
    await press(field(), "Enter", { shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    await press(field(), "Enter");
    expect(onSubmit).toHaveBeenCalledTimes(1);
    await press(field(), "Escape");
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("leaves Enter to the line break where a button saves (soft keyboard)", async () => {
    const onSubmit = vi.fn();
    const { host } = await mount(<JournalCaptureField {...base} value="a thought" onSubmit={onSubmit} enterSubmits={false} />);
    await press(all(host, "journal-capture-input")[0], "Enter");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(host.textContent).toContain(en.journal.captureHintTouch);
  });

  it("shows the entry's own time while it is edited, and no hint line when the surface wants none", async () => {
    const { host } = await mount(<JournalCaptureField {...base} value="x" time="9:05" hint={null} testId="journal-edit" />);
    expect(all(host, "journal-edit-time")[0].getAttribute("datetime")).toBe("09:05");
    expect(host.querySelector(".pv-capture-hint")).toBeNull();
    expect(all(host, "journal-edit-input")[0].hasAttribute("aria-describedby")).toBe(false);
  });

  it("toggles the task chip through its owner", async () => {
    const onAsTask = vi.fn();
    const { host } = await mount(<JournalCaptureField {...base} onAsTask={onAsTask} />);
    await act(async () => { all(host, "journal-capture-task")[0].click(); });
    expect(onAsTask).toHaveBeenCalledWith(true);
  });
});

/** A vault of daily notes in memory, with the write path's three calls. */
function memoryFiles(seed: Record<string, string>) {
  const data = new Map(Object.entries(seed));
  const reads: string[] = [];
  const files: JournalFiles = {
    ensureDailyNote: async (date) => {
      const path = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}.md`;
      const created = !data.has(path);
      if (created) data.set(path, "");
      return { path, created };
    },
    readTextFile: async (path) => {
      reads.push(path);
      const hit = data.get(path);
      if (hit === undefined) throw new Error(`ENOENT ${path}`);
      return hit;
    },
    writeTextFile: async (path, content) => { data.set(path, content); },
  };
  return { data, reads, files };
}

function ActionsProbe({ deps, expose }: { deps: Parameters<typeof useJournalActions>[0]; expose: (actions: JournalActions) => void }) {
  const actions = useJournalActions(deps);
  useEffect(() => { expose(actions); });
  return null;
}

describe("useJournalActions", () => {
  async function setup(seed: Record<string, string> = { "2026-09-20.md": NOTE }, failureText = (reason: string) => `refused:${reason}`) {
    const vault = memoryFiles(seed);
    const onChanged = vi.fn();
    const onShowInNote = vi.fn();
    let actions!: JournalActions;
    await mount(<ActionsProbe deps={{ files: vault.files, heading: HEADING, failureText, onChanged, onShowInNote }} expose={(next) => { actions = next; }} />);
    return { ...vault, onChanged, onShowInNote, get actions() { return actions; } };
  }
  const entryAt = (raw: string, time: string) => parseJournal(raw, { heading: HEADING }).entries.find((entry) => entry.time === time)!;

  it("turns an entry into a task in the note and has the day read again", async () => {
    const ctx = await setup();
    const day = { path: "2026-09-20.md" };
    await act(async () => { ctx.actions.capsOf(day, entryAt(NOTE, "14:05")).toTask!(); });
    await settle();
    expect(ctx.data.get(day.path)).toContain("- [ ] 14:05 Router is in the basement");
    expect(ctx.onChanged).toHaveBeenCalledWith(day.path);
    // Every other line is what it was.
    expect(ctx.data.get(day.path)!.replace("- [ ] 14:05", "- 14:05")).toBe(NOTE);
  });

  it("names what a row can do from the entry: a task can be ticked and turned back", async () => {
    const ctx = await setup();
    const plain = ctx.actions.capsOf({ path: "2026-09-20.md" }, entryAt(NOTE, "09:12"));
    const task = ctx.actions.capsOf({ path: "2026-09-20.md" }, entryAt(NOTE, "10:30"));
    expect([plain.isTask, plain.done]).toEqual([false, false]);
    expect([task.isTask, task.done]).toEqual([true, false]);
    await act(async () => { task.toggle!(); });
    await settle();
    expect(ctx.data.get("2026-09-20.md")).toMatch(/- \[x\] 10:30 Order the spare part/);
  });

  it("deletes with an undo that gives the note back byte for byte", async () => {
    const ctx = await setup();
    const day = { path: "2026-09-20.md" };
    await act(async () => { ctx.actions.capsOf(day, entryAt(NOTE, "09:12")).delete!(); });
    await settle();
    expect(ctx.data.get(day.path)).not.toContain("Called the workshop");
    const shown = toastStore.get().find((item) => item.message === en.journal.deleted);
    expect(shown?.action?.label).toBe(en.common.undo);
    await act(async () => { shown!.action!.run(); });
    await settle();
    expect(ctx.data.get(day.path)).toBe(NOTE);
    expect(ctx.onChanged).toHaveBeenCalledTimes(2);
  });

  it("saves an edit with its kind, and closes the editor only once the note carries it", async () => {
    const ctx = await setup();
    const day = { path: "2026-09-20.md" };
    const entry = entryAt(NOTE, "09:12");
    await act(async () => { ctx.actions.capsOf(day, entry).edit!(); });
    expect(ctx.actions.editing).toEqual({ path: day.path, line: entry.line, text: "Called the workshop #client", asTask: false });
    await act(async () => { ctx.actions.setEditing((draft) => (draft ? { ...draft, text: "Called the workshop twice", asTask: true } : draft)); });
    await act(async () => { ctx.actions.saveEdit(day, entry); });
    await settle();
    expect(ctx.data.get(day.path)).toContain("- [ ] 09:12 Called the workshop twice");
    expect(ctx.actions.editing).toBeNull();
  });

  it("says why a change was refused, keeps the editor open, and still has the day read again", async () => {
    const ctx = await setup();
    const day = { path: "2026-09-20.md" };
    const entry = entryAt(NOTE, "09:12");
    await act(async () => { ctx.actions.capsOf(day, entry).edit!(); });
    // Somebody else removed the line in the meantime.
    ctx.data.set(day.path, NOTE.replace("- 09:12 Called the workshop #client\n", ""));
    await act(async () => { ctx.actions.saveEdit(day, entry); });
    await settle();
    expect(toastStore.get().some((item) => item.kind === "error" && item.message === "refused:missing")).toBe(true);
    expect(ctx.actions.editing).not.toBeNull();
    expect(ctx.onChanged).toHaveBeenCalledWith(day.path);
  });

  it("shows an entry in its note through the shell", async () => {
    const ctx = await setup();
    const entry = entryAt(NOTE, "14:05");
    ctx.actions.capsOf({ path: "2026-09-20.md" }, entry).showInNote!();
    expect(ctx.onShowInNote).toHaveBeenCalledWith({ path: "2026-09-20.md" }, entry);
  });
});

describe("JournalDaySection", () => {
  const actions: JournalActions = { editing: null, setEditing: vi.fn(), capsOf: vi.fn(), toggle: vi.fn(), saveEdit: vi.fn() };

  it("counts the day's entries, leads to all days, and empties its field only when the entry exists", async () => {
    const saved: string[] = [];
    let accept = false;
    const onOpenAll = vi.fn();
    const { host } = await mount(
      <JournalDaySection
        day={dayOf("2026-09-20", NOTE)} todayKey="2026-09-20" actions={actions}
        onCapture={async (text) => { saved.push(text); return accept; }}
        onOpenAll={onOpenAll} onOpenEntry={vi.fn()} onMenu={vi.fn()}
      />,
    );
    expect(host.textContent).toContain(`${en.journal.sectionTitle} · 3`);
    expect(all(host, "journal-open-note")).toHaveLength(0);
    await act(async () => { all(host, "journal-section-all")[0].click(); });
    expect(onOpenAll).toHaveBeenCalledOnce();

    const field = all(host, "journal-section-input")[0] as HTMLInputElement;
    expect(field.placeholder).toBe(en.journal.fieldToday);
    await type(field, "nothing was written");
    await press(field, "Enter");
    await settle();
    // Refused: the typed text stays.
    expect(saved).toEqual(["nothing was written"]);
    expect(field.value).toBe("nothing was written");
    accept = true;
    await press(field, "Enter");
    await settle();
    expect(field.value).toBe("");
  });

  it("names the day its field writes into when that is not today, and shows no list for an empty day", async () => {
    const { host } = await mount(
      <JournalDaySection
        day={dayOf("2026-09-14", "# Monday\n")} todayKey="2026-09-20" actions={actions}
        onCapture={async () => true} onOpenAll={vi.fn()} onOpenEntry={vi.fn()} onMenu={vi.fn()}
      />,
    );
    expect(all(host, "journal-days")).toHaveLength(0);
    expect(host.textContent).toContain(en.journal.sectionTitle);
    expect((all(host, "journal-section-input")[0] as HTMLInputElement).placeholder).toMatch(/Sep 14|14 Sep/);
  });
});

function FeedProbe({ deps, expose }: { deps: JournalFeedDeps; expose: (state: JournalFeedState) => void }) {
  const state = useJournalFeed(deps);
  useEffect(() => { expose(state); });
  return null;
}

describe("useJournalFeed", () => {
  const SETTINGS = { folder: "", format: "YYYY-MM-DD", heading: HEADING };
  const entryNote = (text: string) => `## Journal\n\n- 08:00 ${text}\n`;

  async function setup(seed: Record<string, string>) {
    const vault = memoryFiles(seed);
    let state!: JournalFeedState;
    const seen: number[] = [];
    const deps = (over: Partial<JournalFeedDeps> = {}): JournalFeedDeps => ({
      vaultKey: "vault-a", settings: SETTINGS, version: 0, changedPaths: null,
      listNotePaths: async () => [...vault.data.keys()],
      readTextFile: vault.files.readTextFile,
      ...over,
    });
    const expose = (next: JournalFeedState) => { state = next; seen.push(next.days.length); };
    const { root } = await mount(<FeedProbe deps={deps()} expose={expose} />);
    await settle();
    const rerender = async (over: Partial<JournalFeedDeps>) => {
      await act(async () => { root.render(<FeedProbe deps={deps(over)} expose={expose} />); });
      await settle();
    };
    return { ...vault, seen, rerender, get state() { return state; } };
  }

  it("loads the newest days first and leaves notes that are no daily notes alone", async () => {
    const ctx = await setup({ "2026-09-18.md": entryNote("two days ago"), "2026-09-20.md": entryNote("today"), "Project.md": entryNote("not a day") });
    expect(ctx.state.loading).toBe(false);
    expect(ctx.state.days.map((day) => day.key)).toEqual(["2026-09-20", "2026-09-18"]);
    expect(ctx.reads).not.toContain("Project.md");
    expect(ctx.state.more).toBe(false);
  });

  it("keeps the list while a filter reloads, and replaces it when the answer is there", async () => {
    const ctx = await setup({ "2026-09-19.md": entryNote("plain line"), "2026-09-20.md": "## Journal\n\n- [ ] 08:00 a task\n" });
    expect(ctx.state.days).toHaveLength(2);
    ctx.seen.length = 0;
    await act(async () => { ctx.state.setFilter((f) => ({ ...f, tasksOnly: true })); });
    await settle();
    expect(ctx.state.days.map((day) => day.key)).toEqual(["2026-09-20"]);
    // Never empty in between: every render on the way showed rows.
    expect(ctx.seen.every((count) => count > 0)).toBe(true);
  });

  it("reads only the changed note again", async () => {
    const ctx = await setup({ "2026-09-19.md": entryNote("yesterday"), "2026-09-20.md": entryNote("today") });
    ctx.reads.length = 0;
    ctx.data.set("2026-09-20.md", `${entryNote("today")}- 09:00 and one more\n`);
    await act(async () => { ctx.state.refreshPath("2026-09-20.md"); });
    await settle();
    expect(ctx.reads).toEqual(["2026-09-20.md"]);
    expect(ctx.state.days[0].entries).toHaveLength(2);
    expect(ctx.state.days).toHaveLength(2);
  });

  it("follows the change notice: named paths only, and a note that lost its journal leaves the stream", async () => {
    const ctx = await setup({ "2026-09-19.md": entryNote("yesterday"), "2026-09-20.md": entryNote("today") });
    ctx.reads.length = 0;
    ctx.data.set("2026-09-19.md", "# nothing here any more\n");
    await ctx.rerender({ version: 1, changedPaths: ["2026-09-19.md"] });
    expect(ctx.reads).toEqual(["2026-09-19.md"]);
    expect(ctx.state.days.map((day) => day.key)).toEqual(["2026-09-20"]);
  });

  it("takes a new day in when its note appears", async () => {
    const ctx = await setup({ "2026-09-19.md": entryNote("yesterday") });
    ctx.data.set("2026-09-20.md", entryNote("today"));
    await ctx.rerender({ version: 1, changedPaths: ["2026-09-20.md"] });
    expect(ctx.state.days.map((day) => day.key)).toEqual(["2026-09-20", "2026-09-19"]);
  });

  it("loads older days in windows, and the jump loads as far back as the picked day", async () => {
    const seed: Record<string, string> = {};
    for (let i = 0; i < 40; i++) {
      const date = new Date(2026, 8, 20 - i);
      seed[`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}.md`] = entryNote(`day ${i}`);
    }
    const ctx = await setup(seed);
    expect(ctx.state.days).toHaveLength(14);
    expect(ctx.state.more).toBe(true);
    await act(async () => { ctx.state.loadOlder(); });
    await settle();
    expect(ctx.state.days).toHaveLength(28);
    await act(async () => { await ctx.state.loadThrough("2026-08-12"); });
    await settle();
    expect(ctx.state.days).toHaveLength(40);
    expect(ctx.state.more).toBe(false);
    expect(new Set(ctx.state.days.map((day) => day.key)).size).toBe(40);
  });

  it("marks the days that have entries for the date picker, loaded or not", async () => {
    const ctx = await setup({ "2026-09-19.md": entryNote("yesterday"), "2026-09-20.md": "# no journal\n" });
    const marked = await ctx.state.loadMarkedDays([new Date(2026, 8, 19), new Date(2026, 8, 20), new Date(2026, 8, 21)]);
    expect([...marked]).toEqual(["2026-09-19"]);
  });

  it("empties at once for another vault instead of showing the old one's days", async () => {
    const ctx = await setup({ "2026-09-20.md": entryNote("vault a") });
    expect(ctx.state.days).toHaveLength(1);
    ctx.seen.length = 0;
    ctx.data.clear();
    ctx.data.set("2026-09-10.md", entryNote("vault b"));
    await ctx.rerender({ vaultKey: "vault-b" });
    // The first render for the new vault already shows none of the old rows.
    expect(ctx.seen[0]).toBe(0);
    expect(ctx.state.days.map((day) => day.key)).toEqual(["2026-09-10"]);
  });
});
