/**
 * The store of the first index build lives in the shared UI package since the
 * desktop builds its first index behind the open app as well (performance plan
 * L3); the phone's imports stay valid through this re-export.
 */
export {
  awaitWholeIndex,
  beginIndexBuild,
  endIndexBuild,
  getIndexBuild,
  isIndexBuilding,
  reportIndexBuild,
  subscribeIndexBuild,
  type IndexBuildState,
} from "@plainva/ui";
