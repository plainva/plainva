import { describe, expect, it } from "vitest";
import { acpAbsolutePath, acpFileUri, acpVaultPath, type AcpPathProblem } from "./files.js";

const WINDOWS = "C:\\Users\\mara\\Vault";
const UNIX = "/home/mara/Vault";

/** A root, a path as an agent names it, and the vault path it means — or why it means none. */
export const ACP_PATH_CASES: readonly (readonly [string, string, string | AcpPathProblem])[] = [
  // Windows: a drive letter, either slash, case ignored in the folder's own name.
  [WINDOWS, "C:\\Users\\mara\\Vault\\Plan.md", "Plan.md"],
  [WINDOWS, "C:/Users/mara/Vault/Projects/Plan.md", "Projects/Plan.md"],
  [WINDOWS, "c:\\users\\MARA\\vault\\Projects\\Plan.md", "Projects/Plan.md"],
  [WINDOWS, "\\\\?\\C:\\Users\\mara\\Vault\\Plan.md", "Plan.md"],
  [`${WINDOWS}\\`, "C:\\Users\\mara\\Vault\\Plan.md", "Plan.md"],
  ["\\\\?\\C:\\Users\\mara\\Vault", "C:\\Users\\mara\\Vault\\Plan.md", "Plan.md"],
  ["\\\\nas\\share\\Vault", "\\\\nas\\share\\Vault\\Plan.md", "Plan.md"],
  ["\\\\nas\\share\\Vault", "\\\\?\\UNC\\nas\\share\\Vault\\Plan.md", "Plan.md"],
  [WINDOWS, "C:\\Users\\mara\\Vault", "outside"],
  [WINDOWS, "C:\\Users\\mara\\Vault\\", "outside"],
  [WINDOWS, "C:\\Users\\mara\\Vault2\\Plan.md", "outside"],
  [WINDOWS, "C:\\Users\\mara\\Plan.md", "outside"],
  [WINDOWS, "D:\\Users\\mara\\Vault\\Plan.md", "outside"],
  [WINDOWS, "Plan.md", "not-absolute"],
  [WINDOWS, "/home/mara/Vault/Plan.md", "not-absolute"],
  [WINDOWS, "C:Plan.md", "not-absolute"],
  [WINDOWS, "C:\\Users\\mara\\Vault\\..\\secret.txt", "unsafe"],
  [WINDOWS, "C:\\Users\\mara\\Vault\\Notes\\..\\..\\secret.txt", "unsafe"],
  [WINDOWS, "C:\\Users\\mara\\Vault\\Plan.md:stream", "unsafe"],
  [WINDOWS, "C:\\Users\\mara\\Vault\\Private.\\Plan.md", "unsafe"],
  [WINDOWS, "C:\\Users\\mara\\Vault\\Plan.md ", "unsafe"],
  [WINDOWS, "C:\\Users\\mara\\Vault\\\\Plan.md", "unsafe"],
  [WINDOWS, "C:\\Users\\mara\\Vault\\.\\Plan.md", "unsafe"],
  [WINDOWS, "C:\\Users\\mara\\Vault\\.plainva\\index.db", "hidden"],
  [WINDOWS, "C:\\Users\\mara\\Vault\\.AGENT\\policy.yml", "hidden"],
  [WINDOWS, "C:\\Users\\mara\\Vault\\.obsidian\\app.json", "hidden"],
  // A dot folder of the user's own is theirs.
  [WINDOWS, "C:\\Users\\mara\\Vault\\.notes\\Plan.md", ".notes/Plan.md"],
  // Everywhere else: one slash, case kept.
  [UNIX, "/home/mara/Vault/Plan.md", "Plan.md"],
  [UNIX, "/home/mara/Vault/Projects/2026/Plan.md", "Projects/2026/Plan.md"],
  [`${UNIX}/`, "/home/mara/Vault/Plan.md", "Plan.md"],
  [UNIX, "/home/mara/vault/Plan.md", "outside"],
  [UNIX, "/home/mara/Vault", "outside"],
  [UNIX, "/home/mara/Vault/", "outside"],
  [UNIX, "/home/mara/Vault2/Plan.md", "outside"],
  [UNIX, "/etc/passwd", "outside"],
  [UNIX, "Plan.md", "not-absolute"],
  [UNIX, "./Plan.md", "not-absolute"],
  [UNIX, "C:\\Users\\mara\\Vault\\Plan.md", "not-absolute"],
  [UNIX, "/home/mara/Vault/../.ssh/id_ed25519", "unsafe"],
  [UNIX, "/home/mara/Vault/a/./b.md", "unsafe"],
  [UNIX, "/home/mara/Vault//Plan.md", "unsafe"],
  [UNIX, "/home/mara/Vault/back\\slash.md", "unsafe"],
  [UNIX, "/home/mara/Vault/Plan.md.", "unsafe"],
  [UNIX, "/home/mara/Vault/time 12:30.md", "unsafe"],
  [UNIX, "/home/mara/Vault/.git/config", "hidden"],
  [UNIX, "/home/mara/Vault/.trash/old.md", "hidden"],
  [UNIX, "/home/mara/Vault/.Plainva/sync/state.json", "hidden"],
  // The vault's folder itself may be the root of a disk.
  ["/", "/Plan.md", "Plan.md"],
];

describe("the file of the vault an agent's path means", () => {
  it.each(ACP_PATH_CASES)("%s · %s → %s", (root, absolute, expected) => {
    const found = acpVaultPath(root, absolute);
    expect(found.ok ? found.path : found.problem).toBe(expected);
  });

  it("compares names in one spelling of their letters", () => {
    // "é" as one character and as "e" with an accent: the same folder, the same file.
    const composed = String.fromCharCode(0xe9);
    const decomposed = `e${String.fromCharCode(0x301)}`;
    expect(acpVaultPath(`/home/mara/Caf${composed}`, `/home/mara/Caf${decomposed}/Men${decomposed}.md`)).toEqual({ ok: true, path: `Men${composed}.md` });
  });

  it("refuses a name with a character nobody sees, and one that is too long", () => {
    expect(acpVaultPath(UNIX, `/home/mara/Vault/a${String.fromCharCode(7)}.md`)).toEqual({ ok: false, problem: "unsafe" });
    expect(acpVaultPath(UNIX, `/home/mara/Vault/${"a".repeat(1025)}`)).toEqual({ ok: false, problem: "unsafe" });
  });

  it("reads a folder that is no absolute path as none", () => {
    expect(acpVaultPath("Vault", "/Vault/Plan.md")).toEqual({ ok: false, problem: "outside" });
    expect(acpVaultPath("", "/Plan.md")).toEqual({ ok: false, problem: "outside" });
  });
});

describe("a file of the vault as an agent is told about it", () => {
  it("is an address with every part escaped", () => {
    expect(acpFileUri(WINDOWS, "Projects/Plan A.md")).toBe("file:///C:/Users/mara/Vault/Projects/Plan%20A.md");
    expect(acpFileUri(UNIX, "Projects/Plan A.md")).toBe("file:///home/mara/Vault/Projects/Plan%20A.md");
    expect(acpFileUri(UNIX, "a#b?c.md")).toBe("file:///home/mara/Vault/a%23b%3Fc.md");
    expect(acpFileUri("\\\\nas\\share\\Vault", "Plan.md")).toBe("file://nas/share/Vault/Plan.md");
    expect(acpFileUri("\\\\?\\C:\\Vault", "Plan.md")).toBe("file:///C:/Vault/Plan.md");
  });

  it("is a path in the spelling of the vault's own folder", () => {
    expect(acpAbsolutePath(WINDOWS, "Projects/Plan.md")).toBe("C:\\Users\\mara\\Vault\\Projects\\Plan.md");
    expect(acpAbsolutePath("C:/Users/mara/Vault/", "Projects/Plan.md")).toBe("C:/Users/mara/Vault/Projects/Plan.md");
    expect(acpAbsolutePath(`${UNIX}/`, "Projects/Plan.md")).toBe("/home/mara/Vault/Projects/Plan.md");
  });

  it("round-trips: what Plainva names is what it reads back", () => {
    for (const root of [WINDOWS, UNIX]) {
      for (const path of ["Plan.md", "Projects/2026/Plan A.md"]) expect(acpVaultPath(root, acpAbsolutePath(root, path))).toEqual({ ok: true, path });
    }
  });
});
