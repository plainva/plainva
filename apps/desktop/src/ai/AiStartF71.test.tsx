// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import i18n from "@plainva/ui/i18n";
import { AiConversation, AiSessionContext, type AiSession } from "@plainva/ui";
import { mcpSession, turn } from "./mcpSessionHarness";

/**
 * The start of a conversation as one surface (F71 of release 0.9.0, mockup KI-Oberflächen M12 and M7), in the shared
 * conversation both shells show: an empty conversation opens at its top; what happens to a change is said once, in the
 * marking line, and changes with "Apply directly"; a switch that is on is filled and checked; the switches lead the
 * row; every chip has one form; the send button sits in the field; the foot names the model; the skills menu ends
 * with the way to skills and memory; "Learn from this conversation" is a button of its own under the last answer.
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
  vi.restoreAllMocks();
});

async function show(session: AiSession, node: ReactNode): Promise<void> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<AiSessionContext.Provider value={session}>{node}</AiSessionContext.Provider>);
  });
  await settle();
}
const settle = async () => {
  await act(async () => {
    for (let turns = 0; turns < 12; turns++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
};
const click = async (el: Element | null | undefined) => {
  expect(el).toBeTruthy();
  await act(async () => {
    (el as HTMLElement).click();
  });
  await settle();
};
const q = (id: string) => document.body.querySelector(`[data-testid="${id}"]`);
const text = (el: Element | null | undefined) => el?.textContent ?? "";
const set = (s: AiSession, patch: object) => act(async () => (s as unknown as { set: (patch: object) => void }).set(patch));
const conversation = (props: { start?: ReactNode; onOpenSkills?: () => void; onPickNote?: () => void } = {}) => (
  <AiConversation dress="screen" activeNote={null} onOpenNote={() => undefined} onOpenUrl={() => undefined} onOpenSettings={() => undefined} {...props} />
);

/** jsdom lays nothing out: the thread says it is 500px tall, and every scroll it is given is kept. */
async function recordingScrolls(run: (scrolled: number[]) => Promise<void>): Promise<void> {
  const scrolled: number[] = [];
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(500);
  const scrollTop = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop")!;
  Object.defineProperty(HTMLElement.prototype, "scrollTop", {
    configurable: true,
    get: () => 0,
    set(this: HTMLElement, value: number) {
      if (this.classList.contains("pv-ai-thread")) scrolled.push(value);
    },
  });
  try {
    await run(scrolled);
  } finally {
    delete (HTMLElement.prototype as unknown as { scrollTop?: number }).scrollTop;
    Object.defineProperty(Element.prototype, "scrollTop", scrollTop);
  }
}

describe("an empty conversation opens at its top (point 1)", () => {
  it("does not jump to the end of what an empty conversation shows", async () => {
    await recordingScrolls(async (scrolled) => {
      const { s } = await mcpSession([]);
      await show(s, conversation({ start: <div style={{ height: 600 }} data-testid="start-page" /> }));
      expect(scrolled.length).toBeGreaterThan(0);
      expect(scrolled[scrolled.length - 1]).toBe(0);
    });
  });

  it("and a conversation with an answer still follows it to its end", async () => {
    await recordingScrolls(async (scrolled) => {
      const { s } = await mcpSession([turn({ text: "The offer stands in [[Offer]]." })]);
      await show(s, conversation());
      await act(async () => void (await s.send("What is the offer?")));
      await settle();
      expect(scrolled[scrolled.length - 1]).toBe(500);
    });
  });

  it("what the person has to know now stands before the start page, never below it (review point 10)", async () => {
    const { s } = await mcpSession([]);
    await show(s, conversation({ start: <div data-testid="start-page" /> }));
    await set(s, { preparing: true });
    const preparing = q("ai-preparing")!;
    expect(preparing.compareDocumentPosition(q("start-page")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("what happens to a change is said once (point 3)", () => {
  it("the marking line says it, and changes with “Apply directly”; the greeting says nothing about it", async () => {
    const { s } = await mcpSession([]);
    vi.spyOn(s, "directOffer").mockReturnValue(true);
    await show(s, conversation());
    expect(text(q("ai-direct-off-marking"))).toBe(i18n.t("ai.direct.markingOff"));
    expect(q("ai-direct-marking")).toBeNull();
    expect(text(q("ai-hello"))).toBe(`${i18n.t("ai.empty.startTitle")}${i18n.t("ai.empty.startBodyVault")}`);
    await set(s, { draftDirect: true });
    expect(text(q("ai-direct-marking"))).toBe(i18n.t("ai.direct.marking"));
    expect(q("ai-direct-off-marking")).toBeNull();
    // Nowhere in the conversation does a sentence say the opposite of the one in the marking line.
    expect(text(q("ai-conversation"))).not.toContain(i18n.t("ai.direct.markingOff"));
  });
});

describe("the marking line never claims more protection than the run gives (review point 1)", () => {
  it("names the folders that change without asking, wherever the open note lies", async () => {
    const { s } = await mcpSession([]);
    vi.spyOn(s, "directOffer").mockReturnValue(true);
    vi.spyOn(s, "hasDirectFolders").mockResolvedValue(true);
    await show(s, conversation());
    expect(text(q("ai-direct-off-marking"))).toBe(i18n.t("ai.direct.markingOffFolders"));
  });

  it("says nothing about changes while the vault's rules are still being asked", async () => {
    const { s } = await mcpSession([]);
    vi.spyOn(s, "directOffer").mockReturnValue(true);
    vi.spyOn(s, "hasDirectFolders").mockReturnValue(new Promise<boolean>(() => undefined));
    await show(s, conversation());
    expect(q("ai-direct-off-marking")).toBeNull();
  });

  it("says nothing about proposals where nothing is proposed (an encrypted workspace)", async () => {
    const { s } = await mcpSession([]);
    vi.spyOn(s, "directOffer").mockReturnValue(false);
    await show(s, conversation());
    expect(q("ai-direct-off-marking")).toBeNull();
    expect(q("ai-direct-marking")).toBeNull();
  });
});

describe("the chips (points 4 and 5)", () => {
  it("a switch that is on is filled and checked, one that is off shows its own sign", async () => {
    const { s } = await mcpSession([]);
    vi.spyOn(s, "directOffer").mockReturnValue(true);
    await show(s, conversation());
    const chip = () => q("ai-direct-toggle")!;
    expect(chip().getAttribute("aria-pressed")).toBe("false");
    expect(chip().classList.contains("is-on")).toBe(false);
    expect(chip().querySelector(".lucide-zap")).not.toBeNull();
    // Switched on as the chip does, where the shell can write directly (the harness's vault cannot).
    await set(s, { draftDirect: true });
    expect(chip().getAttribute("aria-pressed")).toBe("true");
    expect(chip().classList.contains("is-on")).toBe(true);
    expect(chip().querySelector(".lucide-check")).not.toBeNull();
    expect(chip().querySelector(".lucide-zap")).toBeNull();
  });

  it("the switches lead the row, and every chip has the one form", async () => {
    const { s } = await mcpSession([]);
    vi.spyOn(s, "directOffer").mockReturnValue(true);
    vi.spyOn(s, "webOffer").mockReturnValue({ fetch: true, search: false });
    await show(s, conversation({ onPickNote: () => undefined }));
    const order = [...q("ai-chips")!.querySelectorAll("[data-testid]")].map((el) => el.getAttribute("data-testid"));
    expect(order).toEqual(["ai-web-toggle", "ai-direct-toggle", "ai-pin-note", "ai-lens-open"]);
    expect(q("ai-pin-note")!.classList.contains("pv-chip--muted")).toBe(false);
  });
});

describe("the field and the foot (points 6 and 7)", () => {
  it("the send button sits in the field, which starts as one line", async () => {
    const { s } = await mcpSession([]);
    await show(s, conversation());
    const box = q("ai-send")!.closest(".pv-ai-inputrow");
    expect(box?.contains(q("ai-input"))).toBe(true);
    expect((q("ai-input") as HTMLTextAreaElement).rows).toBe(1);
  });

  it("the foot names the model, and the skills menu ends with the way to skills and memory", async () => {
    const { s } = await mcpSession([]);
    const onOpenSkills = vi.fn();
    await show(s, conversation({ onOpenSkills }));
    expect(text(q("ai-profile-button"))).toBe("Model: Balanced");
    await click(q("ai-skills-open"));
    const items = [...document.body.querySelectorAll('[role="menuitem"]')];
    const last = items[items.length - 1];
    expect(last?.getAttribute("data-testid")).toBe("ai-skills-manage");
    expect(text(last)).toBe(i18n.t("ai.start.skillsAndMemory"));
    await click(last);
    expect(onOpenSkills).toHaveBeenCalledTimes(1);
  });
});

describe("the way to skills and memory (review point 9)", () => {
  it("is offered on the start also where no skill can be started", async () => {
    const { s } = await mcpSession([]);
    // No skill to start: the menu holds the way to the skills and the memory alone.
    await set(s, { skills: { ...s.getState().skills, entries: [] } });
    const onOpenSkills = vi.fn();
    await show(s, conversation({ onOpenSkills }));
    await click(q("ai-skills-open"));
    const items = [...document.body.querySelectorAll('[role="menuitem"]')];
    expect(items.map((item) => item.getAttribute("data-testid"))).toEqual(["ai-skills-manage"]);
  });
});

describe("a provider without a model (mockup M3)", () => {
  it("says that the model is what is missing, in the words of the settings", async () => {
    const { s } = await mcpSession([], { profiles: {} });
    await show(s, conversation());
    expect(text(q("ai-setup-model-missing"))).toContain(i18n.t("ai.setup.modelTitle"));
  });
});

describe("the greeting (points 1 and 9)", () => {
  it("stands where nothing else does, at the top and to the left; a start page replaces it", async () => {
    const { s } = await mcpSession([]);
    await show(s, conversation());
    expect(q("ai-hello")!.classList.contains("pv-ai-hello")).toBe(true);
    expect(q("ai-hello")!.querySelector("svg")).toBeNull();
    act(() => root?.unmount());
    host?.remove();
    await show(s, conversation({ start: <p data-testid="start-page">waits</p> }));
    expect(q("ai-hello")).toBeNull();
    expect(q("start-page")).not.toBeNull();
  });
});

describe("“Learn from this conversation” (mockup M7, maintainer 19.11.)", () => {
  it("is a button of its own under the last answer; the run's menu keeps only the same question to another model", async () => {
    const { s } = await mcpSession([turn({ text: "The offer stands in [[Offer]]." })]);
    await show(s, conversation());
    await act(async () => void (await s.send("What is the offer?")));
    await settle();
    const learn = q("ai-run-actions")!.querySelectorAll('[data-testid="ai-learn-open"]');
    // One button in the row itself, not an entry of a menu.
    expect(learn).toHaveLength(1);
    expect(learn[0]!.tagName).toBe("BUTTON");
    expect(learn[0]!.getAttribute("role")).not.toBe("menuitem");
    expect(text(learn[0])).toBe(i18n.t("ai.learn.action"));
    // And no menu carries it: the run's "…" (where the run has one) holds the same question to another model alone.
    const more = q("ai-run-more");
    if (more) await click(more);
    expect(document.body.querySelectorAll('[role="menuitem"][data-testid="ai-learn-open"]')).toHaveLength(0);
  });
});
