// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { noteHash, type EgressManifest } from "@plainva/core";
import i18n from "@plainva/ui/i18n";
import { AiSendOverview, type RunSnapshotView } from "@plainva/ui";

/**
 * A past run's line, opened (plan KI-Harness P9-2): the send overview with
 * the run's snapshot — each source by its version and how it reads now, the
 * notes the tools read, the tools used, the skill's version, the result —
 * and "Ask another model…" with the models of this device, or why a run
 * cannot be asked again.
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
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

const OFFER = noteHash("# Offer\n");
const PLAN = noteHash("# Plan\n");
const BUDGET = noteHash("# Budget\n");
const SKILL = noteHash("skill");

const manifest: EgressManifest = {
  providerId: "anthropic",
  providerLabel: "Anthropic",
  model: "m-1",
  local: false,
  sources: [
    { path: "Projects/Offer.md", title: "Offer", tier: "evidence", chars: 800, reasons: ["pinned"], hash: OFFER },
    { path: "Projects/Plan.md", title: "Plan", tier: "card", chars: 120, reasons: ["lexical"], hash: PLAN },
    { path: "Areas/Studio.md", title: "Studio", tier: "map", chars: 0, reasons: ["lexical"] },
  ],
  dataClasses: ["situation", "notes"],
  folders: ["Projects", "Areas"],
  withheld: { notes: 1, links: 0, places: 0, moodProperties: 0 },
  excluded: [{ path: "Private/Salary.md", reason: "cloud-denied" }],
  estimatedTokens: 1240,
  tools: ["search_vault", "read_note"],
  web: false,
};

function snapshot(over: Partial<RunSnapshotView> = {}): RunSnapshotView {
  return {
    at: "2026-10-25T09:14:00Z",
    states: { sources: { "Projects/Offer.md": "changed", "Projects/Plan.md": "same" }, read: { "Projects/Budget.md": "gone" }, skills: { "plainva:project-status": "same" } },
    read: [
      { path: "Projects/Budget.md", title: "Budget", hash: BUDGET },
      { path: "Projects/Hit.md", title: "Hit" },
    ],
    readMore: false,
    tools: [
      { name: "search_vault", count: 1 },
      { name: "read_note", count: 2 },
    ],
    skills: [{ id: "plainva:project-status", name: "project-status", hash: SKILL }],
    result: { rounds: 1, drafts: 2, plans: 0 },
    replay: { choices: [{ key: "fast", label: "Fast", hint: "Anthropic · m-2", choice: { providerId: "anthropic", model: "m-2" } }], onReplay: vi.fn() },
    ...over,
  };
}

const text = (container: HTMLElement, id: string) => container.querySelector(`[data-testid="${id}"]`)?.textContent ?? null;

describe("a run's snapshot in its opened line", () => {
  it("names each source's version and how it reads now; a handle, which read nothing, has none", () => {
    void i18n.changeLanguage("en");
    const container = mount(<AiSendOverview manifest={manifest} snapshot={snapshot()} />);
    const rows = [...container.querySelectorAll(".pv-ai-overview-sources")][0]!.querySelectorAll("li");
    expect(rows[0]!.textContent).toContain(`version ${OFFER.slice(0, 7)}`);
    expect(rows[0]!.textContent).toContain("changed since");
    expect(rows[1]!.textContent).toContain(`version ${PLAN.slice(0, 7)}`);
    expect(rows[1]!.textContent).toContain("unchanged");
    expect(rows[2]!.textContent).not.toContain("version");
    expect(rows[2]!.querySelector('[data-testid="ai-snapshot-state"]')).toBeNull();
    // Never more of a hash than its short form.
    expect(container.textContent).not.toContain(OFFER);
  });

  it("says when it was asked, what the tools read, which tools it used, its skill's version and what it left", () => {
    void i18n.changeLanguage("en");
    const container = mount(<AiSendOverview manifest={manifest} snapshot={snapshot()} />);
    expect(text(container, "ai-snapshot-asked")).toMatch(/2026|Oct/);
    const read = text(container, "ai-snapshot-read")!;
    expect(read).toContain(`Budget`);
    expect(read).toContain("no longer there");
    expect(read).toContain("found by a search");
    expect(text(container, "ai-snapshot-used")).toBe("Searching the vault ×1 · Reading a note ×2");
    const skills = text(container, "ai-snapshot-skills")!;
    expect(skills).toContain("Project status");
    expect(skills).toContain(`version ${SKILL.slice(0, 7)}`);
    expect(skills).toContain("unchanged");
    expect(text(container, "ai-snapshot-result")).toBe("the answer · 1 suggestion · 2 drafts");
  });

  it("offers the models of this device for the same question, and counts what changed since", () => {
    void i18n.changeLanguage("en");
    const onReplay = vi.fn();
    const replay = { choices: [{ key: "fast", label: "Fast", hint: "Anthropic · m-2", choice: { providerId: "anthropic", model: "m-2" } }], onReplay };
    const container = mount(<AiSendOverview manifest={manifest} snapshot={snapshot({ replay })} />);
    expect(text(container, "ai-snapshot-replay")).toContain("1 of them changed since and goes as it is now.");
    act(() => (container.querySelector('[data-testid="ai-snapshot-replay-open"]') as HTMLButtonElement).click());
    const item = [...document.querySelectorAll('[role="menuitem"]')].find((element) => element.textContent?.includes("Fast"))! as HTMLButtonElement;
    expect(item.textContent).toContain("Anthropic · m-2");
    act(() => item.click());
    expect(onReplay).toHaveBeenCalledWith({ providerId: "anthropic", model: "m-2" });
  });

  it("says why a run cannot be asked again, and offers nothing then", () => {
    void i18n.changeLanguage("en");
    const container = mount(<AiSendOverview manifest={manifest} snapshot={snapshot({ replay: { refused: "later" } })} />);
    expect(text(container, "ai-snapshot-replay-refused")).toBe("Only the first question of a conversation can be asked again: a later one rests on what was said before.");
    expect(container.querySelector('[data-testid="ai-snapshot-replay-open"]')).toBeNull();
  });

  it("shows nothing of a snapshot where the overview asks before sending", () => {
    void i18n.changeLanguage("en");
    const container = mount(<AiSendOverview manifest={manifest} onSend={() => {}} onCancel={() => {}} />);
    for (const id of ["ai-snapshot-asked", "ai-snapshot-read", "ai-snapshot-used", "ai-snapshot-result", "ai-snapshot-replay"]) expect(container.querySelector(`[data-testid="${id}"]`), id).toBeNull();
  });
});
