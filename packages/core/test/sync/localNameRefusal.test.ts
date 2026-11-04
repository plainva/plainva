import { describe, expect, it } from "vitest";
import { localNameRefusal, nameRuleBroken } from "../../src/sync/localNameRefusal.js";

describe("names a file system refuses (Sammelplan § 3.158 Nr. 7)", () => {
  it("knows the rules some file system holds", () => {
    expect(nameRuleBroken("Notes/plain.md")).toBeNull();
    expect(nameRuleBroken("Notes/Ünïcødé – ok.md")).toBeNull();
    expect(nameRuleBroken("Q: what.md")).toMatch(/character/);
    expect(nameRuleBroken("a|b/c.md")).toMatch(/character/);
    expect(nameRuleBroken("folder./c.md")).toMatch(/dot or a space/);
    expect(nameRuleBroken("CON.md")).toMatch(/reserved/);
    expect(nameRuleBroken("lpt1")).toMatch(/reserved/);
    expect(nameRuleBroken("console.md")).toBeNull();
    expect(nameRuleBroken(`${"ü".repeat(128)}.md`)).toMatch(/255 bytes/);
  });

  it("takes the platform's word for a name error, whatever the name", async () => {
    const never = async () => { throw new Error("must not ask"); };
    expect(await localNameRefusal("plain.md", new Error("rename failed: File name too long (os error 36)"), never)).toMatch(/refused the name/);
    expect(await localNameRefusal("plain.md", new Error("ENAMETOOLONG: name too long"), never)).toMatch(/refused the name/);
  });

  it("blames the name only for a broken rule, a failure waiting does not cure, and no such file here", async () => {
    const absent = async () => false;
    const present = async () => true;
    expect(await localNameRefusal("Q: what.md", new Error("Unable to write file"), absent)).toMatch(/refused the name/);
    expect(await localNameRefusal("Q: what.md", new Error("Unable to write file"), present)).toBeNull();
    expect(await localNameRefusal("Q: what.md", new Error("network timeout"), absent)).toBeNull();
    expect(await localNameRefusal("plain.md", new Error("Unable to write file"), absent)).toBeNull();
  });
});
