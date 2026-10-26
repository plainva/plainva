// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ScriptedAcpStep, WriteDraft } from "@plainva/core";
import i18n from "@plainva/ui/i18n";
import {
  agentArgsFromText,
  agentAuthProblemText,
  agentCommandsKey,
  agentEventParts,
  agentEventText,
  agentEventTone,
  agentMenuKey,
  agentNoteName,
  agentOptionsInOrder,
  agentOptionsKey,
  agentOptionText,
  agentProblemParts,
  agentProblemText,
  agentSeenText,
  agentSessionLine,
  agentSpelledMessage,
  agentToolParts,
  agentValuesKey,
  AiAgentView,
  AiSessionContext,
  type AcpSessionEvent,
  type AiSession,
  saidSentence,
  sentence,
  sentenceString,
} from "@plainva/ui";
import { acpHarness, AGENT_NOTES, decideAcpDraft, lastOf, memoryAcpVault, ROOT, type AcpHarness, type AcpScript } from "./acpTestHost";

/**
 * An external agent's place in the AI tab (plan KI-Harness P4.6), over the
 * real session against a scripted agent. The plan's gate asks one thing of
 * this surface above all: it names, before a start, what Plainva does not
 * control — and keeps saying it for as long as the session is there.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const t = (key: string, vars?: Record<string, unknown>) => i18n.t(key, vars) as string;
const label = (key: string, vars?: Record<string, string>) => i18n.t(key, vars) as string;

/**
 * Just enough of the assistant's session for the agent's place: its agents,
 * whether Plainva's tools are switched on, and the vault's list of drafts —
 * where a note an agent wrote waits, and where "Create" and "Discard" on its
 * card are answered (plan P5-6).
 */
function sessionOver(h: AcpHarness, mcpEnabled: boolean): AiSession {
  const drafts = (): { drafts: WriteDraft[]; done: never[] } => ({
    drafts: (h.vault?.drafts ?? []).map((draft) => ({
      id: draft.id,
      createdAt: "2026-10-07T10:00:00.000Z",
      author: draft.author,
      conversationId: null,
      title: draft.path.slice(draft.path.lastIndexOf("/") + 1).replace(/\.md$/, ""),
      body: { kind: "note", path: draft.path, folder: null, content: draft.content },
      inherited: [],
      sources: [],
      defused: draft.defused,
    })),
    done: [],
  });
  const build = () => ({ agents: h.state(), settings: { mcpEnabled }, drafts: drafts() });
  let state = build();
  return {
    agents: h.agents,
    subscribe: (listener: () => void) =>
      h.subscribe(() => {
        state = build();
        listener();
      }),
    getState: () => {
      if (state.agents !== h.state()) state = build();
      return state;
    },
    canCreateDrafts: () => true,
    draftTaskList: async () => null,
    async createDraft(id: string) {
      const path = h.vault.drafts.find((draft) => draft.id === id)!.path;
      decideAcpDraft(h, id, "created");
      return { kind: "created", path };
    },
    discardDraft: async (id: string) => decideAcpDraft(h, id, "discarded"),
  } as unknown as AiSession;
}

interface Mounted {
  container: HTMLElement;
  h: AcpHarness;
  opened: { notes: string[]; paths: string[]; urls: [string, boolean | undefined][]; settings: number };
}

async function mount(script: AcpScript = () => ({}), options: { mcpEnabled?: boolean; activeNote?: { path: string; title: string } | null; harness?: Parameters<typeof acpHarness>[1] } = {}): Promise<Mounted> {
  await i18n.changeLanguage("en");
  const h = await acpHarness(script, { label, ...options.harness });
  const opened: Mounted["opened"] = { notes: [], paths: [], urls: [], settings: 0 };
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <AiSessionContext.Provider value={sessionOver(h, options.mcpEnabled === true)}>
        <AiAgentView
          activeNote={options.activeNote ?? null}
          onOpenNote={(target) => void opened.notes.push(target)}
          onOpenPath={(path) => void opened.paths.push(path)}
          onOpenUrl={(url, composed) => void opened.urls.push([url, composed])}
          onOpenSettings={() => void opened.settings++}
        />
      </AiSessionContext.Provider>,
    );
    await h.settle();
  });
  return { container: host, h, opened };
}

const find = (container: HTMLElement, testId: string) => container.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
const all = (container: HTMLElement, testId: string) => Array.from(container.querySelectorAll(`[data-testid="${testId}"]`)) as HTMLElement[];
/** Clicks, and lets what the click started run to its end. */
async function click(h: AcpHarness, el: Element | null | undefined) {
  await act(async () => {
    (el as HTMLElement).click();
    await h.settle();
    await h.settle();
  });
}
/** Types into the message field the way React hears it. */
function type(el: Element | null, value: string) {
  const input = el as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function send(m: Mounted, text: string) {
  type(find(m.container, "ai-agent-input"), text);
  await click(m.h, find(m.container, "ai-agent-send"));
}
const turns = (...steps: ScriptedAcpStep[][]): AcpScript => () => ({ turns: steps });

describe("before an agent is started", () => {
  it("says what Plainva does not control — and what it does — and only then offers the start", async () => {
    const m = await mount();
    const start = find(m.container, "ai-agent-start")!;
    const facts = all(m.container, "ai-agent-facts")[0]!.querySelectorAll("li");
    expect(Array.from(facts).map((fact) => fact.textContent)).toEqual([
      "Gemini CLI is a program of another maker. It runs on this computer with your rights, in the folder of this vault.",
      "It reads files itself — also notes you keep from the cloud — and sends what it chooses to its own service. Plainva's privacy rules do not reach it, and nothing asks you before it sends.",
      "What it writes itself is in the vault at once, without a suggestion. The session tells you when the agent reports such a change.",
      "Plainva controls only its own side: its tools, with the folders you grant the agent and never a note kept from the cloud — and what the agent writes through Plainva: a change becomes a suggestion, a new note waits for you.",
      "The agent signs in by itself, with your own subscription or key. Plainva never sees its credentials.",
    ]);
    // The facts stand above the button: nobody starts past them.
    const button = find(m.container, "ai-agent-start-action")!;
    expect(start.querySelector('[data-testid="ai-agent-facts"]')!.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(find(m.container, "ai-agent-tools")!.textContent).toBe(t("ai.agent.start.toolsOff"));
    expect(m.h.native.processes).toEqual([]);
  });

  it("says whether Plainva's tools will be offered", async () => {
    const m = await mount(undefined, { mcpEnabled: true });
    expect(find(m.container, "ai-agent-tools")!.textContent).toBe("Plainva's tools are offered to the agent. The first time, Plainva asks you which folders it may read.");
  });

  it("leads to the settings where no agent was added, and starts nothing without a vault or inside an encrypted workspace", async () => {
    const none = await mount(undefined, { harness: { add: false } });
    expect(none.container.textContent).toContain("No agent has been added on this computer yet.");
    await click(none.h, find(none.container, "ai-agent-setup"));
    expect(none.opened.settings).toBe(1);
    act(() => root?.unmount());

    const closed = await mount(undefined, { harness: { vault: null } });
    expect(closed.container.textContent).toBe("Open a vault to start an agent in it.");
    act(() => root?.unmount());

    const vault = memoryAcpVault();
    vault.encrypted = true;
    const sealed = await mount(undefined, { harness: { vault } });
    expect(sealed.container.textContent).toBe("Plainva starts no external agent inside an encrypted workspace.");
    expect(find(sealed.container, "ai-agent-start-action")).toBeNull();
  });
});

describe("an agent's session", () => {
  it("carries who it is and what does not apply to it at its head for as long as it is there", async () => {
    const m = await mount(turns([{ say: "Hello." }]));
    await click(m.h, find(m.container, "ai-agent-start-action"));
    const marking = () => find(m.container, "ai-agent-marking")!.textContent;
    const said = "External agent · Gemini CLI. It reads and sends on its own: Plainva's privacy rules do not apply to it, and nothing asks before it sends.Plainva's tools: off";
    expect(marking()).toBe(said);
    expect(find(m.container, "ai-agent-session")!.getAttribute("data-phase")).toBe("ready");
    await send(m, "Hi");
    expect(marking()).toBe(said);
    await click(m.h, find(m.container, "ai-agent-end"));
    // Also after it ended, while what it wrote can still be read.
    expect(find(m.container, "ai-agent-session")!.getAttribute("data-phase")).toBe("ended");
    expect(marking()).toBe(said);
    expect(find(m.container, "ai-agent-ended")!.textContent).toBe("The session has ended.");
    await click(m.h, find(m.container, "ai-agent-dismiss"));
    expect(find(m.container, "ai-agent-start")).not.toBeNull();
    // The vault's log has its line now.
    expect(find(m.container, "ai-agent-sessions")!.textContent).toContain("Gemini CLI · messages: 1 · through Plainva: 0 · written itself: 0");
  });

  it("draws the agent's text as a stranger's: no markup of its own, and an address opens only through the app's question", async () => {
    const m = await mount(turns([{ say: 'See [the docs](https://example.com/docs) and [[Projects/Plan]]. <img src="https://evil.example/x.png" onerror="alert(1)"> ![pixel](https://evil.example/p.png)' }]));
    await click(m.h, find(m.container, "ai-agent-start-action"));
    await send(m, "Where?");
    const text = find(m.container, "ai-agent-text")!;
    // Nothing the agent wrote became an element that loads or runs anything.
    expect(text.querySelector("img")).toBeNull();
    expect(text.querySelector("script")).toBeNull();
    expect(text.querySelector("[onerror]")).toBeNull();
    // What it wrote as markup is read as the letters it is.
    expect(text.textContent).toContain('<img src="https://evil.example/x.png" onerror="alert(1)">');
    // An image is a word that leads to its address — nothing is loaded.
    expect(Array.from(text.querySelectorAll("a")).map((a) => a.textContent)).toContain("pixel");
    const link = Array.from(text.querySelectorAll("a, button, [role=link]")).find((el) => el.textContent === "the docs") as HTMLElement;
    await click(m.h, link);
    // An address in an agent's text is one a model composed: the shell asks before it opens it.
    expect(m.opened.urls).toEqual([["https://example.com/docs", true]]);
  });

  it("shows the agent's steps and Plainva's own lines, and what the agent named of the vault", async () => {
    const base = AGENT_NOTES["Projects/Plan.md"]!;
    const m = await mount(
      turns([
        { tool: { toolCallId: "c1", title: "Reading the plan", kind: "read", status: "completed", locations: [{ path: `${ROOT}/Projects/Plan.md` }, { path: "/etc/hosts" }] } },
        { tool: { toolCallId: "c2", kind: "edit", status: "completed", locations: [{ path: `${ROOT}/Projects/Notes.md` }] } },
        // Its own words name the file already: the line does not say the name twice.
        { tool: { toolCallId: "c3", title: "Read Welcome.md", kind: "read", status: "completed", locations: [{ path: `${ROOT}/Welcome.md` }] } },
        { write: { path: `${ROOT}/Projects/Plan.md`, content: base.replace("in May", "in June") } },
        { read: { path: `${ROOT}/Health/Results.md` } },
        { plan: [{ content: "Move the date", priority: "high", status: "completed" }] },
      ]),
    );
    await click(m.h, find(m.container, "ai-agent-start-action"));
    await send(m, "Move the date");
    expect(all(m.container, "ai-agent-tool").map((line) => line.textContent)).toEqual(["Reading the plan · Plan · outside the vault: 1", "Change a file · Notes", "Read Welcome.md"]);
    // The agent's words for a step and the names of what it named are drawn apart; Plainva's word for the kind and its count are not.
    expect(all(m.container, "ai-agent-tool").map((line) => Array.from(line.querySelectorAll("bdi.pv-said")).map((said) => said.textContent))).toEqual([["Reading the plan", "Plan"], ["Notes"], ["Read Welcome.md"]]);
    expect(find(m.container, "ai-agent-event-direct")!.textContent).toBe("The agent changed Projects/Notes.md itself: it is in the vault without a suggestion.");
    expect(find(m.container, "ai-agent-event-refused")!.textContent).toBe("Plainva did not hand Health/Results.md to the agent: kept from the cloud or the internet.");
    expect(find(m.container, "ai-agent-event-proposed")!.textContent).toMatch(/^Suggestion in Plan · changes: \d+\.$/);
    expect(find(m.container, "ai-agent-plan")!.textContent).toBe("Move the date");
  });

  it("puts the agent's question under a heading of Plainva's, with the agent's own options — no first, yes last", async () => {
    const m = await mount(
      turns([
        {
          ask: {
            toolCall: { toolCallId: "c1", title: "Run `git push`", kind: "execute" },
            options: [
              { optionId: "a", name: "Yes, and don't ask again", kind: "allow_always" },
              { optionId: "y", name: "Yes", kind: "allow_once" },
              { optionId: "n", name: "", kind: "reject_once" },
            ],
          },
        },
      ]),
    );
    await click(m.h, find(m.container, "ai-agent-start-action"));
    await send(m, "Publish");
    const card = find(m.container, "ai-agent-question")!;
    expect(card.getAttribute("aria-label")).toBe("Gemini CLI asks");
    expect(card.querySelector("dt")!.textContent).toBe("Run a command");
    expect(find(m.container, "ai-agent-question-title")!.textContent).toBe("Run `git push`");
    expect(card.textContent).toContain("The words are the agent's own.");
    // An option the agent gave no name gets Plainva's word for its kind.
    expect(Array.from(card.querySelectorAll("button")).map((button) => button.textContent)).toEqual(["Reject", "Yes, and don't ask again", "Yes"]);
    await click(m.h, find(m.container, "ai-agent-option-reject_once"));
    expect(m.h.agent().answers).toEqual([{ method: "session/request_permission", result: { outcome: { outcome: "selected", optionId: "n" } } }]);
    expect(find(m.container, "ai-agent-question")).toBeNull();
  });

  it("shows a note the agent wrote as a draft like every other — the same card, created or thrown away by the user", async () => {
    const m = await mount(
      turns([{ write: { path: `${ROOT}/Projects/Summary.md`, content: "# Summary\n\nSee https://example.org/a.\n" } }, { write: { path: `${ROOT}/Projects/Other.md`, content: "# Other\n" } }]),
    );
    await click(m.h, find(m.container, "ai-agent-start-action"));
    await send(m, "Write");
    // The shared draft card, inside the agent's thread: what it would become and where it would land.
    const thread = m.container.querySelector(".pv-ai-thread")!;
    const cards = all(m.container, "ai-draft");
    expect(cards.map((card) => card.getAttribute("aria-label"))).toEqual(["Draft · Note: Summary", "Draft · Note: Other"]);
    expect(cards.every((card) => card.classList.contains("pv-ai-overview--draft") && thread.contains(card))).toBe(true);
    // The agent named the file, so the card names its folder — never the inbox.
    expect(cards.map((card) => card.querySelector('[data-testid="ai-draft-place"]')!.textContent)).toEqual(["Projects", "Projects"]);
    // Addresses the agent brought are inert in what waits, and the card says that there were some.
    expect(cards[0]!.textContent).toContain(t("ai.write.draft.defused"));
    expect(cards[1]!.textContent).not.toContain(t("ai.write.draft.defused"));
    await click(m.h, cards[0]!.querySelector('[data-testid="ai-draft-show"]'));
    expect(find(m.container, "ai-draft-text")!.textContent).toContain("https[://]example.org/a");
    expect(m.h.vault.created).toEqual([]);

    // "Create" makes the note and opens it; the session says so, and the card is gone.
    await click(m.h, cards[0]!.querySelector('[data-testid="ai-draft-create"]'));
    expect(m.h.vault.created).toEqual(["Projects/Summary.md"]);
    expect(m.opened.paths).toEqual(["Projects/Summary.md"]);
    expect(all(m.container, "ai-draft").map((card) => card.getAttribute("aria-label"))).toEqual(["Draft · Note: Other"]);
    expect(thread.textContent).toContain("Created: Projects/Summary.md");
    // "Discard" drops the other one: nothing was written for it.
    await click(m.h, find(m.container, "ai-draft-discard"));
    expect(all(m.container, "ai-draft")).toEqual([]);
    expect(thread.textContent).toContain("Discarded: Projects/Other.md");
    expect(m.h.vault.created).toEqual(["Projects/Summary.md"]);
  });

  it("names the open note to the agent unless the user takes it out", async () => {
    const m = await mount(undefined, { activeNote: { path: "Projects/Plan.md", title: "Plan" } });
    m.h.vault.active = "Projects/Plan.md";
    await click(m.h, find(m.container, "ai-agent-start-action"));
    await send(m, "Summarise");
    expect((lastOf(m.h.agent().received)?.params as { prompt: unknown[] }).prompt).toHaveLength(2);
    await click(m.h, m.container.querySelector(".pv-ai-chips button"));
    await send(m, "Again, without it");
    expect((lastOf(m.h.agent().received)?.params as { prompt: unknown[] }).prompt).toHaveLength(1);
  });

  it("says that the agent wants a sign-in, offers the agent's own ways, and shows the command where no terminal opens", async () => {
    const m = await mount(({ signedIn }) => ({ needsAuth: !signedIn, authMethods: [{ id: "login", name: "Log in from the terminal", type: "terminal", args: ["login"] }] }));
    m.h.native.login = "no-terminal";
    await click(m.h, find(m.container, "ai-agent-start-action"));
    const card = find(m.container, "ai-agent-auth")!;
    expect(card.getAttribute("aria-label")).toBe("Gemini CLI wants a sign-in");
    expect(card.textContent).toContain("Plainva sees nothing of it and keeps no credential.");
    expect(find(m.container, "ai-agent-send")!.hasAttribute("disabled")).toBe(true);
    await click(m.h, find(m.container, "ai-agent-auth-method"));
    // As the native script runs it: into the vault's folder, every part quoted for the shell, each isolated.
    expect(find(m.container, "ai-agent-auth-command")!.textContent).toBe("cd '/home/mara/Vault' && '/usr/bin/gemini' '--acp' 'login'");
    expect(Array.from(find(m.container, "ai-agent-auth-command")!.querySelectorAll("bdi")).map((part) => part.textContent)).toEqual(["cd", "'/home/mara/Vault'", "&&", "'/usr/bin/gemini'", "'--acp'", "'login'"]);
    expect(find(m.container, "ai-agent-auth")!.textContent).toContain("No terminal could be opened.");
    // The user signed in in a terminal of their own.
    m.h.native.signedIn = true;
    await click(m.h, find(m.container, "ai-agent-auth-retry"));
    expect(find(m.container, "ai-agent-auth")).toBeNull();
    expect(find(m.container, "ai-agent-session")!.getAttribute("data-phase")).toBe("ready");
  });

  it("says why it ended where the program gave up, and shows the program's last lines on request", async () => {
    const m = await mount(turns([{ exit: 2 }]));
    m.h.native.lastWords = "fatal: quota exceeded\n";
    await click(m.h, find(m.container, "ai-agent-start-action"));
    await send(m, "Go");
    expect(find(m.container, "ai-agent-ended")!.textContent).toBe("The agent's program ended (code 2).");
    expect(find(m.container, "ai-agent-input")).toBeNull();
    await click(m.h, find(m.container, "ai-agent-log-show"));
    expect(find(m.container, "ai-agent-log")!.textContent).toBe("fatal: quota exceeded\n");
  });
});

describe("the lines Plainva writes about an agent", () => {
  it("say each thing in the user's language, by its word", () => {
    void i18n.changeLanguage("en");
    const lint = t("ai.lint.defused");
    const cases: [AcpSessionEvent, string][] = [
      [{ type: "proposed", path: "Projects/Plan.md", blocks: 3, defused: 0 }, "Suggestion in Plan · changes: 3."],
      [{ type: "proposed", path: "Plan.md", blocks: 1, defused: 2 }, `Suggestion in Plan · changes: 1. ${lint}`],
      [{ type: "new", path: "Projects/New.md" }, "A new note waits for you: Projects/New.md"],
      [{ type: "created", path: "Projects/New.md" }, "Created: Projects/New.md"],
      [{ type: "discarded", path: "Projects/New.md" }, "Discarded: Projects/New.md"],
      [{ type: "direct", path: "Projects/Plan.md" }, "The agent changed Projects/Plan.md itself: it is in the vault without a suggestion."],
      [{ type: "note-kept", path: "Health/Results.md" }, "Results was not named to the agent: it is kept from the cloud or the internet."],
      [{ type: "refused", what: "read", reason: "kept", path: "Health/Results.md" }, "Plainva did not hand Health/Results.md to the agent: kept from the cloud or the internet."],
      [
        { type: "refused", what: "write", reason: "properties", path: "Projects/Plan.md" },
        "Plainva did not take the agent's change to Projects/Plan.md: a property value that is neither text, a number, yes/no nor a list of those.",
      ],
      [{ type: "refused", what: "write", reason: "rules", path: "Projects/Plan.md" }, "Plainva did not take the agent's change to Projects/Plan.md: would set AI rules, trust fields or one of Plainva's own properties."],
      [{ type: "refused", what: "write", reason: "waiting", path: "Projects/New.md" }, "Plainva did not take the agent's change to Projects/New.md: too many drafts are waiting already."],
      [{ type: "refused", what: "read", reason: "outside", path: "/etc/passwd" }, "Plainva did not hand /etc/passwd to the agent: outside this vault."],
      [{ type: "stopped", reason: "max_tokens" }, "The agent stopped: its model reached its limit."],
      [{ type: "stopped", reason: "cancelled" }, "Stopped."],
      [{ type: "failed", message: "" }, "The agent could not finish this."],
      [{ type: "failed", message: "quota" }, "The agent could not finish this. It says: quota"],
      // Plan P9-7: a setting the agent changed itself, in its own names — a switch says on or off —, and a change it did not take.
      [{ type: "setting", setting: "Mode", value: "Code" }, "The agent set “Mode” to “Code” itself."],
      [{ type: "setting", setting: "Think hard", value: true }, "The agent turned on “Think hard” itself."],
      [{ type: "setting", setting: "Think hard", value: false }, "The agent turned off “Think hard” itself."],
      // What changed along with the user's own change is named as going with it.
      [{ type: "setting", setting: "Thought", value: "Low", along: true }, "With it, the agent set “Thought” to “Low”."],
      [{ type: "setting", setting: "Think hard", value: true, along: true }, "With it, the agent turned on “Think hard”."],
      [{ type: "setting", setting: "Think hard", value: false, along: true }, "With it, the agent turned off “Think hard”."],
      [{ type: "setting-refused", setting: "Model", message: "" }, "The agent did not change “Model”."],
      [{ type: "setting-refused", setting: "Model", message: "Not now." }, "The agent did not change “Model”. It says: Not now."],
      [{ type: "setting-refused", setting: "Model", message: "", reason: "sign-in" }, "The agent did not change “Model”: it wants a sign-in first, in its own program."],
      // An agent's mode in the older form is named in Plainva's own word.
      [{ type: "setting", setting: null, value: "Ask" }, "The agent set “Mode” to “Ask” itself."],
      [{ type: "setting-refused", setting: null, message: "" }, "The agent did not change “Mode”."],
    ];
    for (const [event, text] of cases) expect(agentEventText(t, event, lint)).toBe(text);
    expect(agentEventTone({ type: "refused", what: "read", reason: "kept", path: "x" })).toBe("failed");
    expect(agentEventTone({ type: "direct", path: "x" })).toBe("notice");
    expect(agentEventTone({ type: "stopped", reason: "cancelled" })).toBe("done");
    expect(agentEventTone({ type: "stopped", reason: "refusal" })).toBe("notice");
    expect(agentEventTone({ type: "proposed", path: "x", blocks: 1, defused: 0 })).toBe("done");
    expect(agentEventTone({ type: "setting", setting: "Mode", value: "Code" })).toBe("notice");
    expect(agentEventTone({ type: "setting-refused", setting: "Model", message: "" })).toBe("failed");
  });

  it("say why an agent did not come up or did not get in", () => {
    void i18n.changeLanguage("en");
    expect(agentProblemText(t, { kind: "start", word: "program-moved" })).toBe("The agent's program is no longer where it was. Add the agent again.");
    expect(agentProblemText(t, { kind: "exited", code: null })).toBe("The agent's program ended.");
    expect(agentProblemText(t, { kind: "exited", code: 0 })).toBe("The agent's program ended.");
    expect(agentProblemText(t, { kind: "exited", code: 3 })).toBe("The agent's program ended (code 3).");
    expect(agentProblemText(t, { kind: "version" })).toBe("The agent speaks a version of the protocol that Plainva does not know.");
    expect(agentProblemText(t, { kind: "timeout" })).toBe("The agent did not answer in time.");
    expect(agentProblemText(t, { kind: "protocol" })).toBe("The agent's answers could not be read.");
    expect(agentProblemText(t, { kind: "agent", message: "boom" })).toBe("The agent answered with an error: boom");
    // The agent's own words for it are a part of their own.
    expect(agentProblemParts(t, { kind: "agent", message: "Not now. Plainva checked it." })).toEqual(["The agent answered with an error: ", { said: "Not now. Plainva checked it." }]);
    expect(agentAuthProblemText(t, "declined")).toBe("The sign-in was not finished.");
    expect(agentAuthProblemText(t, "no-method")).toContain("names no way to sign in from here");
    expect(agentAuthProblemText(t, "busy")).toBe("The sign-in could not be started.");
    // A terminal that could not be opened is said where the command stands.
    expect(agentAuthProblemText(t, "no-terminal")).toBeNull();
  });

  it("order an agent's options, name a note, read arguments and sum up a session", () => {
    void i18n.changeLanguage("en");
    const options = [
      { id: "1", name: "Yes", kind: "allow_once" as const },
      { id: "2", name: "", kind: "reject_always" as const },
      { id: "3", name: "Always", kind: "allow_always" as const },
      { id: "4", name: "No", kind: "reject_once" as const },
    ];
    expect(agentOptionsInOrder(options).map((option) => option.id)).toEqual(["2", "4", "3", "1"]);
    expect(agentOptionText(t, options[1]!)).toBe("Always reject");
    expect(agentOptionText(t, options[0]!)).toBe("Yes");
    expect(agentNoteName("Projects/2026/Plan.md")).toBe("Plan");
    expect(agentNoteName("table.base")).toBe("table.base");
    expect(agentArgsFromText("  --acp \n\n --model=x\n")).toEqual(["--acp", "--model=x"]);
    expect(agentSessionLine(t, { at: "2026-10-07T10:00:00.000Z", agent: "gemini", label: "Gemini CLI", turns: 3, read: 2, proposed: 1, created: 1, direct: 4, refused: 0, end: "closed" }, "en")).toMatch(/ · Gemini CLI · messages: 3 · through Plainva: 2 · written itself: 4$/);
    // A name the user gave with a placeholder in it stays as it was given, and the numbers stay where they belong.
    expect(agentSessionLine(t, { at: "2026-10-07T10:00:00.000Z", agent: "gemini", label: "Bot {{turns}}", turns: 3, read: 2, proposed: 1, created: 1, direct: 4, refused: 0, end: "closed" }, "en")).toMatch(/ · Bot \{\{turns\}\} · messages: 3 · through Plainva: 2 · written itself: 4$/);
    const agent = { id: "gemini", label: "Gemini CLI", program: "/usr/bin/gemini", args: ["--acp"], known: "Gemini CLI" };
    expect(agentSeenText(t, agent, "en")).toBe("How it writes has not been seen on this computer yet");
    expect(agentSeenText(t, { ...agent, seen: { at: "2026-10-07T10:00:00.000Z", proposed: 2, direct: 0 } }, "en")).toMatch(/^Last seen here \(.*2026.*\): through Plainva 2, written itself 0$/);
  });
});

describe("the texts of the agent's place", () => {
  it("say in every language that the privacy rules do not reach the agent, without a word that is no translation", async () => {
    for (const language of ["de", "es", "fr", "it", "ja", "nl", "pl", "pt-BR", "zh-CN"]) {
      await i18n.changeLanguage(language);
      const reads = t("ai.agent.start.fact.reads");
      const marking = t("ai.agent.marking", { agent: "X" });
      expect(reads, language).not.toBe(i18n.getFixedT("en")("ai.agent.start.fact.reads"));
      expect(reads.length, language).toBeGreaterThan(40);
      expect(marking, language).toContain("X");
      expect(marking, language).toContain("Plainva");
    }
    await i18n.changeLanguage("en");
    expect(vi.isMockFunction(t)).toBe(false);
  });
});

/** Plan KI-Harness P9-7: the agent's settings in the composer's foot, and its commands while "/name" is typed. */
describe("what the user may set for an agent's session, and its commands", () => {
  const CONFIG = [
    { id: "mode", name: "Mode", category: "mode", currentValue: "ask", options: [{ value: "ask", name: "Ask" }, { value: "code", name: "Code", description: "Changes files without asking" }] },
    { id: "model", name: "Model", category: "model", currentValue: "fast", options: [{ group: "fast", name: "Fast", options: [{ value: "fast", name: "Fast model" }] }, { group: "deep", name: "Deep", options: [{ value: "deep", name: "Deep model" }] }] },
    { id: "think", name: "Think hard", category: "thought_level", type: "boolean", currentValue: false },
  ];
  const menu = (container: HTMLElement, label: string) => container.querySelector(`[role="menu"][aria-label="${label}"]`) as HTMLElement | null;
  const text = (item: Element) => item.querySelector(".pv-menu-text")!.textContent;
  const key = (el: Element | null, name: string) =>
    act(() => {
      (el as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
    });

  it("shows the agent's mode and model as buttons that open its own values, and the rest behind one button", async () => {
    const m = await mount(() => ({ configOptions: CONFIG }));
    await click(m.h, find(m.container, "ai-agent-start-action"));
    const mode = find(m.container, "ai-agent-setting-mode")!;
    expect(mode.textContent).toBe("Mode: Ask");
    // Whose settings these are, said where they are.
    expect(mode.getAttribute("data-tip")).toBe("A setting of Gemini CLI: it changes how Gemini CLI works, not what Plainva lets through. What Gemini CLI does with its own tools is outside Plainva in every mode.");
    expect(find(m.container, "ai-agent-setting-model")!.textContent).toBe("Model: Fast model");
    await click(m.h, mode);
    const modes = Array.from(menu(m.container, "Mode of Gemini CLI")!.querySelectorAll('[role="menuitemradio"]'));
    expect(modes.map((item) => [text(item), item.getAttribute("aria-checked")])).toEqual([
      ["Ask", "true"],
      ["Code", "false"],
    ]);
    await click(m.h, modes[1]);
    expect(lastOf(m.h.agent().received)).toMatchObject({ method: "session/set_config_option", params: { configId: "mode", value: "code" } });
    expect(find(m.container, "ai-agent-setting-mode")!.textContent).toBe("Mode: Code");
    // The model's values under the agent's own groups.
    await click(m.h, find(m.container, "ai-agent-setting-model"));
    const models = menu(m.container, "Model of Gemini CLI")!;
    expect(Array.from(models.querySelectorAll(".pv-menu-label")).map((label) => label.textContent)).toEqual(["Model of Gemini CLI", "Fast", "Deep"]);
    key(models, "Escape");
    // The rest: a switch is an entry that is ticked or not.
    await click(m.h, find(m.container, "ai-agent-settings-more"));
    const think = menu(m.container, "More settings of Gemini CLI")!.querySelector('[role="menuitemcheckbox"]')!;
    expect([text(think), think.getAttribute("aria-checked")]).toEqual(["Think hard", "false"]);
    await click(m.h, think);
    expect(lastOf(m.h.agent().received)).toMatchObject({ method: "session/set_config_option", params: { configId: "think", value: true, type: "boolean" } });
    expect(find(m.container, "ai-agent-settings-more")).not.toBeNull();
  });

  it("shows no settings for an agent that offers none, and the older modes for one that offers only those", async () => {
    const none = await mount();
    await click(none.h, find(none.container, "ai-agent-start-action"));
    expect(find(none.container, "ai-agent-settings")).toBeNull();
    act(() => root?.unmount());
    const older = await mount(() => ({ modes: { currentModeId: "ask", availableModes: [{ id: "ask", name: "Ask" }, { id: "plan", name: "Plan" }] } }));
    await click(older.h, find(older.container, "ai-agent-start-action"));
    expect(find(older.container, "ai-agent-setting-mode")!.textContent).toBe("Mode: Ask");
    await click(older.h, find(older.container, "ai-agent-setting-mode"));
    // Plainva's own word names the mode here: of the heading and the button, only the agent's value is drawn as its.
    expect(menu(older.container, "Mode of Gemini CLI")!.querySelector(".pv-menu-label")!.querySelectorAll("bdi.pv-said")).toHaveLength(0);
    expect(Array.from(find(older.container, "ai-agent-setting-mode")!.querySelectorAll("bdi.pv-said")).map((said) => said.textContent)).toEqual(["Ask"]);
    await click(older.h, Array.from(menu(older.container, "Mode of Gemini CLI")!.querySelectorAll('[role="menuitemradio"]'))[1]);
    expect(lastOf(older.h.agent().received)).toMatchObject({ method: "session/set_mode", params: { modeId: "plan" } });
    expect(find(older.container, "ai-agent-setting-mode")!.textContent).toBe("Mode: Plan");
  });

  it("finds a command the agent spells in other letters than typed, and writes it as the agent spells it", async () => {
    // "résumé" with its accents apart, as an agent may spell it; a keyboard types them composed.
    const spelled = "re\u0301sume\u0301";
    const m = await mount(turns([{ say: "Done." }]));
    await click(m.h, find(m.container, "ai-agent-start-action"));
    await act(async () => {
      m.h.agent().emit({
        jsonrpc: "2.0",
        method: "session/update",
        params: { sessionId: "sess-1", update: { sessionUpdate: "available_commands_update", availableCommands: [{ name: spelled, description: "Sum up", input: { hint: "what to sum up" } }] } },
      });
      await m.h.settle();
    });
    const input = find(m.container, "ai-agent-input") as HTMLTextAreaElement;
    type(input, `/${spelled.normalize("NFC").slice(0, 2)}`);
    expect(all(m.container, "ai-agent-command")).toHaveLength(1);
    key(input, "Enter");
    expect(input.value).toBe(`/${spelled} `);
    // Typed whole in the other spelling, it is still the agent's command, and what goes after it stands under the field.
    type(input, `/${spelled.normalize("NFC")} `);
    expect(find(m.container, "ai-agent-command-hint")!.textContent).toBe(`Gemini CLI on /${spelled}: what to sum up`);
    // Sent so, it goes as the agent spells it: that is the name it recognises.
    await send(m, `/${spelled.normalize("NFC")} the week`);
    const prompts = m.h.agent().received.filter((message) => message.method === "session/prompt");
    expect(((lastOf(prompts)!.params as { prompt: { type: string; text?: string }[] }).prompt[0]!).text).toBe(`/${spelled} the week`);
  });

  it("offers the agent's commands while a message begins with its name, and Enter takes one instead of sending", async () => {
    const m = await mount(turns([{ say: "Searching." }]));
    await click(m.h, find(m.container, "ai-agent-start-action"));
    await act(async () => {
      m.h.agent().emit({
        jsonrpc: "2.0",
        method: "session/update",
        params: { sessionId: "sess-1", update: { sessionUpdate: "available_commands_update", availableCommands: [{ name: "web", description: "Search the web", input: { hint: "what to search for" } }, { name: "plan", description: "Make a plan" }] } },
      });
      await m.h.settle();
    });
    const input = find(m.container, "ai-agent-input") as HTMLTextAreaElement;
    expect(input.placeholder).toBe("Message to Gemini CLI… — / for its commands");
    type(input, "/");
    const list = () => menu(m.container, "Commands of Gemini CLI");
    expect(all(m.container, "ai-agent-command").map((item) => [text(item), item.querySelector(".pv-menu-hint")?.textContent])).toEqual([
      ["/web", "Search the web · what to search for"],
      ["/plan", "Make a plan"],
    ]);
    type(input, "/pl");
    expect(all(m.container, "ai-agent-command").map(text)).toEqual(["/plan"]);
    key(input, "Enter");
    expect(input.value).toBe("/plan ");
    expect(list()).toBeNull();
    // Nothing was sent by that Enter.
    expect(m.h.agent().received.some((message) => message.method === "session/prompt")).toBe(false);
    // Escape closes the list and leaves the session as it is.
    type(input, "/w");
    expect(list()).not.toBeNull();
    key(input, "Escape");
    expect(list()).toBeNull();
    expect(find(m.container, "ai-agent-session")).not.toBeNull();
    type(input, "/web plainva");
    expect(list()).toBeNull();
    await click(m.h, find(m.container, "ai-agent-send"));
    expect(lastOf(m.h.agent().received.filter((message) => message.method === "session/prompt"))).toMatchObject({ params: { prompt: [{ type: "text", text: "/web plainva" }] } });
  });
});

/** Plan KI-Harness P9-7, review round 1: the keyboard, whose words, and the edges of the command list. */
describe("an agent's settings and commands, at their edges", () => {
  const CONFIG = [
    { id: "mode", name: "Mode", category: "mode", currentValue: "ask", options: [{ value: "ask", name: "Ask" }, { value: "code", name: "Code", description: "Changes files without asking" }] },
    { id: "model", name: "Model", category: "model", currentValue: "fast", options: [{ value: "fast", name: "Fast model" }, { value: "deep", name: "Deep model" }] },
    { id: "think", name: "Think hard", category: "thought_level", type: "boolean", currentValue: false },
    { id: "effort", name: "Effort", currentValue: "low", options: [{ value: "low", name: "Low" }, { value: "high", name: "High", description: "Takes its time" }] },
  ];
  const menu = (container: HTMLElement, label: string) => container.querySelector(`[role="menu"][aria-label="${label}"]`) as HTMLElement | null;
  const text = (item: Element) => item.querySelector(".pv-menu-text")!.textContent;
  const press = (el: Element | null, name: string, init: KeyboardEventInit = {}) =>
    act(() => {
      (el as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }));
    });
  const microtasks = () =>
    act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

  it("names each button for the agent whose setting it is, begins each menu with Plainva's heading, and ticks the current value", async () => {
    const m = await mount(() => ({ configOptions: CONFIG }));
    await click(m.h, find(m.container, "ai-agent-start-action"));
    const mode = find(m.container, "ai-agent-setting-mode")!;
    // Its name begins with what it shows and says whose setting it is; what a setting does not change is its description.
    expect([mode.getAttribute("aria-label"), mode.textContent]).toEqual(["Mode: Ask, a setting of Gemini CLI", "Mode: Ask"]);
    // The tip says whose setting it is and what it does not change; the description, read after the name, only the second.
    expect(mode.getAttribute("data-tip")).toBe(t("ai.agent.config.tip", { agent: "Gemini CLI" }));
    expect(mode.getAttribute("aria-description")).toBe(t("ai.agent.config.described", { agent: "Gemini CLI" }));
    expect(mode.getAttribute("aria-expanded")).toBe("false");
    await click(m.h, mode);
    expect(mode.getAttribute("aria-expanded")).toBe("true");
    const modes = menu(m.container, "Mode of Gemini CLI")!;
    // Plainva's heading in its capitals; the agent's word in it is drawn apart, and its words below never look like one.
    expect([modes.firstElementChild!.className, modes.firstElementChild!.textContent]).toEqual(["pv-menu-label", "Mode of Gemini CLI"]);
    expect(Array.from(modes.firstElementChild!.querySelectorAll("bdi.pv-said")).map((said) => said.textContent)).toEqual(["Mode"]);
    const [ask, code] = Array.from(modes.querySelectorAll('[role="menuitemradio"]'));
    // The current value carries the tick in a slot the others keep free — not the arrow keys' highlight.
    expect(ask!.querySelector(".pv-menu-tick svg")).not.toBeNull();
    expect(code!.querySelector(".pv-menu-tick")!.childElementCount).toBe(0);
    expect(ask!.classList.contains("is-active")).toBe(false);
    // A description of the agent's is cut in its row and whole in the tooltip.
    expect(code!.getAttribute("data-tip")).toBe("Changes files without asking");
    // A second press on the button closes its menu.
    await click(m.h, mode);
    expect(menu(m.container, "Mode of Gemini CLI")).toBeNull();
    await click(m.h, find(m.container, "ai-agent-settings-more"));
    const more = menu(m.container, "More settings of Gemini CLI")!;
    expect(more.firstElementChild!.textContent).toBe("More settings of Gemini CLI");
    expect(find(m.container, "ai-agent-settings-more")!.getAttribute("aria-description")).toBe(t("ai.agent.config.describedMore", { agent: "Gemini CLI" }));
    // A choice behind it is a group of its own under its name — the agent's words, in their quiet italics.
    const effort = more.querySelector('[role="group"][aria-label="Effort"]')!;
    expect([effort.querySelector(".pv-menu-label")!.textContent, effort.querySelector(".pv-menu-label")!.className]).toEqual(["Effort", "pv-menu-label pv-menu-label--said"]);
    // In the direction its own letters give it, not the menu's.
    expect(effort.querySelector(".pv-menu-label")!.getAttribute("dir")).toBe("auto");
    expect(Array.from(effort.querySelectorAll('[role="menuitemradio"]')).map((item) => [text(item), item.getAttribute("aria-checked")])).toEqual([
      ["Low", "true"],
      ["High", "false"],
    ]);
  });

  it("keeps the keyboard on a button while its change waits for the agent, and takes no press then", async () => {
    const m = await mount(() => ({ configOptions: CONFIG, hangsOnSettings: true }));
    await click(m.h, find(m.container, "ai-agent-start-action"));
    const mode = find(m.container, "ai-agent-setting-mode") as HTMLButtonElement;
    act(() => mode.focus());
    await click(m.h, mode);
    await click(m.h, Array.from(menu(m.container, "Mode of Gemini CLI")!.querySelectorAll('[role="menuitemradio"]'))[1]);
    await microtasks();
    // The focus came back to the button: it waits, and says so, but it is not taken out of the keyboard's way.
    expect(document.activeElement).toBe(mode);
    expect([mode.disabled, mode.getAttribute("aria-disabled")]).toEqual([false, "true"]);
    // The row says in words that a change waits.
    expect(m.container.querySelector('.pv-agent-settings [role="status"]')!.textContent).toBe("Gemini CLI is changing a setting…");
    await click(m.h, mode);
    expect(menu(m.container, "Mode of Gemini CLI")).toBeNull();
  });

  it("takes no pick from an open menu while a change in it waits", async () => {
    const m = await mount(() => ({ configOptions: CONFIG, hangsOnSettings: true }));
    await click(m.h, find(m.container, "ai-agent-start-action"));
    await click(m.h, find(m.container, "ai-agent-settings-more"));
    const more = menu(m.container, "More settings of Gemini CLI")!;
    await click(m.h, more.querySelector('[role="menuitemcheckbox"]'));
    // The switch keeps its menu open; until the agent answers, nothing in it can be picked — and its entries keep the
    // keyboard: none is natively disabled, which would throw the focus to the page.
    expect(menu(m.container, "More settings of Gemini CLI")).toBe(more);
    const entries = Array.from(more.querySelectorAll<HTMLButtonElement>(".pv-menu-item"));
    expect(entries.map((item) => [item.disabled, item.getAttribute("aria-disabled")])).toEqual([
      [false, "true"],
      [false, "true"],
      [false, "true"],
    ]);
    await click(m.h, entries[2]);
    expect(menu(m.container, "More settings of Gemini CLI")).toBe(more);
    expect(m.h.agent().received.filter((message) => message.method === "session/set_config_option")).toHaveLength(1);
  });

  it("lists the agent's commands under Plainva's heading, says how many more there are, and what goes after a command it took", async () => {
    const m = await mount(turns([{ say: "Done." }]));
    await click(m.h, find(m.container, "ai-agent-start-action"));
    const offered = [{ name: "web", description: "Search the web", input: { hint: "what to search for" } }, ...Array.from({ length: 13 }, (_, index) => ({ name: `w${index}`, description: `Command ${index}` }))];
    await act(async () => {
      m.h.agent().emit({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "sess-1", update: { sessionUpdate: "available_commands_update", availableCommands: offered } } });
      await m.h.settle();
    });
    const input = find(m.container, "ai-agent-input") as HTMLTextAreaElement;
    type(input, "/w");
    const list = menu(m.container, "Commands of Gemini CLI")!;
    expect(list.firstElementChild!.textContent).toBe("Commands of Gemini CLI");
    expect(all(m.container, "ai-agent-command")).toHaveLength(12);
    // Plainva's note at the foot is a sentence, not a heading.
    expect([list.lastElementChild!.textContent, list.lastElementChild!.className]).toEqual(["2 more — keep typing", "pv-menu-label pv-menu-label--note"]);
    // A press anywhere on the list leaves the field its focus.
    const pressed = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    list.firstElementChild!.dispatchEvent(pressed);
    expect(pressed.defaultPrevented).toBe(true);
    // As it narrows, it is the same list, placed again — not one mounted anew.
    type(input, "/we");
    expect(menu(m.container, "Commands of Gemini CLI")).toBe(list);
    type(input, "/w");
    // A list closed with Escape comes back when the same text is typed anew.
    press(input, "Escape");
    expect(menu(m.container, "Commands of Gemini CLI")).toBeNull();
    type(input, "");
    type(input, "/w");
    expect(menu(m.container, "Commands of Gemini CLI")).not.toBeNull();
    type(input, "/we");
    expect(all(m.container, "ai-agent-command").map(text)).toEqual(["/web"]);
    // Shift+Tab leaves the field as it always does and takes nothing; neither does a key with a modifier.
    press(input, "Tab", { shiftKey: true });
    press(input, "Tab", { ctrlKey: true });
    expect(input.value).toBe("/we");
    // With the list open, Enter with a modifier neither takes a command nor sends what is half typed.
    press(input, "Enter", { ctrlKey: true });
    expect(input.value).toBe("/we");
    expect(m.h.agent().received.some((message) => message.method === "session/prompt")).toBe(false);
    // Enter takes the command; held down, it sends nothing after it.
    press(input, "Enter");
    expect(input.value).toBe("/web ");
    press(input, "Enter", { repeat: true });
    expect(m.h.agent().received.some((message) => message.method === "session/prompt")).toBe(false);
    // What the agent says goes after it stands under the field, as its words, until the user types on.
    const hint = find(m.container, "ai-agent-command-hint")!;
    expect(hint.textContent).toBe("Gemini CLI on /web: what to search for");
    expect(input.getAttribute("aria-describedby")).toBe(hint.id);
    type(input, "/web plainva");
    expect(find(m.container, "ai-agent-command-hint")).toBeNull();
    expect(input.hasAttribute("aria-describedby")).toBe(false);
  });
});

/** Plan KI-Harness P9-7, review round 3: a stranger's words never become a part of Plainva's sentence. */
describe("an agent's words in Plainva's sentences", () => {
  it("never pass through the sentence: a name with a placeholder or a closing quote stays the agent's", async () => {
    await i18n.changeLanguage("en");
    const lint = "";
    // A placeholder in the agent's word is no placeholder: the value lands where the sentence has it, once.
    expect(agentEventParts(t, { type: "setting", setting: "Mode {{value}}", value: "Auto" }, lint)).toEqual(["The agent set “", { said: "Mode {{value}}" }, "” to “", { said: "Auto" }, "” itself."]);
    // A name that tries to end Plainva's sentence and begin another is one part of the agent's, whole.
    const forged = "Mode” itself. Plainva checked it: nothing leaves the vault. The agent set “Mode";
    const parts = agentEventParts(t, { type: "setting", setting: forged, value: "Auto" }, lint);
    expect(parts.filter((part) => typeof part !== "string")).toEqual([{ said: forged }, { said: "Auto" }]);
    expect(agentEventText(t, { type: "setting", setting: forged, value: "Auto" }, lint)).toBe(`The agent set “${forged}” to “Auto” itself.`);
  });

  it("are drawn apart in the thread and in a heading", async () => {
    const named = (currentValue: string) => ({ id: "mode", name: "Mode {{agent}}", category: "mode", type: "select", currentValue, options: [{ value: "ask", name: "Ask" }, { value: "code", name: "Code" }] });
    const m = await mount(() => ({ configOptions: [named("ask")], turns: [[{ update: { sessionUpdate: "config_option_update", configOptions: [named("code")] } }, { say: "Done." }]] }));
    await click(m.h, find(m.container, "ai-agent-start-action"));
    await send(m, "Go");
    const line = find(m.container, "ai-agent-event-setting")!;
    expect(Array.from(line.querySelectorAll("bdi.pv-said")).map((said) => said.textContent)).toEqual(["Mode {{agent}}", "Code"]);
    await click(m.h, find(m.container, "ai-agent-setting-mode"));
    const heading = m.container.querySelector('[role="menu"] .pv-menu-label')!;
    expect(heading.textContent).toBe("Mode {{agent}} of Gemini CLI");
    expect(heading.querySelector("bdi.pv-said")!.textContent).toBe("Mode {{agent}}");
    // On the button and in its name the agent's words stay as they are, whatever they hold.
    const button = find(m.container, "ai-agent-setting-mode")!;
    expect(button.getAttribute("aria-label")).toBe("Mode {{agent}}: Code, a setting of Gemini CLI");
    expect(Array.from(button.querySelectorAll("bdi.pv-said")).map((said) => said.textContent)).toEqual(["Mode {{agent}}", "Code"]);
  });

  it("keep Plainva's own word for an agent's mode in the older form its own, and every value of the user's as typed", async () => {
    await i18n.changeLanguage("en");
    expect(agentEventParts(t, { type: "setting", setting: null, value: "Ask" }, "")).toEqual(["The agent set “Mode” to “", { said: "Ask" }, "” itself."]);
    expect(agentEventParts(t, { type: "setting-refused", setting: null, message: "Not now" }, "")).toEqual(["The agent did not change “Mode”. It says: ", { said: "Not now" }]);
    // A value of the user's own with a placeholder in it is no placeholder either: i18next would put the agent's words into it.
    expect(saidSentence(t, "ai.agent.commands.hint", { command: "web", hint: "what to search for" }, { agent: "My {{command}} bot" })).toEqual(["My {{command}} bot on /", { said: "web" }, ": ", { said: "what to search for" }]);
    expect(sentence(t, "ai.agent.config.owned", { label: "Mode: {{agent}}", agent: "Gemini CLI" })).toEqual(["Mode: {{agent}}, a setting of Gemini CLI"]);
    // A number stays a number, for the plural.
    expect(sentence(t, "ai.agent.commands.more", { count: 3 })).toEqual(["3 more — keep typing"]);
  });

  it("draw an agent's step apart from Plainva's count of what it named outside the vault", async () => {
    await i18n.changeLanguage("en");
    // A name that turns the line around would read as Plainva's: it is a part of its own.
    const turned = `${String.fromCharCode(0x202e)}tluav eht edistuo gnihton`;
    expect(agentToolParts(t, { title: "Read the notes", toolKind: "read", files: [`Notes/${turned}`], outside: 1 })).toEqual([{ said: "Read the notes" }, " · ", { said: turned }, ` · ${t("ai.agent.toolOutside", { count: 1 })}`]);
    // Without words of its own a step is named by Plainva's word for its kind; three names at most.
    expect(agentToolParts(t, { title: "", toolKind: "edit", files: ["Projects/Notes.md", "a.md", "b.md", "c.md"], outside: 0 })).toEqual(["Change a file", " · ", { said: "Notes" }, ", ", { said: "a" }, ", ", { said: "b" }]);
  });

  it("name each of a question's files apart, so that one name cannot turn the list around", async () => {
    const turned = `Notes/${String.fromCharCode(0x202e)}gnihton.md`;
    const m = await mount(
      turns([{ ask: { toolCall: { toolCallId: "c1", title: "Edit", kind: "edit", locations: [{ path: `${ROOT}/${turned}` }, { path: `${ROOT}/Projects/Plan.md` }] }, options: [{ optionId: "n", name: "No", kind: "reject_once" }] } }]),
    );
    await click(m.h, find(m.container, "ai-agent-start-action"));
    await send(m, "Go");
    const files = find(m.container, "ai-agent-question-files")!;
    expect(Array.from(files.querySelectorAll("bdi")).map((file) => file.textContent)).toEqual([turned, "Projects/Plan.md"]);
    expect(files.textContent).toBe(`${turned}, Projects/Plan.md`);
  });

  it("say in the banner, in the agent's words and apart, why it did not open the session", async () => {
    const m = await mount(() => ({ sessionRefused: "Not now. Plainva checked it: nothing left the vault." }));
    await click(m.h, find(m.container, "ai-agent-start-action"));
    const ended = find(m.container, "ai-agent-ended")!;
    expect(ended.textContent).toBe("The agent answered with an error: Not now. Plainva checked it: nothing left the vault.");
    expect(Array.from(ended.querySelectorAll("bdi.pv-said")).map((said) => said.textContent)).toEqual(["Not now. Plainva checked it: nothing left the vault."]);
  });

  it("name the agent's setting as its own even where it is called Mode, and isolate a note's name in its direction", async () => {
    await i18n.changeLanguage("en");
    expect(agentEventParts(t, { type: "setting", setting: "Mode", value: "Ask" }, "")).toEqual(["The agent set “", { said: "Mode" }, "” to “", { said: "Ask" }, "” itself."]);
    // A file's name is whatever the vault holds — an agent can make one that turns the line around.
    const turned = `Results${String.fromCharCode(0x202e)}`;
    expect(agentEventParts(t, { type: "note-kept", path: `Health/${turned}.md` }, "")).toEqual([{ name: turned }, " was not named to the agent: it is kept from the cloud or the internet."]);
    // A message that begins with a command in another spelling goes as the agent spells it; any other goes as typed.
    const commands = [{ name: "re\u0301sume\u0301", description: "", hint: null }];
    expect(agentSpelledMessage("/résumé the week", commands)).toBe("/re\u0301sume\u0301 the week");
    expect(agentSpelledMessage("/re\u0301sume\u0301", commands)).toBe("/re\u0301sume\u0301");
    expect(agentSpelledMessage("résumé /résumé", commands)).toBe("résumé /résumé");
    // Read as it goes, without the blanks around it.
    expect(agentSpelledMessage(" \n/résumé the week ", commands)).toBe("/re\u0301sume\u0301 the week");
    // A text of its own with a name the user gave: every value put in after the interpolation.
    expect(sentenceString(t, "ai.agent.config.tip", { agent: "My {{agent}} bot" })).toBe(
      "A setting of My {{agent}} bot: it changes how My {{agent}} bot works, not what Plainva lets through. What My {{agent}} bot does with its own tools is outside Plainva in every mode.",
    );
  });

  it("keep a name the user gave the agent as typed, also where a sentence holds it twice", async () => {
    const m = await mount(() => ({ configOptions: [{ id: "model", name: "Model", category: "model", currentValue: "fast", options: [{ value: "fast", name: "Fast" }] }] }), { harness: { agentLabel: "My {{agent}} bot" } });
    await click(m.h, find(m.container, "ai-agent-start-action"));
    const model = find(m.container, "ai-agent-setting-model")!;
    expect(model.getAttribute("data-tip")).toBe(sentenceString(t, "ai.agent.config.tip", { agent: "My {{agent}} bot" }));
    expect(model.getAttribute("aria-description")).toBe("It changes how My {{agent}} bot works, not what Plainva lets through. What My {{agent}} bot does with its own tools is outside Plainva in every mode.");
  });

  it("draw a note's name in its own direction, in Plainva's type", async () => {
    const m = await mount(undefined, { activeNote: { path: "Health/Results.md", title: "Results" } });
    m.h.vault.active = "Health/Results.md";
    await click(m.h, find(m.container, "ai-agent-start-action"));
    await send(m, "Summarise");
    const line = find(m.container, "ai-agent-event-note-kept")!;
    expect(Array.from(line.querySelectorAll("bdi")).map((name) => [name.textContent, name.className])).toEqual([["Results", ""]]);
  });

  it("place a menu again when any of its entries changes, and tell values apart that look alike when joined", () => {
    const value = (v: string, name = v.toUpperCase()) => ({ value: v, name, description: "" });
    expect(agentValuesKey([value("a|/b")])).not.toBe(agentValuesKey([value("a"), value("b")]));
    expect(agentValuesKey([value("a", "A")])).not.toBe(agentValuesKey([value("a", "A much longer name")]));
    const option = (name: string) => ({ id: "think", name, description: "", category: "other" as const, type: "boolean" as const, current: false });
    expect(agentOptionsKey([option("Think")])).not.toBe(agentOptionsKey([option("Think hard")]));
    // A setting's menu also when the agent renames the setting; the list of commands when it shows others of the same number.
    expect(agentMenuKey(["Mode of Gemini CLI"], [value("a")])).not.toBe(agentMenuKey(["Model of Gemini CLI"], [value("a")]));
    expect(agentCommandsKey([{ name: "web", description: "", hint: null }], 0)).not.toBe(agentCommandsKey([{ name: "plan", description: "", hint: null }], 0));
  });
});
