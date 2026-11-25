import { describe, expect, it } from "vitest";
import { sourceFile } from "./test-sourceTree";

/**
 * The order of the settings cycle, in both shells (review 2026-11-25).
 *
 * The secrets sync writes a tombstone only from "Remove account"; an account
 * removed elsewhere leaves a device with the settings profile, which takes its
 * slot along. That holds only while a device's secrets round never runs ahead
 * of its profile: a password changed on a device that has not yet received a
 * removal would otherwise go out after it, and nobody would take it out again
 * (the review's probe P1). What carries it:
 *  - the profile step runs first in every cycle;
 *  - when it fails, the cycle ends — the error is thrown on, the secrets step
 *    is never reached;
 *  - the secrets step exists only where the profile step does (settings sync
 *    switched on, the keys at hand), so no device syncs passwords without its
 *    profile.
 * A device that writes a removal pushes its profile before its secrets for
 * the same reason.
 */

function runBody(source: string, rel: string): string {
  const start = source.indexOf("async run(target: ISyncTarget, vault: IVaultAdapter): Promise<void> {");
  expect(start, rel).toBeGreaterThan(0);
  return source.slice(start, source.indexOf("\n  }\n", start));
}

const SHELLS = [
  { rel: "apps/desktop/src/services/settingsProfile.ts", settingsOn: "isSettingsSyncEnabled(vaultPath)", key: "loadCachedMasterKey(vaultPath)" },
  { rel: "apps/mobile/src/services/mobileSettingsSync.ts", settingsOn: "isMobileSettingsSyncEnabled(vaultId)", key: "loadKeyring(vaultId)" },
];

describe("the settings cycle runs the profile before the secrets, and the secrets only after it", () => {
  for (const { rel, settingsOn, key } of SHELLS) {
    it(rel, () => {
      const source = sourceFile(rel);
      const body = runBody(source, rel);
      const profileRun = body.indexOf("await profile.run(target, vault);");
      const secretsRun = body.indexOf("await secrets.run(target, vault);");
      expect([profileRun > 0, secretsRun > profileRun]).toEqual([true, true]);
      // A failed profile step ends the cycle: its catch throws before the secrets are built.
      const between = body.slice(profileRun, body.indexOf("const secrets = await this.steps.secrets();"));
      expect(between).toMatch(/catch \(error\) \{[\s\S]*throw error;\s*\}\s*\}/);
      // The secrets step exists only with the settings sync on and the keys at hand.
      const factory = source.slice(source.indexOf("async secrets(): Promise<SecretsSyncStep | null> {"));
      const guard = factory.slice(0, factory.indexOf("return new SecretsSyncStep("));
      expect(guard).toContain(`if (!(await ${settingsOn})) return null;`);
      expect(guard).toContain(key);
    });
  }
});
