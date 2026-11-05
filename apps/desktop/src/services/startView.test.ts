import { describe, expect, it } from "vitest";
import { parseStartView, START_VIEWS, startViewLabelKey } from "@plainva/ui";

describe("start view", () => {
  it("reads anything unknown as the default, as you left it", () => {
    expect(parseStartView(undefined)).toBe("restore");
    expect(parseStartView("home")).toBe("restore");
    expect(parseStartView("fresh")).toBe("fresh");
  });

  it("names the fresh start after the shell", () => {
    expect(START_VIEWS).toEqual(["restore", "fresh"]);
    expect(startViewLabelKey("restore", "mobile")).toBe(startViewLabelKey("restore", "desktop"));
    expect(startViewLabelKey("fresh", "mobile")).toBe("mobile.tabHome");
    expect(startViewLabelKey("fresh", "desktop")).toBe("settings.startViewEmpty");
  });
});
