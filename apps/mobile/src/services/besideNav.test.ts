import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RouteContext } from "../routes";
import { BESIDE_ASKS, BESIDE_PLAIN, besideContext } from "./besideNav";
import { activeLeaveGuard, armLeaveGuard, resetLeaveGuard } from "./leaveGuard";
import { currentMobileDialog, dismissMobileDialog } from "./mobileDialogs";

/**
 * The navigator column of a wide window (finding 2026-10-09).
 *
 * It stands beside the work, and what it opens is put on top of whatever the
 * work column shows — with a message being written there, one tap in the tree
 * took the composer and its draft. Its context asks first now. Pinned here: it
 * asks for every step that changes what is on top, for nothing else, and
 * changes nothing at all while there is nothing to lose.
 *
 * That no member of the context is forgotten is the compiler's job
 * (`EveryMemberIsDecided` in besideNav.ts): a new member has to be put on one
 * of the two lists before the app builds. The test below ties this file's
 * stand-in to those lists, so it cannot fall behind them either.
 */

/** Every member of the context the shell hands a route. */
function context() {
  const fns = {
    push: vi.fn(),
    pop: vi.fn(),
    done: vi.fn(),
    replace: vi.fn(),
    setNav: vi.fn(),
    openNote: vi.fn(),
    openBase: vi.fn(),
    openAttachment: vi.fn(),
    openDaily: vi.fn(),
    createVaultFlow: vi.fn(),
    quickNewDatabase: vi.fn(),
    captureNote: vi.fn(),
    captureJournal: vi.fn(),
    onBarLayout: vi.fn(),
  };
  const ctx = { ...fns, vault: {}, vaultName: "Vault", bump: 3, commands: [], barLayout: {} } as unknown as RouteContext;
  return { ctx, fns };
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const GUARD = { id: "mail-compose", message: "The draft will not be saved." };

/** Answers the leave question the way the dialog host does: the promise first, then off the screen. */
function answer(discard: boolean) {
  const dialog = currentMobileDialog();
  expect(dialog?.kind, "the leave question is on screen").toBe("confirm");
  if (dialog?.kind !== "confirm") return;
  dialog.resolve(discard);
  dismissMobileDialog(dialog);
}

/** Each step that puts something on top, with the arguments a navigator gives it. */
const STEPS: Array<[(typeof BESIDE_ASKS)[number], unknown[]]> = [
  ["push", [{ kind: "folder", path: "Projekte" }]],
  ["replace", [{ kind: "search", path: "" }]],
  ["setNav", [(state: unknown) => state]],
  ["openNote", ["Projekte/Angebot.md"]],
  ["openBase", ["Aufgaben.base", true]],
  ["openDaily", ["2026-10-09"]],
  ["createVaultFlow", []],
  ["quickNewDatabase", []],
  ["captureNote", []],
  ["openAttachment", ["Bilder/Skizze.png", true]],
];

beforeEach(() => {
  resetLeaveGuard();
});

afterEach(() => {
  const open = currentMobileDialog();
  if (open) dismissMobileDialog(open);
  resetLeaveGuard();
});

describe("the navigator beside the work", () => {
  it.each(STEPS)("%s goes straight through while nothing is at stake", (name, args) => {
    const { ctx, fns } = context();
    const beside = besideContext(ctx) as unknown as Record<string, (...a: unknown[]) => void>;
    beside[name](...args);
    expect(fns[name]).toHaveBeenCalledTimes(1);
    expect(fns[name]).toHaveBeenCalledWith(...args);
    expect(currentMobileDialog()).toBeNull();
  });

  it.each(STEPS)("%s asks first over a surface with unsaved input", async (name, args) => {
    armLeaveGuard(GUARD);
    const { ctx, fns } = context();
    const beside = besideContext(ctx) as unknown as Record<string, (...a: unknown[]) => void>;
    beside[name](...args);
    await settle();
    expect(currentMobileDialog()?.kind, "the leave question is on screen").toBe("confirm");
    expect(fns[name], "nothing moves while the question stands").not.toHaveBeenCalled();

    answer(true);
    await settle();
    expect(fns[name]).toHaveBeenCalledTimes(1);
    expect(fns[name]).toHaveBeenCalledWith(...args);
    // Whether the surface goes is the surface's to say (a new database still
    // asks for its name): until it does, its input stays guarded.
    expect(activeLeaveGuard()).toEqual(GUARD);
  });

  it("leaves the work where it is on Cancel", async () => {
    armLeaveGuard(GUARD);
    const { ctx, fns } = context();
    besideContext(ctx).openNote("Projekte/Angebot.md");
    await settle();
    answer(false);
    await settle();
    expect(fns.openNote).not.toHaveBeenCalled();
  });

  it("does not ask for a file that opens in another app: nothing here is covered", () => {
    armLeaveGuard(GUARD);
    const { ctx, fns } = context();
    besideContext(ctx).openAttachment("Belege/Rechnung.pdf", false);
    expect(fns.openAttachment).toHaveBeenCalledWith("Belege/Rechnung.pdf", false);
    expect(currentMobileDialog()).toBeNull();
  });

  it("hands on what changes nothing on top exactly as it was given", () => {
    const { ctx } = context();
    const beside = besideContext(ctx);
    // The journal capture is a sheet; the rest is data, or not the navigator's.
    for (const key of BESIDE_PLAIN) expect(beside[key], key).toBe(ctx[key]);
  });

  it("covers every step on the list, and this stand-in every member of the context", () => {
    const { ctx } = context();
    const beside = besideContext(ctx);
    const asking = Object.keys(ctx).filter((key) => beside[key as keyof RouteContext] !== ctx[key as keyof RouteContext]).sort();
    expect(asking, "what the context wraps is what the list names").toEqual([...BESIDE_ASKS].sort());
    expect(STEPS.map(([name]) => name).sort(), "every step on the list is driven above").toEqual([...BESIDE_ASKS].sort());
    expect(Object.keys(ctx).sort(), "the stand-in has every member the two lists name").toEqual([...BESIDE_ASKS, ...BESIDE_PLAIN].sort());
  });
});
