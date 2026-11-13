// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { beginIndexBuild, indexBuildState, markIndexFailed, markIndexWhole, reportIndexBuild, resetIndexBuildsForTests } from "@plainva/ui";
import type { IndexWholenessState } from "@plainva/core";

import { installIndexBuildMirror, mirrorOwnerIndexBuild } from "./indexBuildMirror";
import { withinAsync } from "../../../../packages/core/test/helpers/timeBudget";

/**
 * Whether the index of a vault is whole is said by the window that runs the
 * vault and heard by every other window that shows it (performance plan L3,
 * review of 11.11.). Before, a second window had a store of its own that never
 * heard of the build: its planners took half an index for a whole one.
 */
afterEach(() => resetIndexBuildsForTests());

describe("the owner", () => {
  it("answers how whole its index is and says every change, for its vault only", async () => {
    const handlers = new Map<string, () => unknown>();
    const said: Array<{ state: IndexWholenessState; vault: string | null }> = [];
    const bus = {
      handle: async (kind: string, handler: () => unknown) => { handlers.set(kind, handler); return () => handlers.delete(kind); },
      broadcast: async (_channel: string, payload: { state: IndexWholenessState }, vault: string | null) => { said.push({ state: payload.state, vault }); },
    };
    const off = await installIndexBuildMirror(bus as never, "/owner", { vaultPath: "/owner" });
    expect(handlers.get("index-build-state")?.()).toEqual({ kind: "whole" });
    beginIndexBuild("/owner");
    beginIndexBuild("/other");
    reportIndexBuild("/owner", 5, 50);
    await new Promise((resolve) => setTimeout(resolve, 250));
    markIndexWhole("/owner");
    expect(said.every((s) => s.vault === "/owner")).toBe(true);
    // Said once at once, as it stands, then on every change.
    expect(said[0].state).toEqual({ kind: "whole" });
    expect(said[1].state).toEqual({ kind: "building", done: 0, total: 0 });
    expect(said[said.length - 1].state).toEqual({ kind: "whole" });
    expect(said.some((s) => s.state.kind === "building" && s.state.done === 5)).toBe(true);
    off();
    expect(handlers.has("index-build-state")).toBe(false);
  });
});

describe("a client window", () => {
  function fakeBus(answer: () => Promise<IndexWholenessState>) {
    let listener: ((payload: { state: IndexWholenessState }, from: string, vault: string | null) => void) | null = null;
    return {
      bus: {
        onBroadcast: async (_channel: string, handler: typeof listener) => { listener = handler; return () => { listener = null; }; },
        request: async () => answer(),
      },
      say: (state: IndexWholenessState, vault = "/v") => listener?.({ state }, "main", vault),
      listening: () => listener !== null,
    };
  }

  it("takes the owner's answer, then every change it hears for its vault", async () => {
    const fake = fakeBus(async () => ({ kind: "building", done: 1, total: 9 }));
    const stop = await mirrorOwnerIndexBuild(fake.bus as never, "/v");
    await vi.waitFor(() => expect(indexBuildState("/v")).toEqual({ kind: "building", done: 1, total: 9 }));
    fake.say({ kind: "building", done: 2, total: 9 }, "/other");
    expect(indexBuildState("/v")).toEqual({ kind: "building", done: 1, total: 9 });
    fake.say({ kind: "whole" });
    expect(indexBuildState("/v").kind).toBe("whole");
    stop();
    expect(fake.listening()).toBe(false);
  });

  it("a change heard while its question is on the way is newer than the answer", async () => {
    let answer: (state: IndexWholenessState) => void = () => {};
    const fake = fakeBus(() => new Promise<IndexWholenessState>((resolve) => { answer = resolve; }));
    const opening = mirrorOwnerIndexBuild(fake.bus as never, "/v");
    await Promise.resolve();
    fake.say({ kind: "whole" });
    answer({ kind: "building", done: 0, total: 0 });
    await opening;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(indexBuildState("/v").kind).toBe("whole");
  });

  it("closed, it refuses whoever still waits in it", async () => {
    const fake = fakeBus(async () => ({ kind: "building", done: 0, total: 0 }));
    const stop = await mirrorOwnerIndexBuild(fake.bus as never, "/v");
    const { indexWholenessFor } = await import("@plainva/ui");
    const { untilWholeIndex } = await import("@plainva/core");
    const waiting = untilWholeIndex(indexWholenessFor("/v"));
    stop();
    await expect(waiting).rejects.toThrow(/closed/);
  });

  it("is not whole before it has heard the owner, and does not wait for the owner to open", async () => {
    // Unknown is not whole (second review of 11.11.): a question that failed
    // used to leave the vault "as it was" — whole —, and the window waited up
    // to 15 s for an answer before it opened the vault.
    const fake = fakeBus(() => new Promise<IndexWholenessState>(() => {}));
    // The owner never answers: the mirror is installed at once all the same.
    const stop = await withinAsync(1000, () => mirrorOwnerIndexBuild(fake.bus as never, "/v"));
    expect(indexBuildState("/v").kind).toBe("building");
    stop();
  });

  it("asks again where the owner has no answer yet, and stays not whole meanwhile", async () => {
    // The first hold of a vault, windows restored at start: the client asks
    // before the owner's handler exists. Its question fails; it asks again.
    let answers = 0;
    const fake = fakeBus(async () => {
      answers += 1;
      if (answers < 3) throw new Error("no handler for index-build-state");
      return { kind: "whole" };
    });
    const queued: Array<() => void> = [];
    const stop = await mirrorOwnerIndexBuild(fake.bus as never, "/v", { setTimeout: (fn) => { queued.push(fn); return queued.length; }, clearTimeout: () => {} });
    await vi.waitFor(() => expect(queued.length).toBe(1));
    expect(indexBuildState("/v").kind).toBe("building");
    queued.shift()!();
    await vi.waitFor(() => expect(queued.length).toBe(1));
    expect(indexBuildState("/v").kind).toBe("building");
    queued.shift()!();
    await vi.waitFor(() => expect(indexBuildState("/v").kind).toBe("whole"));
    expect(answers).toBe(3);
    stop();
  });

  it("hears that the owner's index failed, also when it failed before the owner's mirror was set up", async () => {
    // The owner says its state when its mirror is installed: a client that
    // asked before that hears "failed" all the same, and says it.
    const said: IndexWholenessState[] = [];
    const ownerBus = {
      handle: async () => () => {},
      broadcast: async (_channel: string, payload: { state: IndexWholenessState }) => { said.push(payload.state); },
    };
    beginIndexBuild("/owner");
    markIndexFailed("/owner", "disk I/O error");
    const off = await installIndexBuildMirror(ownerBus as never, "/owner", { vaultPath: "/owner" });
    expect(said).toEqual([{ kind: "failed", reason: "disk I/O error" }]);
    off();
    const fake = fakeBus(() => new Promise<IndexWholenessState>(() => {}));
    const stop = await mirrorOwnerIndexBuild(fake.bus as never, "/v");
    fake.say(said[0]);
    expect(indexBuildState("/v")).toEqual({ kind: "failed", reason: "disk I/O error" });
    stop();
  });
});
