// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LONG_MEMORY_FILE, type EgressChunk } from "@plainva/core";
import i18n from "@plainva/ui/i18n";
import { AiSessionContext, closeLearnSurface, openLearnSurface, type AiSession, type LearnSurface } from "@plainva/ui";
import { turn } from "../../ai/mcpSessionHarness";
import { memorySession, memoryVault } from "../../ai/memorySessionHarness";
import { LearnDialogs } from "./LearnDialogs";

/**
 * Learning's dialogs on the desktop (plan KI-Harness P6-2, mockup chapter
 * 22), with the real session behind them and a scripted model: what the
 * dialog says before a review, what it shows after one, how a skill's draft
 * is reviewed and accepted, and the way back to an earlier version. The
 * phone's sheets are the same hooks in another frame.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SKILL_ID = ".agent/skills/offer-check";
const SKILL_PATH = `${SKILL_ID}/SKILL.md`;
const HEAD = ["---", "name: offer-check", "description: Checks an offer against last year's rates.", "allowed-tools: search_vault read_note", "metadata:", "  plainva.folders: Projects/", "---"].join("\n");
const OLD_BODY = "1. Read the offer.\n2. Compare each position with last year's rates.";
const NEW_BODY = `${OLD_BODY}\n3. Check the tax rate of each position.`;
const SKILL = `${HEAD}\n\n${OLD_BODY}\n`;
const proposals = (list: unknown[]) => JSON.stringify({ proposals: list });
const MEMORY = { kind: "memory", text: "Harbour Studio is billed per episode.", why: "The user said they pay per episode." };
const RULE = { kind: "rule", text: "Always name the paragraph in tax questions.", why: "The user asked twice where it says that." };
const BETTER = { kind: "skill", name: "offer-check", instructions: NEW_BODY, why: "The skill ran and did not check the tax rate." };
const NEW_SKILL = { kind: "skill", name: "fair-follow-up", description: "Writes the follow-up after a trade fair.", instructions: "1. Collect the contacts.", why: "The user walked through it by hand." };

let root: Root | null = null;
let host: HTMLElement | null = null;
const opened: LearnSurface[] = [];

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

afterEach(() => {
  act(() => {
    for (const surface of opened.splice(0)) closeLearnSurface(surface);
    root?.unmount();
  });
  host?.remove();
  root = null;
  host = null;
});

const settle = async () => {
  await act(async () => {
    for (let turns = 0; turns < 12; turns++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
};
const q = (id: string) => document.body.querySelector(`[data-testid="${id}"]`);
const all = (id: string) => [...document.body.querySelectorAll(`[data-testid="${id}"]`)];
const text = (el: Element | null | undefined) => el?.textContent ?? "";
const click = async (el: Element | null | undefined) => {
  await act(async () => {
    (el as HTMLElement).click();
  });
  await settle();
};
const type = async (el: Element | null, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, value);
    el!.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

async function mount(session: AiSession, surface: LearnSurface, opens: string[] = []) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      <AiSessionContext.Provider value={session}>
        <LearnDialogs onOpenPath={(path) => void opens.push(path)} />
      </AiSessionContext.Provider>,
    );
  });
  opened.push(surface);
  act(() => openLearnSurface(surface));
  await settle();
}

/** A vault with an approved skill, a conversation that ran it, and whatever the review answers. */
async function withSkill(answers: EgressChunk[][]) {
  const vault = memoryVault({ [SKILL_PATH]: SKILL });
  const session = await memorySession([turn({ text: "Checked." }), ...answers], vault);
  const entry = (await session.s.refreshSkills()).find((candidate) => candidate.source.id === SKILL_ID)!;
  await session.s.approveSource(SKILL_ID, Object.fromEntries(entry.source.files.map((file) => [file.path, file.sha256])));
  await session.s.runSkill(SKILL_ID, "Check the offer for Harbour Studio.");
  return { vault, ...session, conversation: session.s.getState().active!.id };
}

describe("“Learn from this conversation”", () => {
  it("says what goes where before anything is sent, starts on the button, and shows what came back", async () => {
    const vault = memoryVault({});
    const { s, fake } = await memorySession([turn({ text: "They are billed per episode." }), turn({ text: proposals([MEMORY, RULE]) })], vault);
    await s.send("How is Harbour Studio billed? They pay per episode.");
    await mount(s, { kind: "learn", conversationId: s.getState().active!.id });

    expect(text(q("ai-learn-recipient"))).toContain("m-1");
    expect(text(q("ai-learn-kinds"))).toBe("Entries for the memory · Rules · A skill, or other instructions for one");
    expect(text(q("ai-learn-plan"))).toContain("2 messages: what you wrote and what was answered.");
    expect(text(q("ai-learn-plan"))).toContain("Nothing a tool returned, and no note that went along as context.");
    expect(text(q("ai-learn"))).toContain("Nothing it suggests counts before you accept it.");
    // Looking sent nothing: the conversation's own request is the only one so far.
    expect(fake.sent).toHaveLength(1);

    await click(q("ai-learn-start"));
    expect(fake.sent).toHaveLength(2);
    expect(text(q("ai-learn-lead"))).toContain("m-1 read the conversation once more — the same model that led it; it went nowhere else.");
    expect(text(q("ai-learn-usage"))).toMatch(/tokens sent · ~\d+ received/);
    const cards = all("ai-draft");
    expect(cards.map((card) => card.getAttribute("data-kind"))).toEqual(["memory", "rule"]);
    expect(text(cards[0]!.querySelector('[data-testid="ai-draft-why"]'))).toBe(MEMORY.why);
    expect(q("ai-learn-start")).toBeNull();

    // Decided in the dialog: the entry is written, and the card becomes the line that says so.
    await click(cards[0]!.querySelector('[data-testid="ai-draft-create"]'));
    expect(vault.file(LONG_MEMORY_FILE)).toContain(MEMORY.text);
    expect(all("ai-draft").map((card) => card.getAttribute("data-kind"))).toEqual(["rule"]);
    expect(text(q("ai-draft-done"))).toContain("Remembered:");
  });

  it("says why a conversation cannot be learned from, and offers no start", async () => {
    const vault = memoryVault({});
    const { s, fake } = await memorySession([], vault);
    await mount(s, { kind: "learn", conversationId: "c-none" });
    expect(text(q("ai-learn-refused"))).toBe("This conversation is not there any more.");
    expect(q("ai-learn-start")).toBeNull();
    expect(fake.sent).toHaveLength(0);
  });

  it("says so where the conversation showed nothing worth keeping", async () => {
    const vault = memoryVault({});
    const { s } = await memorySession([turn({ text: "Hello." }), turn({ text: proposals([]) })], vault);
    await s.send("Hello?");
    await mount(s, { kind: "learn", conversationId: s.getState().active!.id });
    await click(q("ai-learn-start"));
    expect(text(q("ai-learn-none"))).toContain("Nothing worth keeping in this conversation");
    expect(all("ai-draft")).toEqual([]);
  });
});

describe("a skill's draft under review", () => {
  it("is reviewed over the result it came from: what changes, what stays, and “Accept” writes what was reworked there", async () => {
    const { s, vault, conversation } = await withSkill([turn({ text: proposals([BETTER]) })]);
    await mount(s, { kind: "learn", conversationId: conversation });
    expect(text(q("ai-learn-plan"))).toContain("The instructions of offer-check, so that a better version can be suggested.");
    await click(q("ai-learn-start"));
    const card = q("ai-draft")!;
    expect(card.getAttribute("data-kind")).toBe("skill");
    expect(text(card.querySelector('[data-testid="ai-draft-title"]'))).toBe("offer-check — other instructions");
    expect(text(card.querySelector('[data-testid="ai-draft-skill-rights"]'))).toBe("Only its instructions change. What it may do stays as it is.");
    // A skill is accepted where its text is shown: the card has no button that writes.
    expect(card.querySelector('[data-testid="ai-draft-create"]')).toBeNull();

    opened.push({ kind: "skill-draft", draftId: card.getAttribute("data-draft")! });
    await click(card.querySelector('[data-testid="ai-draft-review"]'));
    const review = q("ai-skill-draft")!;
    expect(text(review)).toContain("Other instructions for “offer-check”");
    expect(text(q("ai-skill-draft-changes"))).toContain("+ 3. Check the tax rate of each position.");
    const rights = text(q("ai-skill-draft-rights"));
    expect(rights).toContain("Unchanged.");
    expect(rights).toContain("Uses: ");
    expect(rights).toContain("Projects/");
    expect(rights).toContain("A suggestion changes the instructions only.");
    expect(text(q("ai-skill-draft-cost"))).toMatch(/^About \d+ tokens more in every run of this skill\.$/);
    expect(text(q("ai-skill-draft-why"))).toBe(BETTER.why);
    expect(text(review)).toContain("Suggested by ");
    // The result is still there underneath.
    expect(q("ai-learn-lead")).not.toBeNull();

    await click(q("ai-skill-draft-rework"));
    const field = q("ai-skill-draft-body") as HTMLTextAreaElement;
    expect(field.value).toBe(NEW_BODY);
    await type(field, `${NEW_BODY}\n4. Say what is still open.`);
    await click(q("ai-skill-draft-rework"));
    // Back at the comparison, with what was typed.
    expect(text(q("ai-skill-draft-changes"))).toContain("+ 4. Say what is still open.");
    await click(q("ai-skill-draft-take"));

    expect(vault.file(SKILL_PATH)).toBe(`${HEAD}\n\n${NEW_BODY}\n4. Say what is still open.\n`);
    expect(q("ai-skill-draft")).toBeNull();
    // And the result says what became of the draft.
    expect(text(q("ai-draft-done"))).toBe("Accepted: offer-check");
    expect(s.getState().skills.entries.find((entry) => entry.source.id === SKILL_ID)!.approval).toMatchObject({ how: "learned", observe: { runs: 0 } });
  });

  it("cannot be accepted once the skill is no longer what the suggestion read, and says why", async () => {
    const { s, vault, conversation } = await withSkill([turn({ text: proposals([BETTER]) })]);
    await s.learnFrom(conversation);
    const draft = s.getState().drafts.drafts[0]!;
    vault.disk.set(SKILL_PATH, SKILL.replace("1. Read the offer.", "1. Read the whole offer."));
    await s.refreshSkills();
    await mount(s, { kind: "skill-draft", draftId: draft.id });
    expect(text(q("ai-skill-draft-blocked"))).toContain("This skill is not what the suggestion read any more");
    expect((q("ai-skill-draft-take") as HTMLButtonElement).disabled).toBe(true);
    await click(q("ai-skill-draft-discard"));
    expect(s.getState().drafts.drafts).toEqual([]);
    expect(q("ai-skill-draft")).toBeNull();
  });

  it("shows a new skill whole, with what it may do by the app's defaults", async () => {
    const vault = memoryVault({});
    const { s } = await memorySession([turn({ text: "Done." }), turn({ text: proposals([NEW_SKILL]) })], vault);
    await s.send("Let us write the follow-up for the fair.");
    await s.learnFrom(s.getState().active!.id);
    await mount(s, { kind: "skill-draft", draftId: s.getState().drafts.drafts[0]!.id });
    expect(text(q("ai-skill-draft"))).toContain("New skill “fair-follow-up”");
    expect(text(q("ai-skill-draft-purpose"))).toBe(NEW_SKILL.description);
    expect(text(q("ai-skill-draft-text"))).toContain("1. Collect the contacts.");
    const rights = text(q("ai-skill-draft-rights"));
    expect(rights).toContain("Changes nothing, sends nothing.");
    expect(rights).toContain("A skill made from a suggestion starts with the app's defaults.");
    expect(text(q("ai-skill-draft-cost"))).toMatch(/^About \d+ tokens in every run of this skill\.$/);
    await click(q("ai-skill-draft-take"));
    expect(vault.file(".agent/skills/fair-follow-up/SKILL.md")).toContain("1. Collect the contacts.");
    expect(q("ai-skill-draft")).toBeNull();
  });
});

describe("a skill's earlier versions", () => {
  it("shows the newest one against the skill as it is now, and restores it on the button", async () => {
    const { s, vault, conversation } = await withSkill([turn({ text: proposals([BETTER]) })]);
    await s.learnFrom(conversation);
    await s.createDraft(s.getState().drafts.drafts[0]!.id);
    expect(vault.file(SKILL_PATH)).toBe(`${HEAD}\n\n${NEW_BODY}\n`);

    await mount(s, { kind: "skill-versions", skillId: SKILL_ID });
    expect(text(q("ai-skill-versions"))).toContain("Earlier versions of “offer-check”");
    expect(text(q("ai-skill-version-now"))).toContain("Accepted from a suggestion on this device on ");
    // Going back takes the line out that the suggestion brought in.
    expect(text(q("ai-skill-version-changes"))).toContain("− 3. Check the tax rate of each position.");
    expect(text(q("ai-skill-version-rights"))).toBe("The same as now.");
    expect(q("ai-skill-version-wider")).toBeNull();
    await click(q("ai-skill-version-restore"));
    expect(vault.file(SKILL_PATH)).toBe(SKILL);
    expect(q("ai-skill-versions")).toBeNull();
    expect(s.getState().skills.entries.find((entry) => entry.source.id === SKILL_ID)!.approval).toMatchObject({ how: "restored" });
  });

  it("warns where a version may do more than the skill does now, and says where none is kept", async () => {
    const { s, vault } = await withSkill([]);
    const wider = SKILL.replace("allowed-tools: search_vault read_note", "allowed-tools: search_vault read_note get_outline").replace("  plainva.folders: Projects/\n", "");
    vault.versions.push({ id: `.plainva/backups/${SKILL_PATH}.1.bak`, path: SKILL_PATH, at: Date.parse("2026-09-28T09:40:00Z"), text: wider });
    await mount(s, { kind: "skill-versions", skillId: SKILL_ID });
    const rights = text(q("ai-skill-version-rights"));
    expect(rights).toContain("May now also use: ");
    expect(rights).toContain("Folders: the whole vault (before: Projects/)");
    expect(text(q("ai-skill-version-wider"))).toBe("This version may do more than the skill does now.");
    expect(text(q("ai-skill-version-same"))).toBe("");
    act(() => closeLearnSurface({ kind: "skill-versions", skillId: SKILL_ID }));

    const bare = memoryVault({ [SKILL_PATH]: SKILL });
    const other = await memorySession([], bare);
    await other.s.refreshSkills();
    act(() => root?.unmount());
    host?.remove();
    await mount(other.s, { kind: "skill-versions", skillId: SKILL_ID });
    expect(text(q("ai-skill-versions-empty"))).toContain("No earlier version is kept");
    expect((q("ai-skill-version-restore") as HTMLButtonElement).disabled).toBe(true);
  });
});
