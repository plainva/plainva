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
// The budget follows the real count downwards and never upwards — headroom is
// how drift gets legitimised (the same rule the mobileLint budgets follow).
const APP_TSX_LINE_BUDGET = 856;

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
