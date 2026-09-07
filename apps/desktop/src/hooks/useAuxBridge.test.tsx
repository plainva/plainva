// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { AUX_BRIDGED_EVENTS } from "../services/auxBridge";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Every bridged event has a handler (finding 2026-09-07).
 *
 * `auxBridge.test.ts` proves the table covers what the components dispatch;
 * this file proves the table is not a promise: for each bridged event the
 * hook does what the table says — opens a surface here, asks the owner, or
 * routes to the window with a tree. A table entry without a case below fails
 * the last test, so the two cannot drift apart.
 */

const toasts: string[] = [];
vi.mock("@plainva/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@plainva/ui")>();
  return {
    ...actual,
    toast: {
      info: (m: string) => toasts.push("info:" + m),
      error: (m: string) => toasts.push("error:" + m),
      success: (m: string) => toasts.push("success:" + m),
      warning: (m: string) => toasts.push("warning:" + m),
    },
  };
});

const requests: Array<[string, unknown]> = [];
let revealAnswer: { where: "owner" | "window" | "none" } | "fail" = { where: "owner" };
vi.mock("../services/windowBus", () => ({
  getWindowBus: async () => ({
    request: async (kind: string, args: unknown) => {
      requests.push([kind, args]);
      if (kind === "reveal-in-tree") {
        if (revealAnswer === "fail") throw new Error("no owner");
        return revealAnswer;
      }
      return undefined;
    },
  }),
}));

const files = new Set<string>();
const writes: string[] = [];
vi.mock("../contexts/VaultContext", () => ({
  useVault: () => ({
    vaultPath: "/vault",
    vaultAdapter: {
      exists: async (p: string) => files.has(p),
      createDir: async (p: string) => {
        files.add(p);
      },
      writeTextFile: async (p: string) => {
        writes.push(p);
        files.add(p);
      },
    },
  }),
}));

let askFirst = false;
let confirmAnswer = true;
const confirmed: string[] = [];
vi.mock("../services/linkCreatePrompt", () => ({ getAskBeforeCreateLink: async () => askFirst }));
vi.mock("../services/appDialogs", () => ({
  appConfirm: async (opts: { title: string }) => {
    confirmed.push(opts.title);
    return confirmAnswer;
  },
}));
vi.mock("../services/newNote", () => ({ getConfiguredNoteType: async () => "plain" }));

const routed: Array<{ path: string; from?: string | null }> = [];
vi.mock("../services/openRouting", () => ({
  routeOpenThroughOwner: (path: string, openHere: () => void, opts: { from?: string | null }) => {
    routed.push({ path, from: opts?.from });
    openHere();
    return true;
  },
}));

import { useAuxBridge } from "./useAuxBridge";

const opened: Array<[string, boolean]> = [];
let sidebarRevealed = 0;

function Probe() {
  const bridge = useAuxBridge({
    label: "aux-1",
    openInFocusedPane: (path, newTab) => opened.push([path, newTab]),
    revealRightSidebar: () => {
      sidebarRevealed += 1;
    },
  });
  return (
    <div>
      <div data-testid="compare">{bridge.compareTarget ? JSON.stringify(bridge.compareTarget) : ""}</div>
      <div data-testid="picker">{bridge.templatePickerOpen ? "open" : "closed"}</div>
      <div data-testid="draft">{bridge.mailDraft ? JSON.stringify(bridge.mailDraft) : ""}</div>
      <button data-testid="close-compare" onClick={bridge.closeCompare} />
    </div>
  );
}

let host: HTMLDivElement;
let root: Root;
const text = (id: string) => host.querySelector(`[data-testid="${id}"]`)?.textContent ?? "";

async function fire(name: string, detail?: unknown) {
  await act(async () => {
    window.dispatchEvent(new CustomEvent(name, detail === undefined ? undefined : { detail }));
    // Two ticks: the handlers await the bus and the adapter.
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(async () => {
  toasts.length = 0;
  requests.length = 0;
  routed.length = 0;
  opened.length = 0;
  writes.length = 0;
  confirmed.length = 0;
  files.clear();
  sidebarRevealed = 0;
  askFirst = false;
  confirmAnswer = true;
  revealAnswer = { where: "owner" };
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<Probe />);
  });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  host.remove();
});

/** One case per bridged event — the completeness check at the end walks this map. */
const CASES: Record<string, () => Promise<void>> = {
  "plainva-show-version-history": async () => {
    await fire("plainva-show-version-history", { path: "Notes/A.md" });
    expect(JSON.parse(text("compare"))).toEqual({ kind: "version", path: "Notes/A.md" });
    await act(async () => {
      (host.querySelector('[data-testid="close-compare"]') as HTMLButtonElement).click();
    });
    expect(text("compare")).toBe("");
  },
  "plainva-resolve-conflict": async () => {
    await fire("plainva-resolve-conflict", { path: "Notes/A.CONFLICT.md" });
    expect(JSON.parse(text("compare"))).toEqual({ kind: "conflict", conflictPath: "Notes/A.CONFLICT.md" });
  },
  "plainva-reveal-folder": async () => {
    await fire("plainva-reveal-folder", { path: "Notes/A.md" });
    expect(requests).toEqual([["reveal-in-tree", { path: "Notes/A.md" }]]);
    expect(toasts).toEqual([]);
    // The two empty outcomes are said, not swallowed.
    revealAnswer = { where: "none" };
    await fire("plainva-reveal-folder", { path: "Notes/B.md" });
    expect(toasts[toasts.length - 1]).toMatch(/^info:/);
    revealAnswer = "fail";
    await fire("plainva-reveal-folder", { path: "Notes/C.md" });
    expect(toasts[toasts.length - 1]).toMatch(/^error:/);
  },
  "plainva-create-note-from-link": async () => {
    await fire("plainva-create-note-from-link", { target: "Neu", hostPath: "Host.md", newTab: true });
    expect(writes).toEqual(["Neu.md"]);
    // Opened where the link was clicked, through the owner's routing.
    expect(routed).toEqual([{ path: "Neu.md", from: "aux-1" }]);
    expect(opened).toEqual([["Neu.md", true]]);
    // The ask-first setting is honoured here as in the central window.
    askFirst = true;
    confirmAnswer = false;
    await fire("plainva-create-note-from-link", { target: "Zwei", hostPath: "Host.md" });
    expect(confirmed).toHaveLength(1);
    expect(writes).toEqual(["Neu.md"]);
  },
  "plainva-compose-mail": async () => {
    await fire("plainva-compose-mail", { subject: "Betreff", markdown: "Text", to: "a@b.c" });
    expect(JSON.parse(text("draft"))).toEqual({ subject: "Betreff", markdown: "Text", to: "a@b.c" });
  },
  "plainva-open-template-picker": async () => {
    expect(text("picker")).toBe("closed");
    await fire("plainva-open-template-picker");
    expect(text("picker")).toBe("open");
  },
  "plainva-reveal-properties": async () => {
    await fire("plainva-reveal-properties");
    expect(sidebarRevealed).toBe(1);
  },
  "plainva-open-sync-settings": async () => {
    await fire("plainva-open-sync-settings", { area: "cloudAccounts", accountId: "acc-1" });
    expect(requests).toEqual([["owner-surface", { surface: "settings", provider: undefined, area: "cloudAccounts", accountId: "acc-1" }]]);
  },
  "plainva-encryption-locked": async () => {
    // The sync guard's own notice (no `force`) stays in this window; the
    // person's request from the locked remarks column goes to the owner.
    await fire("plainva-encryption-locked", { vaultPath: "/v" });
    expect(requests).toEqual([]);
    await fire("plainva-encryption-locked", { vaultPath: "/v", force: true });
    expect(requests).toEqual([["owner-surface", { surface: "encryption-unlock", vaultPath: "/v" }]]);
  },
};

describe("what the auxiliary window does with each bridged event", () => {
  for (const [name, run] of Object.entries(CASES)) it(name, run);

  it("has a case for every entry in the table, and no case without one", () => {
    expect(Object.keys(CASES).sort()).toEqual(Object.keys(AUX_BRIDGED_EVENTS).sort());
  });
});
