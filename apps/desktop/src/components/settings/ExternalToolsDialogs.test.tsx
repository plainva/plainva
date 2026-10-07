// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EMPTY_MCP_GRANT } from "@plainva/core";
import i18n from "@plainva/ui/i18n";
import type { AiSession } from "@plainva/ui";
import { CONFIRM } from "../../ai/mcpTestHost";
import { TRACKER_URL, close, connect, mcpSession, search } from "../../ai/mcpSessionHarness";
import { ExternalAddDialog, ExternalReviewDialog } from "./ExternalToolsDialogs";

/**
 * The two dialogs of external tools with the real session behind them (plan
 * KI-Harness P4.5): what the user does in them is what ends up registered,
 * approved and granted — no more. The server at the other end is the scripted
 * one; the native dialog is its `confirm`.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The vault's services keep their identity between renders, as the real context's do.
const { appConfirm, vaultContext } = vi.hoisted(() => ({
  appConfirm: vi.fn(async (_options: { title: string }) => true),
  vaultContext: { queryService: { getAllFolders: async () => ["Projects", "Projects/2026", ".agent/skills", "Clients"] } },
}));
vi.mock("../../contexts/VaultContext", () => ({ useVault: () => vaultContext }));
vi.mock("../../services/appDialogs", () => ({ appConfirm }));

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  appConfirm.mockClear();
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
/** Lets what is on its way arrive — a request to the scripted server, a file of the store — until `done` holds. */
async function until(done: () => boolean): Promise<void> {
  for (let round = 0; round < 200 && !done(); round++) await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  if (!done()) throw new Error("what was waited for did not happen");
}
function type(el: Element | null, value: string) {
  const field = el as HTMLInputElement | HTMLTextAreaElement;
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  act(() => {
    setter.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** The review as the card opens it: with the servers of the session's state. */
function Review({ session, onClose }: { session: AiSession; onClose: () => void }) {
  const state = useSyncExternalStore(session.subscribe, session.getState);
  return <ExternalReviewDialog session={session} servers={state.mcp.servers} serverId="tracker" onClose={onClose} />;
}

describe("adding a server", () => {
  it("takes a name and an address, says what is wrong with an address, and adds only what the system's dialog confirmed", async () => {
    const { s, native } = await mcpSession([]);
    const onAdded = vi.fn();
    await mount(<ExternalAddDialog session={s} programs={false} onClose={() => undefined} onAdded={onAdded} />);
    const submit = $<HTMLButtonElement>("ai-ext-add-submit")!;
    expect(submit.disabled).toBe(true);
    // A phone, or a desktop without programs: a server is an address, and nothing else is asked.
    expect($("ai-ext-add-kind-program")).toBeNull();
    type($("ai-ext-add-name"), "Tracker");
    type($("ai-ext-add-url"), "http://mcp.example.com/mcp");
    expect(document.body.textContent).toContain("Only https:// is allowed");
    expect(submit.disabled).toBe(true);
    type($("ai-ext-add-url"), TRACKER_URL);
    type($("ai-ext-add-token"), "s3cret");
    expect(submit.disabled).toBe(false);

    // The user says no in the system's dialog: nothing is remembered, and nothing is said about it.
    native.confirm = false;
    click(submit);
    await until(() => native.shown.length === 1);
    await until(() => !submit.disabled);
    expect(onAdded).not.toHaveBeenCalled();
    expect(native.registry).toEqual([]);
    expect(native.secrets.size).toBe(0);
    expect(document.querySelector(".pv-banner")).toBeNull();

    native.confirm = true;
    click(submit);
    await until(() => onAdded.mock.calls.length === 1);
    expect(onAdded).toHaveBeenCalledWith("tracker");
    expect(native.shown[1]).toMatchObject({ id: "tracker", target: TRACKER_URL, text: { title: "Add an external server" } });
    expect(native.secrets.get("tracker")).toBe("s3cret");
    expect(s.getState().mcp.servers).toMatchObject([{ id: "tracker", label: "Tracker", review: { status: "new" }, enabled: false }]);
  });

  it("asks for a command where the shell starts programs, and points at one that starts a shell", async () => {
    const { s } = await mcpSession([]);
    await mount(<ExternalAddDialog session={s} programs onClose={() => undefined} onAdded={() => undefined} />);
    click($("ai-ext-add-kind-program"));
    expect($("ai-ext-add-url")).toBeNull();
    type($("ai-ext-add-name"), "Local");
    type($("ai-ext-add-program"), "bash");
    expect(document.body.textContent).toContain("This command starts a shell or fetches something first.");
    type($("ai-ext-add-program"), "npx");
    expect(document.body.textContent).not.toContain("This command starts a shell");
    type($("ai-ext-add-env"), "PATH=/tmp");
    expect(document.body.textContent).toContain("“PATH” cannot be used as a name.");
    expect($<HTMLButtonElement>("ai-ext-add-submit")!.disabled).toBe(true);
    type($("ai-ext-add-env"), "TOKEN=abc");
    expect($<HTMLButtonElement>("ai-ext-add-submit")!.disabled).toBe(false);
    // No sandbox on this computer: the box cannot be ticked, and the form says what that means.
    await until(() => document.body.textContent!.includes("This computer has no sandbox Plainva can use"));
    expect($<HTMLInputElement>("ai-ext-add-sandbox")!.disabled).toBe(true);
    expect($<HTMLInputElement>("ai-ext-add-sandbox")!.checked).toBe(false);
  });
});

describe("the review", () => {
  it("of a new server: nothing is ticked, and Approve stores the approval with exactly the vault's choices", async () => {
    const { s } = await mcpSession([]);
    await s.mcp.addHttp("Tracker", TRACKER_URL, "", CONFIRM);
    const onClose = vi.fn();
    await mount(<Review session={s} onClose={onClose} />);
    expect($("ai-ext-loading")).not.toBeNull();
    await until(() => $("ai-ext-tools") !== null && $("ai-ext-loading") === null);
    expect($("ai-ext-review")!.textContent).toContain("Not reviewed yet");
    const tools = $$<HTMLInputElement>("ai-ext-tool");
    expect(tools.map((box) => [box.checked, box.disabled])).toEqual([
      [false, false],
      [false, true],
    ]);
    // A server that was just added is proposed for the vault it was added from.
    expect($<HTMLInputElement>("ai-ext-use")!.checked).toBe(true);
    click(tools[0]);
    click($("ai-ext-folders-some"));
    await until(() => $$("ai-ext-folder").length === 2);
    // The vault's top level, without what is hidden.
    expect($$("ai-ext-folder").map((box) => box.parentElement!.textContent)).toEqual(["Clients", "Projects"]);
    click($$("ai-ext-folder")[1]);
    expect($("ai-ext-save")).toBeNull();
    click($("ai-ext-approve"));
    await until(() => onClose.mock.calls.length === 1);
    expect(s.getState().mcp.servers[0]).toMatchObject({ review: { status: "approved" }, enabled: true, grant: { ...EMPTY_MCP_GRANT, tools: ["search_issues"], folders: ["Projects"] } });
    expect(await s.mcp.offeredNames()).toEqual(["mcp_tracker_search_issues"]);
  });

  it("of an approved server: the button stores this vault's choices, and there is nothing to approve", async () => {
    const { s } = await mcpSession([]);
    await connect(s);
    const onClose = vi.fn();
    await mount(<Review session={s} onClose={onClose} />);
    await until(() => $("ai-ext-tools") !== null && $("ai-ext-loading") === null);
    expect($("ai-ext-approve")).toBeNull();
    const save = $<HTMLButtonElement>("ai-ext-save")!;
    expect(save.disabled).toBe(true);
    expect($$<HTMLInputElement>("ai-ext-tool")[0]!.checked).toBe(true);
    click($$("ai-ext-tool")[0]);
    click($("ai-ext-folders-all"));
    expect(save.disabled).toBe(false);
    click(save);
    await until(() => onClose.mock.calls.length === 1);
    expect(s.getState().mcp.servers[0]).toMatchObject({ review: { status: "approved" }, enabled: true, grant: { tools: [], folders: [""] } });
    expect(await s.mcp.offeredNames()).toEqual([]);
  });

  it("of a server that changed: says what differs, and approving it again grants nothing that is new", async () => {
    const { s, server } = await mcpSession([]);
    await connect(s);
    server.tools = [search, close, { name: "export_all", description: "Exports everything.", annotations: { readOnlyHint: true } }];
    const onClose = vi.fn();
    await mount(<Review session={s} onClose={onClose} />);
    // The look itself is what finds the change: once it is back, the review shows what the server lists now.
    await until(() => $("ai-ext-drift") !== null && $("ai-ext-loading") === null);
    expect($("ai-ext-drift")!.textContent).toContain("New tools: export_all.");
    expect($("ai-ext-review")!.textContent).toContain("Blocked: its texts changed");
    // Looking at it blocked it: nothing of it is offered until the user approved what is there now.
    expect(await s.mcp.offeredNames()).toEqual([]);
    expect($$<HTMLInputElement>("ai-ext-tool").map((box) => box.checked)).toEqual([true, false, false]);
    click($("ai-ext-approve"));
    await until(() => onClose.mock.calls.length === 1);
    expect(s.getState().mcp.servers[0]).toMatchObject({ review: { status: "approved" }, grant: { tools: ["search_issues"] } });
    expect(await s.mcp.offeredNames()).toEqual(["mcp_tracker_search_issues"]);
  });

  it("removes a server only after a yes, for every vault", async () => {
    const { s, native } = await mcpSession([]);
    await connect(s);
    const onClose = vi.fn();
    await mount(<Review session={s} onClose={onClose} />);
    await until(() => $("ai-ext-tools") !== null && $("ai-ext-loading") === null);
    appConfirm.mockResolvedValueOnce(false);
    click($("ai-ext-remove"));
    await until(() => appConfirm.mock.calls.length === 1);
    expect(appConfirm.mock.calls[0]![0]).toMatchObject({ title: "Remove Tracker?" });
    expect(native.registry).toHaveLength(1);
    click($("ai-ext-remove"));
    await until(() => onClose.mock.calls.length === 1);
    expect(native.registry).toEqual([]);
    expect(s.getState().mcp.servers).toEqual([]);
  });
});
