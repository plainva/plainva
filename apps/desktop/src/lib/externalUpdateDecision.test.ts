import { describe, expect, it } from "vitest";
import { decideDirtyExternalUpdate } from "./externalUpdateDecision";

describe("decideDirtyExternalUpdate", () => {
  it("realigns when the disk already matches the draft (echo of our own push)", () => {
    expect(
      decideDirtyExternalUpdate({ disk: "same", draft: "same", lastPersisted: "older" })
    ).toBe("realign");
  });

  it("treats disk == last persisted text as our own save echo (keep the draft)", () => {
    // The user saved "v2" and kept typing ("v2 plus more"); the watcher echo of
    // the v2 save (or the sync race's stale-hash false positive) must NOT
    // produce a .CONFLICT — this was the spurious-conflict bug.
    expect(
      decideDirtyExternalUpdate({ disk: "v2", draft: "v2 plus more", lastPersisted: "v2" })
    ).toBe("own-echo");
  });

  it("preserves a conflict for a genuinely different disk version", () => {
    expect(
      decideDirtyExternalUpdate({ disk: "remote edit", draft: "local draft", lastPersisted: "v2" })
    ).toBe("preserve-conflict");
  });

  it("never matches own-echo before the first own write (lastPersisted null)", () => {
    expect(
      decideDirtyExternalUpdate({ disk: "remote edit", draft: "local draft", lastPersisted: null })
    ).toBe("preserve-conflict");
  });

  it("prefers realign over own-echo when draft and disk are both at the last save", () => {
    expect(
      decideDirtyExternalUpdate({ disk: "v2", draft: "v2", lastPersisted: "v2" })
    ).toBe("realign");
  });
});
