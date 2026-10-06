// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { EgressManifest } from "@plainva/core";
import i18n from "@plainva/ui/i18n";
import { AiSendOverview } from "@plainva/ui";

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

const manifest: EgressManifest = {
  providerId: "anthropic",
  providerLabel: "Anthropic",
  model: "m-1",
  local: false,
  sources: [
    { path: "Projects/Offer.md", title: "Offer", tier: "evidence", section: "Offer > Costs", chars: 800, reasons: ["active"] },
    { path: "Areas/Plan.md", title: "Plan", tier: "card", chars: 120, reasons: ["lexical"] },
  ],
  dataClasses: ["situation", "notes", "calendar"],
  folders: ["Projects", "Areas"],
  withheld: { notes: 1, links: 2, places: 0, moodProperties: 0 },
  excluded: [{ path: "Private/Salaries.md", reason: "cloud-denied" }],
  estimatedTokens: 1240,
  tools: ["search_vault"],
  web: false,
};

describe("AiSendOverview", () => {
  it("names the coverage of the answer it went with (plan P2b-5)", () => {
    void i18n.changeLanguage("en");
    const container = mount(<AiSendOverview manifest={manifest} coverage={{ statements: 5, cited: 4, level: "high" }} />);
    expect(container.querySelector('[data-testid="ai-coverage"]')!.textContent).toBe("coverage high — statements with a source: 4 of 5");
    act(() => root?.unmount());
    const quiet = mount(<AiSendOverview manifest={manifest} coverage={{ statements: 0, cited: 0, level: null }} />);
    expect(quiet.querySelector('[data-testid="ai-coverage"]')).toBeNull();
  });

  it("as the approval: says why it asks, names paths and sections, never the text, and answers through its handlers", () => {
    const onSend = vi.fn();
    const onCancel = vi.fn();
    const onLeaveOut = vi.fn();
    const onOpenNote = vi.fn();
    const onChange = vi.fn();
    const container = mount(
      <AiSendOverview
        manifest={manifest}
        growth={[{ kind: "first" }, { kind: "folder", folder: "Areas" }]}
        onSend={onSend}
        onCancel={onCancel}
        onLeaveOut={onLeaveOut}
        onOpenNote={onOpenNote}
        everyRequest={{ value: false, onChange }}
      />,
    );
    const view = container.querySelector('[data-testid="ai-consent"]')!;
    expect(view).not.toBeNull();
    expect(view.querySelectorAll(".pv-ai-overview-why li")).toHaveLength(2);
    // A kept-back note is counted, never named: its title is not on screen.
    expect(view.textContent).not.toContain("Salaries");
    const notes = Array.from(view.querySelectorAll(".pv-ai-overview-sources li"));
    expect(notes).toHaveLength(2);
    act(() => (notes[0]!.querySelector(".pv-ai-overview-note") as HTMLButtonElement).click());
    expect(onOpenNote).toHaveBeenCalledWith("Projects/Offer.md");
    // Each row: the note (opens it) and the − that leaves it out.
    const [, leaveOut] = Array.from(notes[1]!.querySelectorAll("button"));
    act(() => leaveOut!.click());
    expect(onLeaveOut).toHaveBeenCalledWith("Areas/Plan.md");
    act(() => (view.querySelector('[data-testid="ai-consent-send"]') as HTMLButtonElement).click());
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("names a comment thread as its own row beside its note: what is asked about goes or the request is cancelled (plan P3-6)", async () => {
    await i18n.changeLanguage("en");
    const onLeaveOut = vi.fn();
    const withThread: EgressManifest = {
      ...manifest,
      sources: [{ path: "Projects/Offer.md", title: "Offer", tier: "evidence", chars: 300, reasons: ["active"], comments: 2 }, ...manifest.sources],
      dataClasses: [...manifest.dataClasses, "comments"],
    };
    const container = mount(<AiSendOverview manifest={withThread} growth={[{ kind: "dataClass", dataClass: "comments" }]} onSend={vi.fn()} onCancel={vi.fn()} onLeaveOut={onLeaveOut} />);
    const view = container.querySelector('[data-testid="ai-consent"]')!;
    expect(view.querySelector(".pv-ai-overview-why")!.textContent).toContain("a comment thread");
    // Two rows carry the same path — the thread and the note — and both are there.
    const rows = Array.from(view.querySelectorAll(".pv-ai-overview-sources li"));
    expect(rows).toHaveLength(3);
    expect(rows[0]!.querySelector(".pv-ai-overview-form")!.textContent).toBe("the comment thread (2 comments)");
    expect(rows[0]!.querySelectorAll("button")).toHaveLength(0);
    expect(rows[1]!.querySelectorAll("button")).toHaveLength(1);
    expect(view.textContent).toContain("a comment thread");
    act(() => root?.unmount());

    // A remark that starts a thread on a passage brings the passage and no remarks yet.
    const passage = mount(<AiSendOverview manifest={{ ...withThread, sources: [{ ...withThread.sources[0]!, comments: 0 }] }} />);
    expect(passage.querySelector(".pv-ai-overview-form")!.textContent).toBe("the passage commented on");
  });

  it("as the record under a run line: the same list, no actions", () => {
    const container = mount(<AiSendOverview manifest={manifest} />);
    expect(container.querySelector('[data-testid="ai-overview"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="ai-consent-send"]')).toBeNull();
    expect(container.querySelectorAll(".pv-ai-overview-sources li")).toHaveLength(2);
    expect(container.querySelectorAll(".pv-ai-overview-sources button")).toHaveLength(0);
  });
  it("as the standing approval of search by meaning (plan P2a-5): a count and folders instead of each note, the questions as data", async () => {
    await i18n.changeLanguage("en");
    const onSend = vi.fn();
    const standing: EgressManifest = {
      ...manifest,
      providerId: "openai",
      providerLabel: "OpenAI",
      model: "text-embedding-3-small",
      sources: [],
      dataClasses: ["notes", "searches"],
      folders: ["", "Projects"],
      tools: [],
      standing: { notes: 4700 },
    };
    const container = mount(<AiSendOverview manifest={standing} onSend={onSend} onCancel={vi.fn()} />);
    const view = container.querySelector('[data-testid="ai-consent"]')!;
    expect(view.querySelector(".pv-ai-overview-head")!.textContent).toBe("Search by meaning with OpenAI?");
    expect(view.textContent).toContain("All 4700 notes your rules let go");
    expect(view.textContent).toContain("/ · Projects");
    expect(view.textContent).toContain("your search questions");
    expect(view.querySelectorAll(".pv-ai-overview-sources li")).toHaveLength(0);
    const approve = view.querySelector('[data-testid="ai-consent-send"]') as HTMLButtonElement;
    expect(approve.textContent).toBe("Approve until withdrawn");
    act(() => approve.click());
    expect(onSend).toHaveBeenCalledTimes(1);
  });
});
