// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AiOpenWrites, useAiAttention, useAiWaitingCount, useOpenProposals, type AiSession, type AiState } from "@plainva/ui/ai";

/**
 * The AI's waiting dot after a change of vault (C11 of release 0.9.0): the
 * number is the open proposals of the vault that is open now — also where
 * both vaults have no conversation, which made the two keys alike.
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

function fakeSession() {
  const proposalsOf: Record<string, number> = { work: 3, home: 0 };
  let vault = "work";
  const listeners = new Set<() => void>();
  let state = {
    loaded: true,
    hasVault: true,
    vaultEpoch: 1,
    summaries: [],
    settings: { enabled: true },
    drafts: { drafts: [], done: [] },
    skills: { entries: [], omitted: [], servers: [] },
  } as unknown as AiState;
  const session = {
    subscribe: (listener: () => void) => (listeners.add(listener), () => listeners.delete(listener)),
    getState: () => state,
    openProposals: async () => Array.from({ length: proposalsOf[vault] ?? 0 }, (_, i) => ({ path: `${vault}-${i}.md` })),
  } as unknown as AiSession;
  /** What `attachVault` does to the state: another vault, its conversations not read yet. */
  const switchTo = (next: string) => {
    vault = next;
    state = { ...state, vaultEpoch: state.vaultEpoch + 1, summaries: [] } as AiState;
    for (const listener of listeners) listener();
  };
  return { session, switchTo };
}

function Dot({ session }: { session: AiSession }) {
  return <span data-testid="dot">{useAiWaitingCount(session)}</span>;
}

describe("the AI's waiting count", () => {
  it("follows a change to a vault with as many conversations (none) as the one before", async () => {
    const { session, switchTo } = fakeSession();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root!.render(<Dot session={session} />));
    expect(host.textContent).toBe("3");
    await act(async () => switchTo("home"));
    expect(host.textContent).toBe("0");
    await act(async () => switchTo("work"));
    expect(host.textContent).toBe("3");
  });
});

/** The AI's entry beside the segment "To decide" itself, both read from one session. */
function EntryAndSegment({ session }: { session: AiSession }) {
  const state = session.getState();
  const proposals = useOpenProposals(session, "one");
  return (
    <>
      <span data-testid="count">{useAiWaitingCount(session)}</span>
      <span data-testid="attention">{String(useAiAttention(session))}</span>
      <AiOpenWrites state={state.drafts} proposals={proposals} canCreate={false} busy={false} onOpenNote={() => undefined} onCreate={() => undefined} onDiscard={() => undefined} />
    </>
  );
}

describe("the number is what the segment lists (F71 of release 0.9.0, mockup M10)", () => {
  it("counts the notes with proposals the segment shows — not the skills that wait, not the question being asked", async () => {
    const { session } = fakeSession();
    // A skill waits for its approval, and the running conversation asks before it sends: neither stands in the list.
    const state = session.getState() as unknown as Record<string, unknown>;
    state.skills = { entries: [{ id: "s1", status: "waiting", source: { kind: "skill" } }], omitted: [], servers: [] };
    state.consent = { manifest: {} };
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root!.render(<EntryAndSegment session={session} />));
    await act(async () => {
      for (let turns = 0; turns < 6; turns++) await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const rows = host.querySelectorAll('[data-testid="ai-open-proposal"]').length;
    expect(rows).toBe(3);
    expect(host.querySelector('[data-testid="count"]')!.textContent).toBe(String(rows));
    expect(host.querySelector('[data-testid="attention"]')!.textContent).toBe("true");
  });
});

/** The entry's two signs from one session: the number of "To decide", and the dot for what no number counts. */
function Entry({ session }: { session: AiSession }) {
  return (
    <>
      <span data-testid="count">{useAiWaitingCount(session)}</span>
      <span data-testid="attention">{String(useAiAttention(session))}</span>
    </>
  );
}

async function entryOf(patch: Record<string, unknown>, vault: "work" | "home" = "home") {
  const { session, switchTo } = fakeSession();
  if (vault === "home") switchTo("home");
  Object.assign(session.getState() as unknown as Record<string, unknown>, patch);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<Entry session={session} />));
  await act(async () => {
    for (let turns = 0; turns < 6; turns++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return { count: host.querySelector('[data-testid="count"]')!.textContent, attention: host.querySelector('[data-testid="attention"]')!.textContent };
}

const WAITING_SKILL = { skills: { entries: [{ id: "s1", status: "new", source: { kind: "skill", origin: "vault" } }], omitted: [], servers: [] } };

describe("what no number counts still shows at the AI's entry (F71 of release 0.9.0, review of a9fe33ac2)", () => {
  it("a skill waiting for its approval, alone: a dot, no number", async () => {
    expect(await entryOf(WAITING_SKILL)).toEqual({ count: "0", attention: "true" });
  });

  it("a question of the running conversation, alone: a dot, no number", async () => {
    expect(await entryOf({ question: { text: "Which folder?" } })).toEqual({ count: "0", attention: "true" });
  });

  it("a draft and a waiting skill: the number is the draft alone", async () => {
    const got = await entryOf({ ...WAITING_SKILL, drafts: { drafts: [{ id: "d1" }], done: [] } });
    expect(got.count).toBe("1");
  });

  it("nothing at all: neither", async () => {
    expect(await entryOf({})).toEqual({ count: "0", attention: "false" });
  });
});
