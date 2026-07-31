import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const contractFiles = [
  "apps/desktop/src/services/accountSyncRegressionContracts.test.ts",
  "apps/desktop/src/services/accountRepair.test.ts",
  "apps/desktop/src/services/diagnosticsExport.test.ts",
  "apps/desktop/src/services/tokenBroker.test.ts",
  "apps/mobile/src/accountSyncContracts.test.ts",
  "apps/mobile/src/mobileVersioning.test.ts",
  "apps/mobile/src/syncDiagnostics.test.ts",
  "packages/core/test/settings-sync.test.ts",
] as const;

function read(relativePath: string): string {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

describe("account-sync acceptance matrix traceability", () => {
  it("links every T1-T15 case to an executable contract and the engineering matrix", () => {
    const executableContracts = contractFiles.map(read).join("\n");
    const engineeringMatrix = read(
      "docs/engineering/Account_Sync_Convergence_and_Credential_Boundary.md",
    );

    for (let number = 1; number <= 15; number += 1) {
      const id = `T${number}`;
      expect(executableContracts, `${id} has no named executable contract`).toMatch(
        new RegExp(`\\b${id}\\b`),
      );
      expect(engineeringMatrix, `${id} is missing from the published matrix`).toContain(
        `| ${id} |`,
      );
    }
  });

  it("contains no deferred or expected-failure account-sync contract", () => {
    const executableContracts = contractFiles.map(read).join("\n");
    expect(executableContracts).not.toMatch(/\bit\.(?:fails|skip|todo)\b|\bdescribe\.skip\b/);
  });
});
