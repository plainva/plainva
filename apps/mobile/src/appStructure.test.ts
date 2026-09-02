import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Structural ratchet (hardening P6.6, finding M9): App.tsx must not keep
 * absorbing feature blocks — new screens, sheets and domain logic belong in
 * their own files (screens/, components/, services/). The budget freezes the
 * size at ratchet time; shrink it when you extract something, never raise it
 * for a new feature (same model as the desktop designLint ratchet).
 *
 * History: 691 lines after mobile P1, 1104 by the time this ratchet landed —
 * that unreviewed drift is exactly what stops here. S8 (2026-08-02) moved the
 * 210-line router chain into routes.tsx and lowered the budget accordingly;
 * P2's new surfaces get routes there, not branches here.
 */
// Lowered from 885 with S11: PendingIntentRunner moved into its own module —
// the reminder tap is a third kind of outside intent, and that block had no
// business growing inside the shell.
// Lowered from 890 with N1.4: what a bar tap does moved into services/tabTap.
// Lowered from 856 with the #47 fix: push/pop/replace moved into
// services/navActions. They were three loose consts, and the one asymmetry
// among them — pop is asynchronous because it asks about unsaved input — was
// invisible at the call site. That is what the connect wizard tripped over.
// The budget follows the real count downwards and never upwards — headroom is
// how drift gets legitimised (the same rule the mobileLint budgets follow).
// Lowered from 850 with S0b2: the connect run and the soft-keyboard listener
// both moved into hooks/. The run had to leave anyway — it advances across a
// vault switch that resets the navigation — and the keyboard listener was the
// block the budget was pointing at: a platform concern with its own teardown,
// sitting in the shell for no reason.
// Lowered from 829 with P8: the two things the app says on its own at start-up
// — the interrupted-conversion question and the release highlights — moved into
// components/StartupSheets.tsx. They answer the same question ("is there
// anything from last time you need to know about?"), so grouping them is not a
// line-count trick; the shell came out four lines smaller than before P8.
// Lowered from 824 with P2: "what does the bar show" moved into
// services/mobileBar (shownBarTabs), and the pool-id -> stack-entry map into
// navigation (SCREEN_ENTRY). The rail change would have grown the shell by
// twenty lines; both blocks were answering questions the shell should be
// ASKING — which is exactly what this budget is for. It came out smaller than
// before P2.
// Lowered from 819 with the foldable navigator (2026-08-23): how the shell
// ARRANGES its surfaces moved into components/AdaptiveLayout, and the two
// answers behind it - is there room for a second column, does the reader want
// one - into hooks/useAdaptiveSplit. The switch would have grown the shell by
// thirteen lines; the block it grew was the one the shell should have been
// asking for rather than holding, and it came out smaller than before.
// Lowered from 806 with the PIM refresh (2026-08-24): what the app does when it
// changes hands with the OS moved into services/appLifecycle. Adding the PIM
// cycle to the resume handler broke this budget by six lines - and rightly, as
// that handler is a LIST that keeps growing, one entry per cycle a phone cannot
// run in the background. A list of behaviours belongs somewhere it can be named
// and tested, not inside a listener callback in the shell.
// Raised to 793 for the remark notifier (Stufe F, F3, 2026-09-02) - the one
// case where the budget moves UP, and only after it did its job. The first
// draft put the notifier's capability list straight into the shell and this
// test broke it by eight lines; the list now lives in
// hooks/useCommentNotifierDeps, exactly as the paragraph above demands. What
// is left is the minimum an extracted feature can cost: one import and one
// call. Two lines is the price of wiring, not of a block growing - and the
// next feature pays the same two only by extracting too. The explanation that
// would have been a third line sits in the hook, where it belongs.
const APP_TSX_LINE_BUDGET = 793;

describe("mobile app structure ratchet", () => {
  it(`App.tsx stays within its ${APP_TSX_LINE_BUDGET}-line budget`, () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "App.tsx"), "utf8");
    const lines = source.split("\n").length;
    expect(
      lines,
      `App.tsx has ${lines} lines (budget ${APP_TSX_LINE_BUDGET}). Extract new feature blocks into their own modules instead of raising the budget.`
    ).toBeLessThanOrEqual(APP_TSX_LINE_BUDGET);
  });
});
