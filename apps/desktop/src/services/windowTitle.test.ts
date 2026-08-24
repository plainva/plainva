import { describe, it, expect } from "vitest";
import { composeWindowTitle } from "./windowTitle";

/**
 * Naming windows when more than one vault is open (stage D).
 */
describe("composeWindowTitle", () => {
  it("names a window after what it shows while one vault is open", () => {
    // The folder name would be noise for everyone who never opens a second one.
    expect(composeWindowTitle({ subject: "Tasks", vaultPath: "/home/me/Notes", vaultCount: 1 }))
      .toBe("Tasks — Plainva");
  });

  it("adds the vault once there are two, which is the point of the rule", () => {
    // Two taskbar entries called "Tasks — Plainva" belong to two vaults and
    // nothing on the button says which.
    expect(composeWindowTitle({ subject: "Tasks", vaultPath: "/home/me/Notes", vaultCount: 2 }))
      .toBe("Tasks — Notes — Plainva");
  });

  it("does not say the vault twice when the vault IS the subject", () => {
    // A workplace window shows no single piece of content, so the vault is
    // already its name — "Notes — Notes — Plainva" is what this prevents.
    expect(composeWindowTitle({ vaultPath: "/home/me/Notes", vaultCount: 2 })).toBe("Notes — Plainva");
  });

  it("falls back to the app name with nothing open", () => {
    expect(composeWindowTitle({ vaultCount: 0 })).toBe("Plainva");
  });

  it("reads the folder name off either separator", () => {
    // Windows paths reach this from the same settings the POSIX ones do.
    expect(composeWindowTitle({ vaultPath: "C:\\Users\\me\\Vault\\", vaultCount: 2 })).toBe("Vault — Plainva");
  });
});
