import { describe, expect, it } from "vitest";
import { sourceFile } from "./test-sourceTree";

/**
 * No password stays in the settings store (review 2026-11-18, round nine,
 * F67): each shell seals the marks of the secrets sync at its start, first in
 * the line of secrets rounds (`sealSecretsAtStart`), so no export or import
 * begins before it. A start that loses the call keeps the plain marks of
 * every vault that is not opened — this holds the call in place.
 */
describe("both shells seal the secrets marks at start, in the line of secrets rounds", () => {
  for (const [shell, file, service] of [
    ["desktop", "apps/desktop/src/main.tsx", "./services/settingsSecrets"],
    ["phone", "apps/mobile/src/main.tsx", "./services/mobileSecretsPort"],
  ] as const) {
    it(shell, () => {
      const text = sourceFile(file);
      expect(text).toMatch(/sealSecretsAtStart\(\s*\(\)\s*=>\s*import\("([^"]+)"\)\.then\(\(\{\s*sealSecretsMetaAtStart\s*\}\)\s*=>\s*sealSecretsMetaAtStart\(\)\)/);
      expect(text).toContain(`import("${service}").then(({ sealSecretsMetaAtStart }) => sealSecretsMetaAtStart())`);
      // A failure is reported, never swallowed.
      expect(text.slice(text.indexOf("sealSecretsAtStart("))).toMatch(/^sealSecretsAtStart\([\s\S]*?\)\)\.catch\(/);
    });
  }
});
