import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The two promises of the OKF wizard that no unit test can reach (P8).
 *
 * Both are about WHEN something happens, in a component whose only honest test
 * environment is a phone: the run must be interruptible by the OS taking the
 * app away, and nothing may be written before the preview has been confirmed.
 * Reading the source is the weaker check — it cannot prove the handler fires —
 * but it does stop the wiring from being removed, and that is the failure mode
 * that would otherwise be silent.
 */
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "OkfConversionScreen.tsx"), "utf8");

describe("OKF wizard wiring", () => {
  it("stops the run when the app goes to the background", () => {
    // The normal way a long run ends on a phone is that the OS takes the
    // process. Stopping at a known file leaves an interrupted run the journal
    // can describe; being killed mid-write leaves one it cannot.
    const listener = src.match(/addListener\("appStateChange",[\s\S]*?\}\);/);
    expect(listener, "no appStateChange listener").toBeTruthy();
    expect(listener![0]).toMatch(/if \(!isActive\) cancelRef\.current = true;/);
    // And the flag has to reach the run, not just be set.
    expect(src).toContain("isCancelled: () => cancelRef.current");
  });

  it("writes nothing before the preview is confirmed", () => {
    // The scan reads; only the button writes. A conversion that starts from
    // the scan would change every note before anyone saw the list.
    const call = src.indexOf("convertVaultToOkf(");
    expect(call).toBeGreaterThan(-1);
    // The only caller sits in `start`, and `start` is only reachable from the
    // preview button and the two continue buttons — never from an effect.
    const callers = [...src.matchAll(/convertVaultToOkf\(/g)];
    expect(callers).toHaveLength(1);
    const runner = src.slice(0, call).match(/const (start|run)[\s\S]*$/);
    expect(runner, "convertVaultToOkf is not inside a named runner").toBeTruthy();
    for (const effect of src.matchAll(/useEffect\(\(\) => \{[\s\S]*?\n {2}\}, \[/g)) {
      expect(effect[0]).not.toContain("convertVaultToOkf");
    }
    expect(src).toMatch(/data-testid="okf-start"/);
  });

  it("keeps the way out open while a run is going", () => {
    // No back arrow during the run (a half-converted vault behind a closed
    // screen is the state nobody can act on), but a pause that is always
    // reachable — the guard asks, it does not trap.
    expect(src).toContain('step === "running" ? undefined : onBack');
    expect(src).toContain('useLeaveGuard("okf", step === "running"');
    expect(src).toMatch(/data-testid="okf-pause"/);
  });
});
