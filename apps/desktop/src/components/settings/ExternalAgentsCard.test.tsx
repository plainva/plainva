// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "@plainva/ui/i18n";
import type { AiSession } from "@plainva/ui";
import { acpHarness, lastOf, type AcpHarness } from "../../ai/acpTestHost";
import { ExternalAgentsCard } from "./ExternalAgentsCard";

/**
 * Settings → AI & automation → "External agents" with the real controller
 * behind it (plan KI-Harness P4.6): what the card shows is what the native
 * registry holds and what is installed, and what the user does on it reaches
 * the registry only through the native dialog.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { appConfirm, current } = vi.hoisted(() => ({ appConfirm: vi.fn(async (_options: { title: string; message: string }) => true), current: { session: null as unknown } }));
vi.mock("../../services/appDialogs", () => ({ appConfirm }));
vi.mock("../../services/ai/desktopAi", () => ({ getDesktopAiSession: () => current.session }));

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  appConfirm.mockClear();
});

/** Just enough of the assistant's session for the card: its agents, and whether the device is fully local. */
function sessionOver(h: AcpHarness, localOnly: boolean): AiSession {
  const settings = { localOnly };
  let state = { agents: h.state(), settings };
  return {
    agents: h.agents,
    subscribe: (listener: () => void) => h.subscribe(listener),
    getState: () => {
      if (state.agents !== h.state()) state = { agents: h.state(), settings };
      return state;
    },
  } as unknown as AiSession;
}

async function mount(h: AcpHarness, localOnly = false): Promise<void> {
  await i18n.changeLanguage("en");
  current.session = sessionOver(h, localOnly);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<ExternalAgentsCard />);
    await h.settle();
  });
}

const $ = <T extends HTMLElement = HTMLElement>(testId: string) => document.querySelector<T>(`[data-testid="${testId}"]`);
const $$ = <T extends HTMLElement = HTMLElement>(testId: string) => Array.from(document.querySelectorAll<T>(`[data-testid="${testId}"]`));
async function click(h: AcpHarness, el: Element | null | undefined) {
  await act(async () => {
    (el as HTMLElement).click();
    await h.settle();
    await h.settle();
  });
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

describe("the card of external agents", () => {
  it("says what an agent is and what Plainva does not do for one, and lists what was added with the command it starts", async () => {
    const h = await acpHarness();
    await mount(h);
    const text = host!.textContent!;
    expect(text).toContain("An agent is a program of another maker that you installed and signed in to yourself.");
    expect(text).toContain("Plainva installs no agent and keeps no credential of one.");
    expect(text).toContain("Gemini CLI");
    expect(text).toContain("/usr/bin/gemini --acp · How it writes has not been seen on this computer yet");
  });

  it("offers an installed agent it knows by name, and adds it only through the system's dialog", async () => {
    const h = await acpHarness();
    await mount(h);
    expect(host!.textContent).toContain("Found on this computer · /usr/local/bin/codex-acp");
    h.native.confirm = false;
    await click(h, $("settings-ai-agent-add-found"));
    // The dialog showed the file and the arguments; the user said no, and nothing was added.
    expect(lastOf(h.native.shown)).toMatchObject({ id: "codex", program: "/usr/local/bin/codex-acp", args: [] });
    expect(lastOf(h.native.shown)!.text.message).toContain("It runs with your rights and is not fenced in.");
    expect(h.state().agents.map((agent) => agent.id)).toEqual(["geminicli"]);
    h.native.confirm = true;
    await click(h, $("settings-ai-agent-add-found"));
    expect(h.state().agents.map((agent) => agent.label)).toEqual(["Codex", "Gemini CLI"]);
    expect($("settings-ai-agent-add-found")).toBeNull();
  });

  it("adds an agent of the user's own by its command, one argument per line", async () => {
    const h = await acpHarness(undefined, { add: false });
    h.native.installed = {};
    await mount(h);
    expect(host!.textContent).toContain("No agent added yet.");
    await click(h, $("settings-ai-agent-add"));
    expect($("ai-agent-add-submit")!.hasAttribute("disabled")).toBe(true);
    type($("ai-agent-add-name"), "My agent");
    type($("ai-agent-add-program"), "/home/mara/bin/my-agent");
    type($("ai-agent-add-args"), "--stdio\n\n  --model=small  \n");
    await click(h, $("ai-agent-add-submit"));
    expect(h.native.shown).toEqual([{ id: "myagent", program: "/home/mara/bin/my-agent", args: ["--stdio", "--model=small"], text: expect.objectContaining({ title: "Add this agent?" }) as unknown }]);
    expect(h.state().agents).toEqual([{ id: "myagent", label: "My agent", program: "/home/mara/bin/my-agent", args: ["--stdio", "--model=small"], known: null }]);
    expect($("ai-agent-add")).toBeNull();
  });

  it("removes an agent after asking, and says that its program and its sign-in stay", async () => {
    const h = await acpHarness();
    await mount(h);
    appConfirm.mockResolvedValueOnce(false);
    await click(h, $$("settings-ai-agent-remove")[0]);
    expect(appConfirm.mock.calls[0]![0]).toMatchObject({ title: "Remove Gemini CLI?", message: "Plainva forgets how to start it. The program itself and its sign-in stay as they are." });
    expect(h.state().agents).toHaveLength(1);
    await click(h, $$("settings-ai-agent-remove")[0]);
    expect(h.state().agents).toEqual([]);
    expect(h.native.registry).toEqual([]);
  });

  it("says that it rests while the device is fully local, and keeps what was added", async () => {
    const h = await acpHarness();
    await mount(h);
    expect(host!.textContent).not.toContain("Rests while “Fully local” is on.");
    act(() => root?.unmount());
    host?.remove();
    await mount(h, true);
    expect(host!.textContent).toContain("Rests while “Fully local” is on.");
    // Resting is not removing: the agent that was added is still listed, with its command.
    expect(host!.textContent).toContain("Gemini CLI");
    expect(h.state().agents).toHaveLength(1);
  });

  it("shows nothing where the shell hosts no agents", async () => {
    const h = await acpHarness(undefined, { add: false });
    h.native.broken = true;
    await h.agents.refresh();
    await mount(h);
    expect(host!.textContent).toBe("");
  });
});
