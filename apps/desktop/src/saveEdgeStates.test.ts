import { describe, expect, it } from "vitest";
import { DESKTOP_CHAIN, saveEdgeStateCases } from "../../../packages/ui/test/saveEdgeStates";

/**
 * The desktop's save path in its edge states (stability plan R6): the save
 * step the editor calls (`writeEditorSave`) over the chain the vault context
 * builds, with the desktop's chain settings. The phone runs the same cases
 * with its own (`services/saveEdgeStates.test.ts` there).
 */
describe("the desktop's save path in its edge states", () => {
  for (const [name, run] of saveEdgeStateCases(DESKTOP_CHAIN, expect)) it(name, run);
});
