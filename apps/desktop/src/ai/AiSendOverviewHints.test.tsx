// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "@plainva/ui/i18n";
import { SITUATION_SOURCE, type EgressManifest } from "@plainva/core";
import { AiSendOverview } from "@plainva/ui";

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const manifest: EgressManifest = {
  providerId: "p",
  providerLabel: "Provider",
  model: "m",
  local: false,
  sources: [
    { path: "Finance/Rent.md", title: "Rent", tier: "evidence", section: "Rent", chars: 120, reasons: ["lexical"], sensitive: ["credential", "account"] },
    { path: "Health/Checkup.md", title: "Checkup", tier: "card", section: "Check-up", chars: 80, reasons: ["semantic"], sensitive: ["health"] },
    { path: "Plan.md", title: "Plan", tier: "evidence", chars: 20, reasons: ["active"], selection: true, sensitive: ["card"] },
  ],
  sensitive: ["credential", "account", "health"],
  situationHint: { sensitive: ["account"], redacted: 1 },
  dataClasses: ["situation", "notes", "tasks"],
  folders: ["Finance", "Health"],
  withheld: { notes: 0, links: 0, places: 0, moodProperties: 0, sensitive: 1 },
  excluded: [],
  estimatedTokens: 300,
  tools: [],
  web: false,
};

function mount(onRedact = vi.fn()) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <AiSendOverview manifest={manifest} growth={[{ kind: "sensitive", sensitive: ["credential", "account", "health"] }]} onSend={vi.fn()} onCancel={vi.fn()} onRedact={onRedact} />,
    ),
  );
  return { el: host, onRedact };
}

/** Plan KI-Harness P2b-6: the overview names what looks sensitive, and offers redaction where it can work. */
describe("sensitivity hints in the send overview", () => {
  it("says why it asks, marks each source, and counts what went redacted", async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
    const { el } = mount();
    expect(el.textContent).toContain("Possibly sensitive, marked below: password or key · account number · health details");
    const hints = [...el.querySelectorAll('[data-testid="ai-overview-sensitive"]')].map((n) => n.textContent);
    expect(hints).toEqual([
      "Possibly sensitive: password or key · account numberRedact in this conversation",
      "Possibly sensitive: health details",
      "Possibly sensitive: card number",
      "Possibly sensitive: account numberSend unredacted",
    ]);
    expect(el.textContent).toContain("1 redacted number or secret");
  });

  it("redacts a note or the situation through the reader's choice, never a selected passage", () => {
    const { el, onRedact } = mount();
    const buttons = [...el.querySelectorAll<HTMLButtonElement>('[data-testid="ai-overview-redact"]')];
    expect(buttons).toHaveLength(2);
    act(() => buttons[0]!.click());
    act(() => buttons[1]!.click());
    expect(onRedact.mock.calls).toEqual([["Finance/Rent.md"], [SITUATION_SOURCE]]);
  });
});
