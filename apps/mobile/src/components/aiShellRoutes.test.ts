import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/tabTap", () => ({ tabTapped: vi.fn(async () => true) }));
vi.mock("../services/ai/mobileAi", () => ({
  MobileAiNavigation: () => null,
  // Where a link of an answer leads is the resolver's business; here it leads where it names.
  openAiNoteTarget: (_vault: unknown, target: string, open: (path: string) => void) => open(`${target}.md`),
  useMobileAi: () => null,
  withoutAiArea: <T,>(order: T) => order,
}));
vi.mock("./AiSheet", () => ({ AiSheet: () => null }));
vi.mock("./LearnSheets", () => ({ LearnSheets: () => null }));

import { armLeaveGuard, resetLeaveGuard } from "../services/leaveGuard";
import { currentMobileDialog, dismissMobileDialog } from "../services/mobileDialogs";
import { tabTapped } from "../services/tabTap";
import { parseDraft } from "../screens/mail/mailNavRefs";
import type { MobileVault } from "../services/vaultService";
import { aiShellRoutes } from "./MobileAiShell";

/**
 * The assistant's ways to another screen ask before unsaved input goes
 * (finding 2026-10-09, AI harness). Only the screen on top is rendered: a
 * note or the composer pushed over a message being written takes the message
 * with it. Every route the assistant's surfaces take goes through `leaveThen`,
 * as every other step does that is not the surface's own; with nothing at
 * stake the step runs at once.
 */
describe("where the assistant leads in the phone's shell", () => {
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  const GUARD = { id: "mail-compose", message: "The draft will not be saved." };

  function routes() {
    const steps: string[] = [];
    const made = aiShellRoutes({
      ai: { closeSheet: () => steps.push("sheet closed") },
      vault: {} as MobileVault,
      openNote: (path) => steps.push(`note ${path}`),
      push: (entry) => steps.push(`${entry.kind} ${entry.path}`),
      setNav: () => steps.push("nav"),
      commands: [],
      aiInBar: false,
    });
    return { ...made, steps };
  }

  /** Answers the question on screen the way the dialog host does. */
  function answer(discard: boolean) {
    const dialog = currentMobileDialog();
    expect(dialog?.kind, "the leave question is on screen").toBe("confirm");
    if (dialog?.kind !== "confirm") throw new Error("no question");
    dialog.resolve(discard);
    dismissMobileDialog(dialog);
  }

  beforeEach(() => {
    resetLeaveGuard();
    vi.mocked(tabTapped).mockClear();
  });

  afterEach(() => {
    const open = currentMobileDialog();
    if (open) dismissMobileDialog(open);
    resetLeaveGuard();
  });

  it("goes at once where nothing is at stake", () => {
    const { nav, onOpenNote, onOpenScreen, steps } = routes();
    nav.openNote("Plan.md");
    nav.openSearch?.();
    nav.openSettings?.();
    onOpenNote("Offer");
    onOpenScreen();
    expect(steps).toEqual(["note Plan.md", "search ", "settingsArea ai", "note Offer.md", "nav"]);
    expect(currentMobileDialog()).toBeNull();
  });

  it("asks first where a surface holds unsaved input, and goes nowhere on Cancel", async () => {
    armLeaveGuard(GUARD);
    const { nav, onOpenNote, onOpenScreen, steps } = routes();
    for (const step of [() => nav.openNote("Plan.md"), () => nav.openSearch?.(), () => nav.openSettings?.(), () => onOpenNote("Offer"), onOpenScreen]) {
      step();
      await settle();
      answer(false);
      await settle();
    }
    expect(steps, "nothing was put over the surface").toEqual([]);
  });

  it("opens a drafted mail in the composer once the question is answered — with every field through the codec of its path", async () => {
    armLeaveGuard(GUARD);
    const { nav, steps } = routes();
    nav.openMailDraft?.({ to: "ben@example.org", cc: "tom@example.org", bcc: "me@example.org", subject: "Offer", body: "Hello", doneToken: "compose-1" });
    await settle();
    expect(steps, "the sheet stays while the question stands").toEqual([]);
    answer(true);
    await settle();
    expect(steps[0]).toBe("sheet closed");
    const path = steps[1]!.slice("mailcompose ".length);
    expect(steps[1]!.startsWith("mailcompose ")).toBe(true);
    expect(parseDraft(path)).toEqual({ accountId: "", to: "ben@example.org", cc: "tom@example.org", bcc: "me@example.org", subject: "Offer", body: "Hello", doneToken: "compose-1" });
  });

  it("leads to the event editor the bar's way, which asks itself — and closes the sheet only once it went", () => {
    const { nav, steps } = routes();
    nav.openEventEditor?.();
    expect(tabTapped).toHaveBeenCalledTimes(1);
    const [tab, , agreed] = vi.mocked(tabTapped).mock.calls[0]!;
    expect(tab).toBe("today");
    expect(steps).toEqual([]);
    agreed?.();
    expect(steps).toEqual(["sheet closed"]);
  });
});
