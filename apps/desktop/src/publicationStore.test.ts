import { describe, it, expect } from "vitest";
import { shippedSources } from "./test-sourceTree";

/**
 * One place derives a publication's folder (Stufe B, S1).
 *
 * A publication lives under `.pvws/publications/<id>/`, and that id is DERIVED
 * from the vault and the slice rather than stored - the publication document is
 * pinned to an exact key set and the protocol has no schema evolution, so a new
 * field would be a protocol change.
 *
 * Derived means reproducible, and reproducible only holds while exactly one
 * piece of code does the deriving. A second construction site would be free to
 * pass a different id, and a publication written under one name and refreshed
 * under another is a silent orphan: the old folder keeps serving stale objects
 * to everyone who already joined it, and nothing anywhere reports an error.
 *
 * Tests may build the store directly - that is how the store itself gets
 * checked. Production code goes through `publicationStoreFor`.
 */

const FACTORY = "packages/core/src/workspace/publishedSlices.ts";

/** The shipped files of the four code roots that contain the needle. The
 * texts are read once for all three checks (the scan guards' shared snapshot). */
function productionFilesContaining(needle: string): string[] {
  return shippedSources()
    .filter((file) => file.text.includes(needle))
    .map((file) => file.rel)
    .sort();
}

describe("publication namespace", () => {
  it("is constructed in exactly one place", () => {
    expect(productionFilesContaining("new PublishedSliceObjectStore")).toEqual([FACTORY]);
  });

  it("has its recipient half constructed in exactly one place too", () => {
    // The inverse wrapper carries the same risk from the other side: a second
    // copy is free to map the keys slightly differently, and a recipient who
    // reads half a workspace sees a folder that looks merely empty.
    expect(productionFilesContaining("new PublicationRecipientObjectStore")).toEqual([FACTORY]);
  });

  it("has its path assembled in exactly one place", () => {
    // The stricter half: somebody could skip the class entirely and hand a
    // hand-built `.pvws/publications/<something>/` prefix to the plain store,
    // which would pass the check above while producing the same orphan. Only
    // the template expression counts - the prose that explains the layout is
    // allowed to name it.
    expect(productionFilesContaining(".pvws/publications/${")).toEqual([FACTORY]);
  });
});
