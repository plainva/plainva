import { loadPart } from "@plainva/ui";

type XmlTargets = typeof import("./syncXmlTargets");

/**
 * The S3 and WebDAV targets for a vault's open (package B1b): loaded only when the vault syncs through one of them
 * (`needed`), bounded by `loadPart` — a module that hangs or fails ends the open with a `PartLoadError`, which the
 * open shows through `errorText` — and never an empty answer where a target is needed.
 */
export async function loadSyncXmlTargets(needed: boolean, load: () => Promise<XmlTargets> = () => import("./syncXmlTargets")): Promise<XmlTargets | null> {
  if (!needed) return null;
  return loadPart(load);
}

/** The loaded targets where the vault needs one; a vault that syncs through S3 or WebDAV never goes on without it. */
export function requireSyncXmlTargets(targets: XmlTargets | null, provider: "s3" | "webdav"): XmlTargets {
  if (!targets) throw new Error(`the ${provider} target did not load`);
  return targets;
}
