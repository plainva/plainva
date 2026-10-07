// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "@plainva/ui/i18n";
import type { AiSession, PlanQuestion } from "@plainva/ui";

/**
 * The three surfaces of Plainva's MCP server, stage 2 (plan KI-Harness
 * §17.3, P5-5): the pairing dialog's second answer, the dialog about a plan of
 * an app, and the switch per app in the settings. What the user does in them
 * is what reaches the native side — no more.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { invoke, events, vaultContext, appConfirm } = vi.hoisted(() => ({
  invoke: vi.fn(async (_command: string, _args?: unknown): Promise<unknown> => undefined),
  events: { handlers: new Map<string, (event: { payload: unknown }) => void>() },
  // The vault's services keep their identity between renders, as the real context's do.
  vaultContext: { queryService: { getAllFolders: async () => ["Projects", "Projects/2026", "Clients", ".plainva"] } },
  appConfirm: vi.fn(async () => true),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
    events.handlers.set(name, handler);
    return () => undefined;
  }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn(async () => null) }));
vi.mock("../../contexts/VaultContext", () => ({ useVault: () => vaultContext }));
vi.mock("../../services/appDialogs", () => ({ appConfirm }));

const { McpPairing } = await import("./McpPairing");
const { McpPlanDialog } = await import("./McpPlanDialog");
const { McpSettingsCard } = await import("../settings/McpSettingsCard");
const { mcpPlans } = await import("../../services/ai/mcpPlans");

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  mcpPlans.clear();
  invoke.mockReset();
  invoke.mockImplementation(async () => undefined);
  events.handlers.clear();
});

async function mount(node: React.ReactElement): Promise<void> {
  await i18n.changeLanguage("en");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
}

const $ = <T extends HTMLElement = HTMLElement>(testId: string) => document.querySelector<T>(`[data-testid="${testId}"]`);
const $$ = <T extends HTMLElement = HTMLElement>(testId: string) => Array.from(document.querySelectorAll<T>(`[data-testid="${testId}"]`));
const click = (el: Element | null | undefined) => act(() => (el as HTMLElement).click());
async function until(done: () => boolean): Promise<void> {
  for (let round = 0; round < 200 && !done(); round++) await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  if (!done()) throw new Error("what was waited for did not happen");
}
/** A checkbox of the dialog by the words beside it. */
const box = (label: string) =>
  Array.from(document.querySelectorAll<HTMLLabelElement>("label.pv-checkrow"))
    .find((row) => row.textContent === label)
    ?.querySelector<HTMLInputElement>("input") ?? null;
const calls = (command: string) => invoke.mock.calls.filter(([name]) => name === command).map(([, args]) => args);

describe("the pairing dialog", () => {
  async function asked(requestId: string) {
    await until(() => events.handlers.has("mcp-pair"));
    act(() => events.handlers.get("mcp-pair")!({ payload: { requestId, client: "Claude Code", version: "2", program: "claude.exe", known: false } }));
    await until(() => box("Projects") !== null);
  }

  it("reading is no leave to write: the second answer is off until it is ticked", async () => {
    await mount(<McpPairing />);
    await asked("pair-1");
    expect($("mcp-pairing")!.textContent).toContain("Claude Code wants to read your vault");
    // The dialog says what the tick would mean, before it is set.
    expect($("mcp-pairing")!.textContent).toContain("becomes a suggestion on the note or a draft");
    expect($<HTMLInputElement>("mcp-pair-writes")!.checked).toBe(false);
    click(box("Projects"));
    click($("mcp-pair-allow"));
    expect(calls("mcp_pair_answer")).toEqual([{ requestId: "pair-1", allow: true, folders: ["Projects"], writes: false }]);
    expect($("mcp-pairing")).toBeNull();
  });

  it("ticked, the app may propose changes in the folders it reads — and a refusal grants neither", async () => {
    await mount(<McpPairing />);
    await asked("pair-2");
    click(box("Projects"));
    click($("mcp-pair-writes"));
    click($("mcp-pair-allow"));
    expect(calls("mcp_pair_answer")).toEqual([{ requestId: "pair-2", allow: true, folders: ["Projects"], writes: true }]);

    // The next question starts with nothing ticked, whatever the last one was answered with.
    await asked("pair-3");
    expect($<HTMLInputElement>("mcp-pair-writes")!.checked).toBe(false);
    click(box("Projects"));
    click($("mcp-pair-writes"));
    const deny = Array.from($("mcp-pairing")!.querySelectorAll("button")).find((button) => button.textContent === "Deny");
    click(deny);
    expect(calls("mcp_pair_answer")[1]).toEqual({ requestId: "pair-3", allow: false, folders: [], writes: false });
  });
});

describe("the dialog about a plan of an app", () => {
  const owner = {};
  const rename: PlanQuestion = {
    plan: "rename",
    path: "Projects/Offer.md",
    title: "Offer 2027",
    target: "Projects/Offer 2027.md",
    links: 3,
    files: [
      { path: "Archive/Old.md", links: 2 },
      { path: "Projects/Brief.md", links: 1 },
    ],
  };
  const open = (question: PlanQuestion, clientId = "c1") => {
    let handle = "";
    act(() => {
      handle = mcpPlans.open({ clientId, client: "Claude Code", tool: `${question.plan}_note`, args: "{}", question: question as Exclude<PlanQuestion, { plan: "rule" }>, owner });
    });
    return handle;
  };

  it("names the app, shows what would happen in the rows of the assistant's own card, and a yes carries nothing out yet", async () => {
    await mount(<McpPlanDialog />);
    expect($("mcp-plan")).toBeNull();
    const handle = open(rename);
    await until(() => $("mcp-plan") !== null);
    expect($("mcp-plan")!.getAttribute("aria-label")).toBe("Claude Code wants to rename a note");
    expect($("ai-effect-note")!.textContent).toBe("Offer · Projects");
    expect($("ai-effect-target")!.textContent).toBe("Offer 2027");
    expect($("ai-effect-links")!.textContent).toBe("3 links in 2 notes — they follow the new name");
    // Who links here is for the user's eyes — also a note outside the folders the app reads.
    expect($("ai-effect-files")!.textContent).toContain("Archive/Old");
    expect($("mcp-plan-hint")!.textContent).toBe(
      "Plainva renames the note and updates the links — as when you rename by hand. It is carried out once Claude Code continues after your yes; the app only learns whether it happened.",
    );
    expect($("mcp-plan-allow")!.className).toContain("primary");
    click($("mcp-plan-allow"));
    expect($("mcp-plan")).toBeNull();
    expect(mcpPlans.find(handle, "c1", owner)!.decision).toBe("yes");
  });

  it("a deletion is no step it makes look like the obvious one, and closing the dialog is a no", async () => {
    await mount(<McpPlanDialog />);
    const handle = open({ plan: "delete", path: "Projects/Offer.md" });
    await until(() => $("mcp-plan") !== null);
    expect($("mcp-plan")!.getAttribute("aria-label")).toBe("Claude Code wants to delete a note");
    expect($("mcp-plan-hint")!.textContent).toContain("Your yes deletes nothing yet");
    expect($("mcp-plan-allow")!.className).not.toContain("primary");
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect($("mcp-plan")).toBeNull();
    expect(mcpPlans.find(handle, "c1", owner)!.decision).toBe("no");
  });

  it("asks about one plan at a time: the next one shows when this one is answered, and a vault that closes takes them along", async () => {
    await mount(<McpPlanDialog />);
    const first = open(rename, "c1");
    const second = open({ plan: "move", path: "Projects/Offer.md", folder: "Projects/2026", target: "Projects/2026/Offer.md", loosens: ["cloud"] }, "c2");
    await until(() => $("mcp-plan") !== null);
    expect($("mcp-plan")!.getAttribute("aria-label")).toBe("Claude Code wants to rename a note");
    click($("mcp-plan-deny"));
    expect(mcpPlans.find(first, "c1", owner)!.decision).toBe("no");
    expect($("mcp-plan")!.getAttribute("aria-label")).toBe("Claude Code wants to move a note");
    // A move out from under a folder's rule says so before the yes.
    expect($("ai-effect-loosens")!.textContent).toContain("never to the cloud");
    act(() => mcpPlans.clear());
    expect($("mcp-plan")).toBeNull();
    expect(mcpPlans.find(second, "c2", owner)).toBeNull();
  });
});

describe("the apps in the settings", () => {
  const audit = [
    { at: "1759830060", clientId: "c1", client: "Claude Code", tool: "rename_note", ok: false, notes: 0, note: "asked" },
    { at: "1759830050", clientId: "c1", client: "Claude Code", tool: "delete_note", ok: false, notes: 0, note: "declined" },
    { at: "1759830040", clientId: "c1", client: "Claude Code", tool: "propose_edit", ok: false, notes: 0 },
    { at: "1759830030", clientId: "c1", client: "Claude Code", tool: "read_note", ok: true, notes: 1 },
  ];
  const status = (writes: boolean) => ({
    running: true,
    helperPath: "C:/Program Files/Plainva/plainva-mcp.exe",
    identifier: "com.plainva.desktop",
    clients: [
      { id: "c1", name: "Claude Code", program: "claude.exe", createdAt: "1", lastSeen: "1759830000", folders: ["Projects"], writes },
      // Paired on this computer, but not for the vault that is open: nothing to switch.
      { id: "c2", name: "Cursor", program: "cursor.exe", createdAt: "1", lastSeen: "0", folders: [], writes: false },
    ],
    audit,
  });
  const session = { updateSettings: vi.fn(async () => undefined) } as unknown as AiSession;

  it("proposing changes is its own switch per app, off until the user sets it", async () => {
    let allowed = false;
    invoke.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "mcp_status") return status(allowed);
      if (command === "mcp_set_writes") allowed = (args as { allowed: boolean }).allowed;
      return undefined;
    });
    await mount(<McpSettingsCard session={session} enabled />);
    await until(() => $("mcp-writes-switch") !== null);
    const switches = $$("mcp-writes-switch");
    expect(switches).toHaveLength(1);
    expect(switches[0]!.getAttribute("aria-label")).toBe("Claude Code may suggest changes");
    expect(switches[0]!.getAttribute("aria-checked")).toBe("false");
    expect(host!.textContent).toContain("Off: this app only reads.");

    click(switches[0]);
    expect(calls("mcp_set_writes")).toEqual([{ clientId: "c1", allowed: true }]);
    await until(() => $("mcp-writes-switch")!.getAttribute("aria-checked") === "true");
    expect(host!.textContent).toContain("What it writes becomes a suggestion on the note or a draft, with “Claude Code” as the author.");
    expect(host!.textContent).not.toContain("Off: this app only reads.");

    click($("mcp-writes-switch"));
    expect(calls("mcp_set_writes")[1]).toEqual({ clientId: "c1", allowed: false });
    await until(() => $("mcp-writes-switch")!.getAttribute("aria-checked") === "false");
  });

  it("the record says what became of a request: a plan that asked, a no, a refusal — never a path or a text", async () => {
    invoke.mockImplementation(async (command: string) => (command === "mcp_status" ? status(true) : undefined));
    await mount(<McpSettingsCard session={session} enabled />);
    await until(() => document.querySelector(".pv-mcp-audit") !== null);
    const lines = Array.from(document.querySelectorAll(".pv-mcp-audit li")).map((line) => line.textContent ?? "");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/Claude Code · .+ · asked$/);
    expect(lines[1]).toMatch(/Claude Code · .+ · declined$/);
    expect(lines[2]).toMatch(/Claude Code · Suggesting changes to a note · refused$/);
    expect(lines[3]).toMatch(/Claude Code · .+$/);
    expect(lines[3]).not.toMatch(/asked|declined|refused/);
  });
});
