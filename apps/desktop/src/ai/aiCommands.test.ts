// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  AI_COMMANDS,
  AI_WITHHELD_COMMANDS,
  aiNavigationCommands,
  buildAppCommands,
  commandInventory,
  consumeGraphTrail,
  consumePendingAnchorJump,
  consumePendingCalendarDay,
  type AiNavigationShell,
  type CommandDeps,
} from "@plainva/ui";

/**
 * What the assistant can do in the app (plan KI-Harness P4-4, ADR 0019):
 * `run_command` runs commands of the ONE registry both palettes are built
 * from, and of those only the ones that show or arrange something. This
 * guard holds the two lists in `aiCommands.ts` against the registry — a
 * command added there is decided here, or the commit fails.
 */

const inventory = commandInventory();

/** Every dep the registry reads, each a spy; the gates answer so that every command is available. */
function deps(overrides: Partial<CommandDeps> = {}): CommandDeps {
  return {
    ...(Object.fromEntries(inventory.deps.map((k) => [k, vi.fn()])) as CommandDeps),
    activePath: () => "Notes/A.md",
    hasActiveNote: () => true,
    themeTogglePinned: () => false,
    ...overrides,
  };
}

function shell(d: CommandDeps, over: Partial<AiNavigationShell> = {}): AiNavigationShell & { opened: string[] } {
  const opened: string[] = [];
  return {
    opened,
    commands: () => buildAppCommands(d),
    openNote: (path) => void opened.push(path),
    resolveNote: async (target) => (target === "Projects/Offer.md" || target === "Offer" ? "Projects/Offer.md" : null),
    neighbors: async () => [{ path: "Projects/Client.md" }, { path: "Projects/Offer.md" }, { path: "Notes/Meeting.md" }],
    ...over,
  };
}

describe("the assistant's app commands", () => {
  it("decides every command of the registry: its to run, or withheld with a reason", () => {
    const ids = inventory.commands.map((c) => c.id);
    const offered = Object.keys(AI_COMMANDS);
    const withheld = Object.keys(AI_WITHHELD_COMMANDS);
    expect(ids.filter((id) => !offered.includes(id) && !withheld.includes(id)), "in the registry, decided nowhere in aiCommands.ts").toEqual([]);
    expect(offered.filter((id) => withheld.includes(id)), "both offered and withheld").toEqual([]);
    expect([...offered, ...withheld].filter((id) => !ids.includes(id)), "decided in aiCommands.ts, gone from the registry").toEqual([]);
  });

  it("offers nothing that creates, and only what shows or arranges", () => {
    const byId = new Map(inventory.commands.map((c) => [c.id, c]));
    for (const id of Object.keys(AI_COMMANDS)) {
      // The create group IS the "New …" catalog: none of it is navigation.
      expect(byId.get(id)?.group, id).not.toBe("create");
      expect(byId.get(id)?.group, id).not.toBe("vault");
    }
    for (const id of ["new-note", "daily-note", "rename-active", "export-markdown", "mail-draft", "mail-mailto", "print", "backup-now", "refresh-vault", "rebuild-index", "switch-vault", "toggle-theme", "close-tab", "ask-ai"]) {
      expect(AI_COMMANDS[id], `${id} must not be the assistant's`).toBeUndefined();
      expect(AI_WITHHELD_COMMANDS[id], id).toBeDefined();
    }
    for (const label of Object.values(AI_COMMANDS)) {
      expect(label.length).toBeLessThanOrEqual(120);
      expect(label).toMatch(/^(Open|Show|Split|Switch|Reopen) /);
    }
  });

  it("builds its list from the shell's palette: what the shell has, and of that only what is the assistant's", async () => {
    const d = deps();
    const all = aiNavigationCommands(shell(d));
    const ids = all.map((c) => c.id);
    expect(ids).toEqual([...inventory.commands.map((c) => c.id).filter((id) => id in AI_COMMANDS), "open-note", "show-in-graph"]);
    // A skill is a command of the palette, never one of the assistant's: it would start a conversation.
    const withSkill = aiNavigationCommands(
      shell(deps({ aiSkills: [{ id: "plainva:weekly-review", commandId: "ai-skill-weekly-review", title: "Weekly review", description: "", icon: (() => null) as never, start: "", origin: "plainva" } as never], runAiSkill: vi.fn() })),
    );
    expect(withSkill.map((c) => c.id).filter((id) => id.startsWith("ai-skill"))).toEqual([]);

    // A shell without sidebars, panes and a comment list — the phone — does not offer them.
    const phone = aiNavigationCommands(shell(deps({ toggleLeftSidebar: undefined, toggleRightSidebar: undefined, split: undefined, openComments: undefined, openGraph: undefined })));
    const phoneIds = phone.map((c) => c.id);
    for (const id of ["toggle-left-sidebar", "toggle-right-sidebar", "split-vertical", "split-horizontal", "open-comments", "open-graph", "show-in-graph"]) expect(phoneIds, id).not.toContain(id);
    expect(phoneIds).toContain("open-tasks");

    // It runs the palette's handler, and says so; a command that is not available now says that instead.
    expect(await all.find((c) => c.id === "open-tasks")!.run()).toBe(true);
    expect(d.openTasks).toHaveBeenCalledOnce();
    const noNote = deps({ hasActiveNote: () => false });
    const toggle = aiNavigationCommands(shell(noNote)).find((c) => c.id === "toggle-read-edit")!;
    expect(await toggle.run()).toBe(false);
    expect(noNote.toggleReadEdit).not.toHaveBeenCalled();
  });

  it("opens a note that exists, at a heading where one is named", async () => {
    const s = shell(deps());
    const open = aiNavigationCommands(s).find((c) => c.id === "open-note")!;
    expect(await open.run({ path: "Offer", section: "Costs > 2026" })).toBe(true);
    expect(s.opened).toEqual(["Projects/Offer.md"]);
    // The section handle's last heading is where the editor goes.
    expect(consumePendingAnchorJump("Projects/Offer.md")).toBe("#2026");
    expect(await open.run({ path: "Projects/Offer.md" })).toBe(true);
    expect(consumePendingAnchorJump("Projects/Offer.md")).toBeNull();
    // Nothing that does not exist: an unknown path would make a new tab of it.
    expect(await open.run({ path: "Nowhere.md" })).toBe(false);
    expect(await open.run()).toBe(false);
    expect(s.opened).toHaveLength(2);
  });

  it("shows a note in the graph with what it is linked with", async () => {
    const show = aiNavigationCommands(shell(deps())).find((c) => c.id === "show-in-graph")!;
    expect(await show.run({ path: "Projects/Offer.md" })).toBe(true);
    expect(consumeGraphTrail()).toEqual({ seed: "Projects/Offer.md", paths: ["Projects/Offer.md", "Projects/Client.md", "Notes/Meeting.md"] });
    expect(await show.run({ path: "Nowhere.md" })).toBe(false);
    expect(consumeGraphTrail()).toBeNull();
    // A shell without an index still shows the note itself.
    const alone = aiNavigationCommands(shell(deps(), { neighbors: undefined })).find((c) => c.id === "show-in-graph")!;
    expect(await alone.run({ path: "Offer" })).toBe(true);
    expect(consumeGraphTrail()).toEqual({ seed: "Projects/Offer.md", paths: ["Projects/Offer.md"] });
  });

  it("turns the calendar to a day: parked before the calendar opens", async () => {
    const d = deps();
    const order: string[] = [];
    d.openCalendar = vi.fn(() => void order.push(`open with ${consumePendingCalendarDay() ?? "nothing"}`));
    const calendar = aiNavigationCommands(shell(d)).find((c) => c.id === "open-calendar")!;
    expect(await calendar.run({ date: "2026-10-12" })).toBe(true);
    expect(order).toEqual(["open with 2026-10-12"]);
    // What is no day is no day: the calendar opens where it stands.
    expect(await calendar.run({ date: "next monday" })).toBe(true);
    expect(await calendar.run()).toBe(true);
    expect(order).toEqual(["open with 2026-10-12", "open with nothing", "open with nothing"]);
  });

  it("is what both shells hand to the assistant: no list of their own", () => {
    // Vitest runs with the app's folder as its working directory, in every environment.
    const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
    const desktop = read("src/components/ai/useDesktopAi.ts");
    const phone = read("../mobile/src/services/ai/mobileAi.ts");
    for (const [name, source] of [["desktop", desktop], ["phone", phone]] as const) {
      expect(source, name).toContain("aiNavigationCommands(");
      // The hand-built lists this replaced named their commands in the shell.
      expect(source, name).not.toMatch(/"open-(tasks|graph|journal|mail|comments)"\s*,\s*"/);
    }
    expect(read("src/AppShell.tsx")).toContain("<AiCommandSourceLink sourceRef={ai.commandSourceRef} build={paletteCommands} />");
    // The phone's shell names the palette's commands once, for the assistant's place in it, which hands them on.
    expect(read("../mobile/src/App.tsx")).toMatch(/<MobileAiShell ai=\{ai\} nav=\{\{.*\bcommands \}\} /);
    expect(read("../mobile/src/components/MobileAiShell.tsx")).toContain("<MobileAiNavigation navRef={ai.navRef} nav={nav} />");
  });
});
