/**
 * The store of the index build lives in the shared UI package since the
 * desktop builds its first index behind the open app as well (performance plan
 * L3); the phone's imports stay valid through this re-export.
 */
export {
  beginIndexBuild,
  indexBuildState,
  indexWholenessFor,
  isIndexBuilding,
  markIndexClosed,
  markIndexFailed,
  markIndexWhole,
  reportIndexBuild,
  subscribeIndexBuild,
  takeFullScan,
} from "@plainva/ui";
