// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "@plainva/ui/i18n";
import { DEFAULT_AI_APP_SETTINGS, type AiEgress, type EgressChunk, type HttpRequestSpec } from "@plainva/core/ai";
import { AiConversation, AiSession, AiSessionContext } from "@plainva/ui/ai";
import { useAiSetupDoor } from "../components/ai/useAiSetupDoor";
import { answer, vaultHost } from "./failureClassHarness";

/**
 * The AI setup in three steps on the desktop (plan Oberfläche O7, T9; plan Umsetzung 0.9.x, B7), over the steps the
 * phone's sheet draws (`useAiSetupFlow`): "Set up" in a conversation without a provider opens the dialog, not the
 * settings; a provider and its key, a test that answers, the model, and a first Hello whose answer is in the
 * conversation. Before B7 the desktop's "Set up" opened Settings › AI and nothing else (parity gap ai-setup-guided).
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const settle = async () => {
  await act(async () => {
    for (let turns = 0; turns < 40; turns++) await tick();
  });
};
const q = (id: string) => document.body.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

async function click(id: string): Promise<void> {
  expect(q(id)).toBeTruthy();
  await act(async () => q(id)!.click());
  await settle();
}

async function type(id: string, text: string): Promise<void> {
  const input = q(id) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}

/** A session with nothing set up, whose egress answers later, chunk by chunk, as the native one does. */
function bareSession(script: EgressChunk[][]) {
  const sent: HttpRequestSpec[] = [];
  const keys = new Set<string>();
  const egress: AiEgress = {
    async send(_id, spec, onChunk) {
      sent.push(spec);
      for (const chunk of script.shift() ?? [{ type: "failed", code: "network", message: "x" }]) {
        await tick();
        onChunk(chunk);
      }
    },
    async cancel() {},
    async setKey(id) {
      await tick();
      keys.add(id);
    },
    async hasKey(id) {
      return keys.has(id);
    },
    async deleteKey(id) {
      keys.delete(id);
    },
    async addEndpoint() {
      return true;
    },
    async removeEndpoint() {},
  };
  let stored: unknown = { ...DEFAULT_AI_APP_SETTINGS, enabled: true, providers: [], profiles: {} };
  let ids = 0;
  const s = new AiSession({
    egress,
    async loadSettings() {
      return stored;
    },
    async saveSettings(settings) {
      stored = settings;
    },
    defaults: DEFAULT_AI_APP_SETTINGS,
    language: () => "English",
    today: () => "2026-11-25",
    now: () => new Date("2026-11-25T10:00:00Z"),
    newId: () => `id${++ids}`,
    label: (key) => key,
  });
  s.subscribe(() => {
    if (s.getState().consent) s.answerConsent(true);
  });
  return { s, sent, keys };
}

/** Anthropic's model list, as its endpoint answers the connection test. */
const models: EgressChunk[] = [{ type: "open", status: 200 }, { type: "data", text: JSON.stringify({ data: [{ id: "m-1", display_name: "Model One" }] }) }, { type: "done" }];

function Surface({ session, onOpenSettings }: { session: AiSession; onOpenSettings: () => void }) {
  const setup = useAiSetupDoor(session, onOpenSettings);
  return (
    <AiSessionContext.Provider value={session}>
      <AiConversation dress="tab" activeNote={null} onOpenNote={() => undefined} onOpenUrl={() => undefined} onOpenSettings={setup.open} />
      {setup.dialog}
    </AiSessionContext.Provider>
  );
}

async function show(session: AiSession, onOpenSettings: () => void): Promise<void> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<Surface session={session} onOpenSettings={onOpenSettings} />));
  await settle();
}

describe("the AI setup on the desktop", () => {
  it("leads from Set up through a provider, its key and the model to a first Hello in the conversation", async () => {
    const { s, sent, keys } = bareSession([models, answer("Hello! How can I help?")]);
    await s.load();
    await s.attachVault(vaultHost().host);
    let settingsOpened = 0;
    await show(s, () => settingsOpened++);
    // The conversation's empty state offers "Set up": it opens the three steps, not the settings.
    const setUp = Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent === i18n.t("ai.empty.setupAction"))!;
    expect(setUp).toBeTruthy();
    await act(async () => setUp.click());
    await settle();
    expect(q("ai-setup-dialog")).toBeTruthy();
    expect(settingsOpened).toBe(0);
    // A computer brings no system model: a provider with a key, or an own server.
    expect(q("ai-setup-kind-device")).toBeNull();
    expect(q("ai-setup-kind-cloud")).toBeTruthy();
    expect(q("ai-setup-kind-server")).toBeTruthy();

    await click("ai-setup-next");
    await type("ai-setup-key", "sk-test-123");
    await click("ai-setup-next");
    // Stored and tested: the provider is on the list, its key went into the key store, the test asked its models.
    expect(keys.has(s.getState().settings.providers[0]!)).toBe(true);
    expect(sent).toHaveLength(1);
    expect(q("ai-setup-hello")).toBeTruthy();
    expect((q("ai-setup-hello") as HTMLButtonElement).disabled).toBe(true);

    // The model new conversations start with (the dialog of the settings page), then the Hello.
    await act(async () => s.updateSettings((x) => ({ ...x, profiles: { ...x.profiles, [x.defaultProfile]: { providerId: s.getState().settings.providers[0]!, model: "m-1" } } })));
    await settle();
    await click("ai-setup-hello");
    expect(q("ai-setup-dialog")).toBeNull();
    expect(sent).toHaveLength(2);
    expect(JSON.stringify(sent[1]!.body)).toContain(i18n.t("ai.setup.helloMessage"));
    expect(s.getState().active?.conversation.turns.map((turn) => turn.role)).toEqual(["user", "assistant"]);
  });

  it("opens the settings, not the steps, once a conversation can start", async () => {
    const { s } = bareSession([]);
    await s.load();
    await s.updateSettings((x) => ({ ...x, providers: ["anthropic"], profiles: { [x.defaultProfile]: { providerId: "anthropic", model: "m-1" } } }));
    let settingsOpened = 0;
    const door = { open: () => undefined as void };
    function Probe() {
      const setup = useAiSetupDoor(s, () => settingsOpened++);
      door.open = setup.open;
      return <>{setup.dialog}</>;
    }
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root!.render(<Probe />));
    await act(async () => door.open());
    await settle();
    expect(settingsOpened).toBe(1);
    expect(q("ai-setup-dialog")).toBeNull();
  });
});
