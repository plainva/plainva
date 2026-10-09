// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "@plainva/ui/i18n";
import { AiSessionContext, SettingRow, type AiSession, type UpkeepRow } from "@plainva/ui";
import { memorySession, memoryVault } from "../../ai/memorySessionHarness";
import { SkillCompareModal } from "./SkillCompareModal";
import { UpkeepCard } from "./UpkeepCard";

/**
 * "Tidy up" on the desktop (plan KI-Harness P6-3, mockup chapter 22, step 7):
 * the card of hints — one step and "don't show again" per row —, and the
 * comparison of two skills with the real session behind it. Nothing here
 * asks a model.
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

function show(node: ReactNode): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}
const settle = async () => {
  await act(async () => {
    for (let turns = 0; turns < 12; turns++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
};
const click = async (el: Element | null | undefined) => {
  await act(async () => {
    (el as HTMLElement).click();
  });
  await settle();
};
const text = (el: Element | null | undefined) => el?.textContent ?? "";
const q = (id: string) => document.body.querySelector(`[data-testid="${id}"]`);
const all = (id: string) => [...document.body.querySelectorAll(`[data-testid="${id}"]`)];

const ALIKE: UpkeepRow = { key: "k-alike", kind: "skills-alike", label: "“client-letter” and “letter-to-client” say almost the same", desc: "Two skills for the same job: the AI picks one or the other.", step: { label: "Compare", what: { do: "compare-skills", a: "a", b: "b" } } };
const FULL: UpkeepRow = { key: "k-full", kind: "active-overflow", label: "“Always included” is full", desc: "Entries that no longer fit: 2.", step: null };

describe("the card of hints", () => {
  it("names how many it holds, gives each row its one step and the way to put it away, and says that no model was asked", async () => {
    const onStep = vi.fn();
    const onDismiss = vi.fn();
    show(<UpkeepCard rows={[ALIKE, FULL]} onStep={onStep} onDismiss={onDismiss} testId="ai-upkeep-skills" />);
    const card = q("ai-upkeep-skills")!;
    expect(text(card.querySelector(".pv-setgroup-label"))).toBe("Tidy up · 2");
    expect(text(card)).toContain("Noticed by this device, without asking a model. Each line is a question, not a finding.");
    const rows = all("ai-upkeep-row");
    expect(rows.map((row) => row.getAttribute("data-kind"))).toEqual(["skills-alike", "active-overflow"]);
    // One step, in the hint's own words — and none where the hint has none.
    expect(rows.map((row) => [...row.querySelectorAll('[data-testid="ai-upkeep-step"]')].map(text))).toEqual([["Compare"], []]);
    // The step is a quiet button: the list below can do the same.
    expect(rows[0]!.querySelector('[data-testid="ai-upkeep-step"]')!.className).toContain("ghost");
    expect(all("ai-upkeep-dismiss").map((button) => button.getAttribute("aria-label"))).toEqual(["Don't show again", "Don't show again"]);

    await click(rows[0]!.querySelector('[data-testid="ai-upkeep-step"]'));
    expect(onStep).toHaveBeenCalledWith(ALIKE);
    await click(all("ai-upkeep-dismiss")[1]);
    expect(onDismiss).toHaveBeenCalledWith("k-full");
  });

  it("is not there while it holds nothing, and can end in a row of the view's own", () => {
    const none = show(<UpkeepCard rows={[]} onStep={() => undefined} onDismiss={() => undefined} testId="ai-upkeep-memory" />);
    expect(none.innerHTML).toBe("");
    act(() => root?.unmount());
    host?.remove();
    show(
      <UpkeepCard rows={[]} onStep={() => undefined} onDismiss={() => undefined} testId="ai-upkeep-memory">
        <SettingRow label="Have the memory looked through" desc="It costs a few requests." />
      </UpkeepCard>,
    );
    // No hint is counted, and the row stands.
    expect(text(q("ai-upkeep-memory")!.querySelector(".pv-setgroup-label"))).toBe("Tidy up");
    expect(text(q("ai-upkeep-memory"))).toContain("Have the memory looked through");
  });
});

const skill = (name: string, description: string, body: string) => `---\nname: ${name}\ndescription: ${description}\nallowed-tools: search_vault read_note\n---\n\n${body}\n`;
const A = ".agent/skills/client-letter";
const B = ".agent/skills/letter-to-client";

async function twoSkills() {
  const vault = memoryVault({
    [`${A}/SKILL.md`]: skill("client-letter", "Drafts a letter to a client in the tone of the last three letters to this client.", "1. Read the last three letters.\n2. Write the letter."),
    [`${B}/SKILL.md`]: skill("letter-to-client", "Drafts a letter to a client in the tone of the last letters to that client.", "1. Read the last letters.\n2. Compose it."),
  });
  const session = await memorySession([], vault);
  for (const entry of (await session.s.refreshSkills()).filter((candidate) => candidate.source.origin === "vault")) {
    await session.s.approveSource(entry.source.id, Object.fromEntries(entry.source.files.map((file) => [file.path, file.sha256])));
  }
  return { vault, ...session };
}
const mountCompare = async (session: AiSession, onClose: () => void) => {
  show(
    <AiSessionContext.Provider value={session}>
      <SkillCompareModal a={A} b={B} onClose={onClose} />
    </AiSessionContext.Provider>,
  );
  await settle();
};

describe("two skills side by side", () => {
  it("shows what each is for and may do, their instructions line against line — and sends nothing", async () => {
    const { s, fake } = await twoSkills();
    await mountCompare(s, () => undefined);
    expect(text(q("ai-skill-compare"))).toContain("“client-letter” and “letter-to-client”");
    const sides = all("ai-skill-compare-side");
    expect(sides).toHaveLength(2);
    expect(text(sides[0])).toContain("in the tone of the last three letters to this client");
    expect(text(sides[1])).toContain("in the tone of the last letters to that client");
    expect(text(q("ai-skill-compare-lines"))).toContain("2. Write the letter.");
    expect(text(q("ai-skill-compare-lines"))).toContain("2. Compose it.");
    expect(text(q("ai-skill-compare"))).toContain("Both are active, so the AI is offered both.");
    expect(fake.sent).toEqual([]);
  });

  it("switching one off is the switch of its row: the device's list, no file — and the dialog has nothing left to compare", async () => {
    const { s, vault } = await twoSkills();
    const onClose = vi.fn();
    await mountCompare(s, onClose);
    const disk = new Map(vault.disk);
    const off = all("ai-skill-compare-off");
    expect(off.map(text)).toEqual(["Switch off “client-letter”", "Switch off “letter-to-client”"]);
    await click(off[1]);
    expect(s.getState().skills.entries.find((entry) => entry.source.id === B)!.status).toBe("off");
    expect(s.getState().skills.entries.find((entry) => entry.source.id === A)!.status).toBe("active");
    expect(new Map(vault.disk)).toEqual(disk);
    expect(onClose).toHaveBeenCalled();
    expect(q("ai-skill-compare")).toBeNull();
  });
});
