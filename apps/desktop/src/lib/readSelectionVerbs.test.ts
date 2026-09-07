import { describe, expect, it } from "vitest";
import { readSelectionVerbs } from "@plainva/ui";

/** Build-91 feedback, P5 (E5): the verbs over a read-mode selection. */
describe("readSelectionVerbs", () => {
  it("a plain vault note gets the bar for the one verb it can offer", () => {
    expect(readSelectionVerbs({ canComment: false, hasComment: true, hasSuggest: true, canEdit: true })).toEqual(["edit"]);
  });

  it("a workspace note keeps comment and suggest, edit joins when writable", () => {
    expect(readSelectionVerbs({ canComment: true, hasComment: true, hasSuggest: true, canEdit: true })).toEqual(["comment", "suggest", "edit"]);
    expect(readSelectionVerbs({ canComment: true, hasComment: true, hasSuggest: false, canEdit: false })).toEqual(["comment"]);
  });

  it("nothing to offer means no bar", () => {
    expect(readSelectionVerbs({ canComment: false, hasComment: false, hasSuggest: false, canEdit: false })).toEqual([]);
    expect(readSelectionVerbs({ canComment: true, hasComment: false, hasSuggest: false, canEdit: false })).toEqual([]);
  });
});
