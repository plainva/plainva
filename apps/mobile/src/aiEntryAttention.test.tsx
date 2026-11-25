// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "@plainva/ui/i18n";
import type { AiSession, AiState } from "@plainva/ui";

/**
 * The phone's AI entry — its tab in the bar and its row in the areas sheet (F71 of release 0.9.0, mockup M10, review
 * of a9fe33ac2): the number is what "To decide" lists; what no number counts — a question of the running conversation,
 * a skill waiting for its approval — still shows, as a dot without a number, and the entry says that something waits.
 */

let state: AiState;
const listeners = new Set<() => void>();
const session = {
  subscribe: (listener: () => void) => (listeners.add(listener), () => listeners.delete(listener)),
  getState: () => state,
  openProposals: async () => [],
} as unknown as AiSession;
vi.mock("./services/ai/mobileAi", async (orig) => ({ ...(await orig<Record<string, unknown>>()), getMobileAiSession: () => session }));

const { NavBar } = await import("./components/NavBar");
const { AreasSheet } = await import("./components/AreasSheet");
const { TAB_POOL } = await import("./navigation");

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

function given(patch: Record<string, unknown>) {
  state = {
    loaded: true,
    hasVault: true,
    vaultEpoch: 1,
    summaries: [],
    settings: { enabled: true },
    drafts: { drafts: [], done: [] },
    skills: { entries: [], omitted: [], servers: [] },
    ...patch,
  } as unknown as AiState;
}

const noop = () => undefined;
async function entry() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const ids = TAB_POOL.map((d) => d.id);
  const tabs = ["ai", ...ids.filter((id) => id !== "ai")].slice(0, 4) as typeof ids;
  await act(async () => {
    root!.render(
      <>
        <NavBar activeTab={tabs[1]!} areasOpen={false} navCollapsed={false} onOpenAreas={noop} onOpenSettings={noop} onPick={noop} tabs={tabs} />
        <AreasSheet active={tabs[1]!} onPick={noop} onArrange={noop} onClose={noop} />
      </>,
    );
  });
  await act(async () => {
    for (let turns = 0; turns < 6; turns++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const dot = host.querySelector('[data-testid="tab-ai-dot"]');
  const tab = dot?.closest("button") ?? null;
  return {
    dot: dot !== null,
    tabLabel: tab?.getAttribute("aria-label") ?? null,
    areaCount: host.querySelector('[data-testid="areas-ai-waiting"]')?.textContent ?? null,
    areaSays: host.querySelector('[data-testid="areas-ai-attention"]')?.textContent ?? null,
  };
}

const WAITING_SKILL = { skills: { entries: [{ id: "s1", status: "new", source: { kind: "skill", origin: "vault" } }], omitted: [], servers: [] } };

describe("the phone's AI entry", () => {
  it("only a skill waits for its approval: a dot without a number, and the entry says that something waits", async () => {
    given(WAITING_SKILL);
    const got = await entry();
    expect(got.dot).toBe(true);
    expect(got.areaCount).toBeNull();
    expect(got.areaSays).toBe(i18n.t("ai.waitingSomething"));
    expect(got.tabLabel).toContain(i18n.t("ai.waitingSomething"));
  });

  it("only the running conversation asks: a dot, and the entry says so", async () => {
    given({ question: { text: "Which folder?" } });
    const got = await entry();
    expect(got.dot).toBe(true);
    expect(got.areaSays).toBe(i18n.t("ai.waitingSomething"));
    expect(got.tabLabel).toContain(i18n.t("ai.waitingSomething"));
  });

  it("a draft and a waiting skill: the number is the draft alone", async () => {
    given({ ...WAITING_SKILL, drafts: { drafts: [{ id: "d1" }], done: [] } });
    const got = await entry();
    expect(got.areaCount).toBe(i18n.t("ai.waitingCount", { count: 1 }));
    expect(got.areaSays).toBeNull();
    expect(got.tabLabel).toContain(i18n.t("ai.waitingCount", { count: 1 }));
  });
});
