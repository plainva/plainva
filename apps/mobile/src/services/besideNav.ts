import type { RouteContext } from "../routes";
import { leaveThen } from "./leaveQuestion";

/**
 * The route context of a surface that stands BESIDE the one on top — the
 * navigator column of a wide window (finding 2026-10-09).
 *
 * A wide window shows the navigator next to the work: the same component the
 * notes tab renders, handed the same context. Its steps are not its own in the
 * way a pushed screen's are, though. A note tapped in the navigator is put on
 * top of whatever the work column shows, and only the surface on top is
 * rendered — so with a message being written there, one tap in the tree took
 * the composer and its draft, and nothing asked. The phone never met this: its
 * navigator is the tab root, and a tab root is not beside anything.
 *
 * Every step of this context that changes what is on top therefore asks first
 * (`leaveThen`): with nothing to lose it runs in the same tick, as before.
 * What changes nothing on top stays as it is — the journal capture is a sheet,
 * and an attachment that is no image opens in another app.
 */

/** The members that put something on top of the work, and so ask first. */
export const BESIDE_ASKS = [
  "push",
  "replace",
  "setNav",
  "openNote",
  "openBase",
  "openAttachment",
  "openDaily",
  "createVaultFlow",
  "quickNewDatabase",
  "captureNote",
] as const satisfies readonly (keyof RouteContext)[];

/** The members handed on as they are: data, a sheet, and the two ways out a navigator does not take. */
export const BESIDE_PLAIN = [
  "vault",
  "vaultName",
  "bump",
  "pop",
  "done",
  "captureJournal",
  "commands",
  "barLayout",
  "onBarLayout",
] as const satisfies readonly (keyof RouteContext)[];

/**
 * A member added to `RouteContext` is on neither list, and this stops
 * compiling until it is put on one. The context is spread below, so a new
 * step that navigates would otherwise pass through here unasked, unseen by
 * any test — which is how the hole this file closes came to be.
 */
type Undecided = Exclude<keyof RouteContext, (typeof BESIDE_ASKS)[number] | (typeof BESIDE_PLAIN)[number]>;
type Nothing<T extends never> = T;
export type EveryMemberIsDecided = Nothing<Undecided>;

export function besideContext(ctx: RouteContext): RouteContext {
  const asking =
    <A extends unknown[]>(step: (...args: A) => void) =>
    (...args: A) =>
      leaveThen(() => step(...args));
  return {
    ...ctx,
    push: asking(ctx.push),
    replace: asking(ctx.replace),
    setNav: asking(ctx.setNav),
    openNote: asking(ctx.openNote),
    openBase: asking(ctx.openBase),
    openDaily: asking(ctx.openDaily),
    createVaultFlow: asking(ctx.createVaultFlow),
    quickNewDatabase: asking(ctx.quickNewDatabase),
    captureNote: asking(ctx.captureNote),
    // An image opens in the viewer, over the work; any other file goes to the
    // system's own app and covers nothing here.
    openAttachment: (path, isImage) => (isImage ? leaveThen(() => ctx.openAttachment(path, isImage)) : ctx.openAttachment(path, isImage)),
  };
}
