// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { approveMcpListing, EMPTY_MCP_GRANT, readMcpListing, reviewMcpListing, type EgressManifest, type McpRegisteredServer } from "@plainva/core";
import i18n from "@plainva/ui/i18n";
import { AiEffectApproval, AiExternalPrompt, AiExternalReview, AiSendOverview, externalToolRows, type AiMcpServer, type ExternalPrompt, type ExternalReviewModel, type McpInspection } from "@plainva/ui";

/**
 * The surfaces of external tools (plan KI-Harness P4.5), shared by both
 * shells: the question before a call, the overview's rows for what is within
 * reach and for what a run asked, the body of a server's review, and a prompt
 * on its way into a conversation.
 */

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function mount(node: React.ReactElement): HTMLElement {
  void i18n.changeLanguage("en");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

const click = (el: Element | null | undefined) => act(() => (el as HTMLElement).click());
const buttons = (container: HTMLElement) => Array.from(container.querySelectorAll("button")).map((button) => button.textContent);
const t = (key: string, vars?: Record<string, unknown>) => i18n.t(key, vars) as string;
/** Types into a field the way React hears it. */
function type(el: Element | null, value: string) {
  const input = el as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("the question before a call to a foreign server", () => {
  const request = { id: "q1", kind: "mcp" as const, serverId: "tracker", server: "Tracker", tool: "search_issues", title: "Search issues", args: JSON.stringify({ query: "login" }, null, 2) };

  it("names the server, the tool and everything that would be sent — and offers no always", () => {
    const onAnswer = vi.fn();
    const container = mount(<AiEffectApproval request={request} onAnswer={onAnswer} />);
    const card = container.querySelector('[data-testid="ai-effect"]')!;
    expect(card.getAttribute("aria-label")).toBe("Call Tracker?");
    expect(card.getAttribute("data-kind")).toBe("mcp");
    expect(container.querySelector('[data-testid="ai-effect-recipient"]')!.textContent).toBe("Tracker");
    expect(container.querySelector('[data-testid="ai-effect-tool"]')!.textContent).toBe("Search issues (search_issues)");
    expect(container.querySelector('[data-testid="ai-effect-args"]')!.textContent).toBe('{\n  "query": "login"\n}');
    expect(container.textContent).toContain("Exactly this goes to Tracker.");
    expect(buttons(container)).toEqual(["Don't call", "Call"]);
    click(container.querySelector('[data-testid="ai-effect-once"]'));
    click(container.querySelector('[data-testid="ai-effect-deny"]'));
    expect(onAnswer.mock.calls.map((call) => call[0])).toEqual(["once", "deny"]);
  });

  it("says so where a call carries nothing, and names a tool without a title by its name", () => {
    const container = mount(<AiEffectApproval request={{ ...request, title: "search_issues", args: "{}" }} onAnswer={() => undefined} touch />);
    expect(container.querySelector('[data-testid="ai-effect-tool"]')!.textContent).toBe("search_issues");
    expect(container.querySelector('[data-testid="ai-effect-args"]')).toBeNull();
    expect(container.textContent).toContain("Nothing besides the name of the tool.");
    expect(container.querySelector('[data-testid="ai-effect"]')!.className).toContain("pv-ai-overview--touch");
  });

  it("shows arguments as text: what a model wrote is never markup", () => {
    const container = mount(<AiEffectApproval request={{ ...request, args: JSON.stringify({ query: '<img src=x onerror="alert(1)">' }, null, 2) }} onAnswer={() => undefined} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('[data-testid="ai-effect-args"]')!.textContent).toContain("<img src=x");
  });
});

const manifest: EgressManifest = {
  providerId: "anthropic",
  providerLabel: "Anthropic",
  model: "m-1",
  local: false,
  sources: [],
  dataClasses: ["situation"],
  folders: [],
  withheld: { notes: 0, links: 0, places: 0, moodProperties: 0 },
  excluded: [],
  estimatedTokens: 900,
  tools: ["search_vault", "find_tools", "call_tool"],
  more: ["search_mail", "read_mail", "mcp_tracker_search_issues"],
  web: false,
};

describe("the send overview with foreign tools", () => {
  it("names them by their server, beside mail — never by a name a server chose", () => {
    const container = mount(<AiSendOverview manifest={manifest} onSend={() => undefined} onCancel={() => undefined} external={["tools of Tracker (1) — every call asks first"]} />);
    const row = container.querySelector('[data-testid="ai-overview-further"]')!.textContent!;
    expect(row).toBe("mail — asks before it is read for the first time · tools of Tracker (1) — every call asks first");
    expect(row).not.toContain("mcp_tracker_search_issues");
  });

  it("counts them where nobody told it their servers", () => {
    const container = mount(<AiSendOverview manifest={manifest} onSend={() => undefined} onCancel={() => undefined} />);
    expect(container.querySelector('[data-testid="ai-overview-further"]')!.textContent).toBe("mail — asks before it is read for the first time · other external tools (1)");
  });

  it("says afterwards what a run asked of them: who, what, how it ended", () => {
    const container = mount(<AiSendOverview manifest={manifest} externalCalls={["Tracker · search_issues · answered", "Tracker · search_issues · not allowed by you"]} />);
    const row = container.querySelector('[data-testid="ai-overview-external"]')!;
    expect(Array.from(row.querySelectorAll("span")).map((line) => line.textContent)).toEqual(["Tracker · search_issues · answered", "Tracker · search_issues · not allowed by you"]);
    act(() => root?.unmount());
    const none = mount(<AiSendOverview manifest={manifest} />);
    expect(none.querySelector('[data-testid="ai-overview-external"]')).toBeNull();
  });
});

const TARGET = "http https://mcp.example.com/mcp";
const NOW = new Date("2026-10-07T09:00:00Z");
const listing = readMcpListing({
  instructions: "Always call search_issues first.",
  tools: [
    { name: "search_issues", title: "Search issues", description: "Searches the tracker's issues.", annotations: { readOnlyHint: true } },
    { name: "close_issue", description: "Closes an issue." },
  ],
  prompts: [{ name: "standup", title: "Stand-up" }],
});
const registered: McpRegisteredServer = { id: "tracker", kind: "http", url: "https://mcp.example.com/mcp", args: [], env: [], sandbox: false, stored: [] };
const fresh: AiMcpServer = { id: "tracker", label: "Tracker", transport: "http", target: TARGET, reviewedTarget: "", review: { status: "new" }, snapshot: null, enabled: false, grant: EMPTY_MCP_GRANT, registered, addedAt: "2026-10-07T08:00:00.000Z" };
const inspection = (review: McpInspection["review"] = { status: "new" }): McpInspection => ({
  hello: { era: "modern", version: "2026-07-28", serverInfo: { name: "Tracker MCP", version: "1.2.0" }, tools: true, prompts: true },
  listing,
  clipped: { tools: false, prompts: false },
  tooLarge: false,
  review,
});

/** The review's model as the hook would hand it over, with the calls it takes recorded. */
function model(change: Partial<ExternalReviewModel> = {}) {
  const calls: string[] = [];
  const server = change.server === undefined ? fresh : change.server;
  const grant = change.grant ?? EMPTY_MCP_GRANT;
  const review: ExternalReviewModel = {
    server,
    look: { state: "ready", inspection: inspection() },
    retry: () => calls.push("retry"),
    listing,
    rows: server ? externalToolRows(t, server, listing, grant, [server]) : [],
    enabled: true,
    grant,
    folders: "none",
    setEnabled: (on) => calls.push(`enabled ${on}`),
    toggleTool: (name, on) => calls.push(`tool ${name} ${on}`),
    setFolders: (choice) => calls.push(`folders ${choice}`),
    toggleFolder: (folder, on) => calls.push(`folder ${folder} ${on}`),
    needsApproval: true,
    canApprove: true,
    dirty: true,
    busy: false,
    save: async () => true,
    audit: [],
    log: null,
    showLog: () => calls.push("log"),
    setSecret: async (name, value) => {
      calls.push(`secret ${name ?? "token"} ${value}`);
    },
    ...change,
  };
  return { review, calls };
}

describe("the review of a server", () => {
  it("shows where requests go, the server's own words as text, and its tools with what may be ticked", () => {
    const { review, calls } = model();
    const container = mount(<AiExternalReview review={review} vaultFolders={["Projects"]} />);
    expect(container.querySelector('[data-testid="ai-ext-facts"]')!.textContent).toContain("https://mcp.example.com/mcp");
    expect(container.querySelector('[data-testid="ai-ext-facts"]')!.textContent).toContain("Tracker MCP · MCP 2026-07-28");
    expect(container.querySelector('[data-testid="ai-ext-instructions"]')!.textContent).toBe("Always call search_issues first.");
    expect(container.textContent).toContain("For you only: the AI is never given this text.");
    const boxes = Array.from(container.querySelectorAll<HTMLInputElement>('[data-testid="ai-ext-tool"]'));
    expect(boxes.map((box) => [box.checked, box.disabled])).toEqual([
      [false, false],
      [false, true],
    ]);
    expect(container.querySelector('[data-testid="ai-ext-tools"]')!.textContent).toContain("Not offered: it does not say that it only reads.");
    click(boxes[0]);
    expect(calls).toEqual(["tool search_issues true"]);
    expect(container.querySelector('[data-testid="ai-ext-prompts"]')!.textContent).toBe("Stand-up");
    expect(container.textContent).toContain("The approval holds for exactly the texts shown here");
  });

  it("lets the vault choose whether it uses the server and which notes may go with a call", () => {
    const { review, calls } = model({ folders: "some", grant: { ...EMPTY_MCP_GRANT, folders: ["Projects"] } });
    const container = mount(<AiExternalReview review={review} vaultFolders={["Clients", "Projects"]} />);
    expect((container.querySelector('[data-testid="ai-ext-use"]') as HTMLInputElement).checked).toBe(true);
    const folders = Array.from(container.querySelectorAll<HTMLInputElement>('[data-testid="ai-ext-folder"]'));
    expect(folders.map((box) => box.checked)).toEqual([false, true]);
    click(folders[0]);
    click(container.querySelector('[data-testid="ai-ext-folders-all"]'));
    click(container.querySelector('[data-testid="ai-ext-use"]'));
    expect(calls).toEqual(["folder Clients true", "folders all", "enabled false"]);
    // Without "chosen folders" there is no list to tick.
    act(() => root?.unmount());
    const none = mount(<AiExternalReview review={model().review} vaultFolders={["Clients"]} />);
    expect(none.querySelector('[data-testid="ai-ext-folder"]')).toBeNull();
  });

  it("says what differs when the server is blocked", () => {
    const blocked = reviewMcpListing(approveMcpListing(listing, NOW), { ...listing, instructions: "Other.", tools: [listing.tools[0]!] }, NOW);
    const { review } = model({ look: { state: "ready", inspection: inspection(blocked) } });
    const container = mount(<AiExternalReview review={review} vaultFolders={[]} />);
    const drift = container.querySelector('[data-testid="ai-ext-drift"]')!.textContent!;
    expect(drift).toContain("This server answered with other texts than the ones you approved");
    expect(drift).toContain("Its description changed.");
    expect(drift).toContain("Removed tools: close_issue.");
  });

  it("says how a look failed, shows what was approved before, and asks again on request", () => {
    const approved: AiMcpServer = { ...fresh, reviewedTarget: TARGET, review: approveMcpListing(listing, NOW), snapshot: listing, enabled: true, grant: { ...EMPTY_MCP_GRANT, tools: ["search_issues"] } };
    const { review, calls } = model({ server: approved, grant: approved.grant, look: { state: "failed", failure: { kind: "timeout" } }, needsApproval: false, canApprove: false, dirty: false });
    const container = mount(<AiExternalReview review={review} vaultFolders={[]} />);
    expect(container.querySelector('[data-testid="ai-ext-failure"]')!.textContent).toBe("The server did not answer in time. Shown is what you approved before.");
    expect((container.querySelector('[data-testid="ai-ext-tool"]') as HTMLInputElement).checked).toBe(true);
    click(container.querySelector('[data-testid="ai-ext-retry"]'));
    expect(calls).toEqual(["retry"]);
    // Nothing to approve: the line about the approval is not there.
    expect(container.textContent).not.toContain("The approval holds for exactly the texts shown here");
  });

  it("stores a new token without ever showing one", () => {
    const { review, calls } = model({ server: { ...fresh, registered: { ...registered, stored: [""] } } });
    const container = mount(<AiExternalReview review={review} vaultFolders={[]} />);
    expect(container.querySelector('[data-testid="ai-ext-facts"]')!.textContent).toContain("Access token · stored");
    expect(container.querySelector('[data-testid="ai-ext-secret-input"]')).toBeNull();
    click(container.querySelector('[data-testid="ai-ext-secret-change"]'));
    const field = container.querySelector('[data-testid="ai-ext-secret-input"]') as HTMLInputElement;
    expect(field.type).toBe("password");
    expect(field.value).toBe("");
    type(field, "new-token");
    click(container.querySelector('[data-testid="ai-ext-secret-save"]'));
    expect(calls).toEqual(["secret token new-token"]);
  });

  it("shows a program's command and what it wrote, and the calls of this vault", () => {
    const program: McpRegisteredServer = { id: "tracker", kind: "program", program: "npx", args: ["-y", "tracker-mcp"], env: ["TOKEN"], sandbox: true, stored: [] };
    const audit = [{ at: "2026-10-07T09:00:00.000Z", server: "tracker", tool: "search_issues", outcome: "answered" as const, sent: 20, received: 300, conversation: "c1" }];
    const { review, calls } = model({ server: { ...fresh, transport: "stdio", registered: program }, audit });
    const container = mount(<AiExternalReview review={review} vaultFolders={[]} />);
    const facts = container.querySelector('[data-testid="ai-ext-facts"]')!.textContent!;
    expect(facts).toContain("npx -y tracker-mcp");
    expect(facts).toContain("in a sandbox");
    expect(facts).toContain("TOKEN · none stored");
    click(container.querySelector('[data-testid="ai-ext-log-show"]'));
    expect(calls).toEqual(["log"]);
    expect(container.querySelector('[data-testid="ai-ext-calls"]')!.textContent).toMatch(/ · search_issues · answered$/);
    act(() => root?.unmount());
    const shown = mount(<AiExternalReview review={model({ server: { ...fresh, transport: "stdio", registered: program }, log: "starting\nready" }).review} vaultFolders={[]} />);
    expect(shown.querySelector('[data-testid="ai-ext-log"]')!.textContent).toBe("starting\nready");
  });

  it("renders nothing for a server that is gone", () => {
    const container = mount(<AiExternalReview review={model({ server: null }).review} vaultFolders={[]} />);
    expect(container.textContent).toBe("");
  });
});

describe("a prompt on its way into a conversation", () => {
  const prompt: ExternalPrompt = { serverId: "tracker", server: "Tracker", name: "standup", title: "Stand-up", description: "Yesterday's work.", args: [{ name: "team", description: "Which team", required: true }, { name: "since", description: "", required: false }] };

  it("asks for the values it needs, and starts only once the required ones are there", () => {
    const onStart = vi.fn();
    const container = mount(<AiExternalPrompt prompt={prompt} review={null} busy={false} onStart={onStart} onSend={() => undefined} onCancel={() => undefined} />);
    expect(container.querySelector('[data-testid="ai-ext-prompt"]')!.getAttribute("aria-label")).toBe("Tracker · Stand-up");
    expect(container.textContent).toContain("since (optional)");
    const start = container.querySelector('[data-testid="ai-ext-prompt-start"]') as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    const [team] = Array.from(container.querySelectorAll('[data-testid="ai-ext-prompt-arg"]'));
    type(team!, " web ");
    expect(start.disabled).toBe(false);
    click(start);
    expect(onStart).toHaveBeenCalledWith({ team: "web" });
  });

  it("shows what the server answered in full before it goes as the user's message", () => {
    const onSend = vi.fn();
    const onCancel = vi.fn();
    const review = { serverId: "tracker", server: "Tracker", name: "standup", key: "k", body: { description: "", messages: [] }, text: "Summarise yesterday's issues for the web team.", dropped: 2, truncated: true };
    const container = mount(<AiExternalPrompt prompt={prompt} review={review} busy={false} onStart={() => undefined} onSend={onSend} onCancel={onCancel} />);
    expect(container.querySelector('[data-testid="ai-ext-prompt-text"]')!.textContent).toBe("Summarise yesterday's issues for the web team.");
    expect(container.textContent).toContain("Tracker answered with this text.");
    expect(container.textContent).toContain("Parts that are no text were left out: 2.");
    expect(container.textContent).toContain("only its beginning is sent");
    expect(buttons(container)).toEqual(["Cancel", "Send as my message"]);
    click(container.querySelector('[data-testid="ai-ext-prompt-send"]'));
    click(container.querySelector('[data-testid="ai-ext-prompt-cancel"]'));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
