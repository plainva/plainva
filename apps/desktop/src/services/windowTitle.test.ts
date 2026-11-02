import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

  it("calls the vault by the name it has in Plainva (Sammelplan § 3.171 Nr. 4)", () => {
    // A vault renamed in the settings kept its folder's name in the title bar.
    expect(composeWindowTitle({ vaultPath: "/home/me/Notes", vaultName: "Work", vaultCount: 1 })).toBe("Work — Plainva");
    expect(composeWindowTitle({ subject: "Tasks", vaultPath: "/home/me/Notes", vaultName: "Work", vaultCount: 2 }))
      .toBe("Tasks — Work — Plainva");
    // No name of its own: the folder's.
    expect(composeWindowTitle({ vaultPath: "/home/me/Notes", vaultName: null, vaultCount: 1 })).toBe("Notes — Plainva");
  });

  it("is composed in one place, with the vault's name, in every window", () => {
    // The three shells of a window name it through the hook that knows the
    // vault's own name; composing a title by hand would bring the folder back.
    for (const file of ["../App.tsx", "../FullApp.tsx", "../AuxApp.tsx"]) {
      const source = readFileSync(resolve(__dirname, file), "utf8");
      expect(source, file).toContain("useWindowTitle(");
      expect(source, file).not.toContain("composeWindowTitle(");
    }
  });

  it("reads the folder name off either separator", () => {
    // Windows paths reach this from the same settings the POSIX ones do.
    expect(composeWindowTitle({ vaultPath: "C:\\Users\\me\\Vault\\", vaultCount: 2 })).toBe("Vault — Plainva");
  });
});
