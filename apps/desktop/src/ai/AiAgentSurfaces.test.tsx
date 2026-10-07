// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ScriptedAcpStep } from "@plainva/core";
import i18n from "@plainva/ui/i18n";
import {
  agentArgsFromText,
  agentAuthProblemText,
  agentEventText,
  agentEventTone,
  agentNoteName,
  agentOptionsInOrder,
  agentOptionText,
  agentProblemText,
  agentSeenText,
  agentSessionLine,
  AiAgentView,
  AiSessionContext,
  type AcpSessionEvent,
  type AiSession,
} from "@plainva/ui";
import { acpHarness, AGENT_NOTES, lastOf, memoryAcpVault, ROOT, type AcpHarness, type AcpScript } from "./acpTestHost";

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

/** Just enough of the assistant's session for the agent's place: its agents, and whether Plainva's tools are switched on. */
function sessionOver(h: AcpHarness, mcpEnabled: boolean): AiSession {
  let state = { agents: h.state(), settings: { mcpEnabled } };
  return {
    agents: h.agents,
    subscribe: (listener: () => void) =>
      h.subscribe(() => {
        state = { agents: h.state(), settings: { mcpEnabled } };
        listener();
      }),
    getState: () => {
      if (state.agents !== h.state()) state = { agents: h.state(), settings: { mcpEnabled } };
      return state;
    },
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
    expect(find(m.container, "ai-agent-event-direct")!.textContent).toBe("The agent changed Projects/Notes.md itself: it is in the vault without a suggestion.");
    expect(find(m.container, "ai-agent-event-refused")!.textContent).toBe("Plainva did not hand Health/Results.md to the agent: kept from the cloud.");
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

  it("lets the user create or throw away a note the agent wrote, and opens the one that was created", async () => {
    const m = await mount(turns([{ write: { path: `${ROOT}/Projects/Summary.md`, content: "# Summary\n" } }, { write: { path: `${ROOT}/Projects/Other.md`, content: "# Other\n" } }]));
    await click(m.h, find(m.container, "ai-agent-start-action"));
    await send(m, "Write");
    expect(all(m.container, "ai-agent-pending-note").map((row) => row.querySelector(".pv-ai-overview-note")!.textContent)).toEqual(["Projects/Summary.md", "Projects/Other.md"]);
    expect(find(m.container, "ai-agent-pending")!.textContent).toContain("A note is written only when you create it.");
    expect(m.h.vault.created).toEqual([]);
    await click(m.h, all(m.container, "ai-agent-pending-create")[0]);
    expect(m.h.vault.created).toEqual(["Projects/Summary.md"]);
    expect(m.opened.paths).toEqual(["Projects/Summary.md"]);
    await click(m.h, find(m.container, "ai-agent-pending-discard"));
    expect(find(m.container, "ai-agent-pending")).toBeNull();
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
    expect(find(m.container, "ai-agent-auth-command")!.textContent).toBe("/usr/bin/gemini --acp login");
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
      [{ type: "note-kept", path: "Health/Results.md" }, "Results was not named to the agent: it is kept from the cloud."],
      [{ type: "refused", what: "write", reason: "properties", path: "Projects/Plan.md" }, "Plainva did not take the agent's change to Projects/Plan.md: would change the note's properties."],
      [{ type: "refused", what: "read", reason: "outside", path: "/etc/passwd" }, "Plainva did not hand /etc/passwd to the agent: outside this vault."],
      [{ type: "stopped", reason: "max_tokens" }, "The agent stopped: its model reached its limit."],
      [{ type: "stopped", reason: "cancelled" }, "Stopped."],
      [{ type: "failed", message: "" }, "The agent could not finish this."],
      [{ type: "failed", message: "quota" }, "The agent could not finish this. It says: quota"],
    ];
    for (const [event, text] of cases) expect(agentEventText(t, event, lint)).toBe(text);
    expect(agentEventTone({ type: "refused", what: "read", reason: "kept", path: "x" })).toBe("failed");
    expect(agentEventTone({ type: "direct", path: "x" })).toBe("notice");
    expect(agentEventTone({ type: "stopped", reason: "cancelled" })).toBe("done");
    expect(agentEventTone({ type: "stopped", reason: "refusal" })).toBe("notice");
    expect(agentEventTone({ type: "proposed", path: "x", blocks: 1, defused: 0 })).toBe("done");
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
