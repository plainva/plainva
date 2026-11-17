// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useAiWaitingCount, type AiSession, type AiState } from "@plainva/ui";

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
