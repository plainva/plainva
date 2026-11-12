import { describe, expect, it } from "vitest";
import { PHONE_CHAIN, saveEdgeStateCases } from "../../../../packages/ui/test/saveEdgeStates";

/**
 * The phone's save path in its edge states (stability plan R6): the save step
 * the note saver calls (`writeEditorSave`) over the chain `boot` builds, with
 * the phone's chain settings. The desktop runs the same cases with its own
 * (`saveEdgeStates.test.ts` there).
 */
describe("the phone's save path in its edge states", () => {
  for (const [name, run] of saveEdgeStateCases(PHONE_CHAIN, expect)) it(name, run);
});
