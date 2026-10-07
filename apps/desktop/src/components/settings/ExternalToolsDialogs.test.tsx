// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EMPTY_MCP_GRANT, scriptedMcpOAuth, type ScriptedOAuthOptions } from "@plainva/core";
import i18n from "@plainva/ui/i18n";
import type { AiSession } from "@plainva/ui";
import { CONFIRM } from "../../ai/mcpTestHost";
import { TRACKER_URL, close, connect, mcpSession, search, tracker } from "../../ai/mcpSessionHarness";
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
    // Nothing is ticked. The tool that does not say it only reads can be ticked too — and says what a call of it may do there.
    expect(tools.map((box) => [box.checked, box.disabled])).toEqual([
      [false, false],
      [false, false],
    ]);
    expect($("ai-ext-tool-effect")!.textContent).toContain("Can change, overwrite or delete something at Tracker");
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

  it("a tool that may change something is ticked on its own, for what it says it does — and unticking takes that back", async () => {
    const { s } = await mcpSession([]);
    await connect(s);
    const onClose = vi.fn();
    await mount(<Review session={s} onClose={onClose} />);
    await until(() => $("ai-ext-tools") !== null && $("ai-ext-loading") === null);
    const boxes = () => $$<HTMLInputElement>("ai-ext-tool");
    expect(boxes().map((box) => box.checked)).toEqual([true, false]);
    click(boxes()[1]);
    expect(boxes()[1]!.checked).toBe(true);
    click($("ai-ext-save"));
    await until(() => onClose.mock.calls.length === 1);
    // The tick is kept with what it covers: this tool said nothing of itself, so it was ticked for all it may do.
    expect(s.getState().mcp.servers[0]!.grant).toMatchObject({ tools: ["search_issues", "close_issue"], effects: { close_issue: "destroys" } });
    expect(await s.mcp.offeredNames()).toEqual(["mcp_tracker_search_issues", "mcp_tracker_close_issue"]);
    // Unticked again — in the dialog as it stands, which now shows what was stored —, nothing of it stays behind.
    const save = () => $<HTMLButtonElement>("ai-ext-save");
    await until(() => boxes().length === 2 && boxes()[1]!.checked && save()?.disabled === true);
    click(boxes()[1]);
    await until(() => save()?.disabled === false);
    click(save());
    await until(() => onClose.mock.calls.length === 2);
    expect(s.getState().mcp.servers[0]!.grant).toEqual({ ...EMPTY_MCP_GRANT, tools: ["search_issues"] });
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

describe("signing in from the review", () => {
  /** The tracker behind a sign-in: it takes nothing but the token its authorization server handed out. */
  async function behindSignIn(options: Partial<ScriptedOAuthOptions> = {}) {
    const oauth = scriptedMcpOAuth({ serverUrl: TRACKER_URL, dynamic: true, ...options });
    const server = tracker();
    server.accepts = (token) => oauth.accepts(token);
    const t = await mcpSession([], { server, oauth });
    await t.s.mcp.addHttp("Tracker", TRACKER_URL, "", CONFIRM);
    return { ...t, oauth };
  }

  it("signs in in the browser when the server refused the look, shows what it lists afterwards — and never a credential", async () => {
    const { s, oauth } = await behindSignIn();
    await mount(<Review session={s} onClose={() => undefined} />);
    await until(() => $("ai-ext-failure") !== null);
    expect($("ai-ext-failure")!.textContent).toBe("The server asks for a sign-in.");
    expect($("ai-ext-signin-status")!.textContent).toBe("Not signed in");
    expect($("ai-ext-tools")).toBeNull();

    click($("ai-ext-signin"));
    await until(() => $("ai-ext-tools") !== null && $("ai-ext-loading") === null);
    expect($("ai-ext-failure")).toBeNull();
    expect($("ai-ext-signin-status")!.textContent).toBe("Signed in at auth.example.com");
    expect(oauth.opened).toHaveLength(1);
    expect($$<HTMLInputElement>("ai-ext-tool")).toHaveLength(2);
    // Nothing a token is or could be had with is anywhere in the page.
    for (const secret of [oauth.bearer("tracker")!, "rt-1", oauth.tokenRequests[0]!.code_verifier!]) expect(document.body.innerHTML).not.toContain(secret);

    click($("ai-ext-signout"));
    await until(() => $("ai-ext-failure") !== null);
    expect($("ai-ext-signin-status")!.textContent).toBe("Not signed in");
    expect(oauth.bearer("tracker")).toBeUndefined();
  });

  it("asks for a client id where the authorization server offers no other way, and says why a sign-in did not happen", async () => {
    const { s, oauth } = await behindSignIn({ dynamic: false, clients: ["plainva-at-acme"] });
    await mount(<Review session={s} onClose={() => undefined} />);
    await until(() => $("ai-ext-signin") !== null && $("ai-ext-failure") !== null);
    click($("ai-ext-signin"));
    await until(() => $("ai-ext-signin-client") !== null);
    expect(document.body.textContent).toContain("auth.example.com does not let apps register themselves.");
    expect(oauth.opened).toEqual([]);
    expect($<HTMLButtonElement>("ai-ext-signin-continue")!.disabled).toBe(true);

    // The user says no in the browser: nothing is kept, and the review says what happened.
    oauth.consent = "deny";
    type($("ai-ext-signin-client"), "plainva-at-acme");
    click($("ai-ext-signin-continue"));
    await until(() => $("ai-ext-signin-problem") !== null);
    expect($("ai-ext-signin-problem")!.textContent).toBe("The sign-in was declined in the browser.");
    expect(new URL(oauth.opened[0]!).searchParams.get("client_id")).toBe("plainva-at-acme");
    expect(await s.mcp.signInStatus("tracker")).toBeNull();

    oauth.consent = "allow";
    click($("ai-ext-signin"));
    await until(() => $("ai-ext-signin-client") !== null);
    type($("ai-ext-signin-client"), "plainva-at-acme");
    click($("ai-ext-signin-continue"));
    await until(() => $("ai-ext-tools") !== null && $("ai-ext-loading") === null);
    expect($("ai-ext-signin-status")!.textContent).toBe("Signed in at auth.example.com");
    expect($("ai-ext-signin-problem")).toBeNull();
  });

  it("stops waiting when the user says so, and when the review is closed", async () => {
    const { s, oauth } = await behindSignIn();
    oauth.consent = "never";
    await mount(<Review session={s} onClose={() => undefined} />);
    await until(() => $("ai-ext-signin") !== null && $("ai-ext-failure") !== null);
    click($("ai-ext-signin"));
    await until(() => $("ai-ext-signin-waiting") !== null);
    expect($("ai-ext-signin-waiting")!.textContent).toBe("Finish the sign-in in your browser, at auth.example.com. Plainva waits here.");
    click($("ai-ext-signin-cancel"));
    await until(() => $("ai-ext-signin") !== null);
    // Stopping is the user's own doing: nothing is reported as a problem.
    expect($("ai-ext-signin-problem")).toBeNull();
    const state = new URL(oauth.opened[0]!).searchParams.get("state")!;
    expect(await s.mcp.finishSignIn({ state, code: "late" })).toBeNull();

    await until(() => $("ai-ext-failure") !== null && $("ai-ext-signin") !== null);
    click($("ai-ext-signin"));
    await until(() => $("ai-ext-signin-waiting") !== null);
    act(() => root?.unmount());
    root = null;
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(await s.mcp.finishSignIn({ state: new URL(oauth.opened[1]!).searchParams.get("state")!, code: "late" })).toBeNull();
  });
});
