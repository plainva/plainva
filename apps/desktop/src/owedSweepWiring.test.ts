import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The desktop queues a file another program changed or removed through the
 * core's `createLocalQueueing`, the one place that answers what came of an
 * entry (review F1 of R22): the index's callbacks and the sweep of what an
 * ended app left owed both go there. The core's tests drive that place with a
 * queue that fails (packages/core/test/index-sync-gaps.test.ts); this pins
 * that VaultContext hands it nothing that swallows a failure into "done".
 */
const source = readFileSync(path.join(__dirname, "contexts/VaultContext.tsx"), "utf8");

describe("VaultContext queues local changes through createLocalQueueing", () => {
  it("builds it with the vault's queues and answers the sweep with its outcomes", () => {
    expect(source).toContain("const localQueueing = createLocalQueueing({");
    expect(source).toContain("const enqueueLocalChange = (changedPath: string) => localQueueing.change(changedPath);");
    expect(source).toContain("const queueLocalDeletion = (deletedPath: string) => localQueueing.deletion(deletedPath);");
    expect(source).toContain("removeAll: (paths: readonly string[]) => localQueueing.deletions(paths),");
  });

  it("decides what is internal by the one rule of the core (review F3)", () => {
    expect(source).toContain("if (!queuesForTheRemote(path)) return;");
    expect(source).not.toMatch(/changedPath\.includes\("\.plainva"\)/);
  });
});
