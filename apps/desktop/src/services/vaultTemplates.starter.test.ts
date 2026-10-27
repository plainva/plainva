import { describe, it, expect } from "vitest";
import { isUntouchedStarter, readStarterManifest, STARTER_MANIFEST_PATH } from "@plainva/core";
import { getVaultTemplates, recognizeStarterFiles, scaffoldVaultTemplate } from "@plainva/ui";

/**
 * A fresh vault's starter content stays behind when the phone copies the vault
 * into a new one for a folder that already holds notes (review 2026-10-27: the
 * starter notes went up into the person's existing wiki). The vault remembers
 * what the scaffold wrote; a vault from before that has it recognised by its
 * bytes, read only, when the copy runs.
 */

class MemoryVault {
  files = new Map<string, { text: string; mtime: number }>();
  dirs = new Set<string>();
  constructor(private readonly clock: () => number) {}
  async listDir(path = "", recursive = false) {
    const inside = (p: string) => (path ? p.startsWith(path + "/") : true) && (recursive || !p.slice(path ? path.length + 1 : 0).includes("/"));
    return [
      ...[...this.dirs].filter(inside).map((p) => ({ path: p, name: p.split("/").pop()!, isDirectory: true, size: 0, mtime: 0 })),
      ...[...this.files].filter(([p]) => inside(p)).map(([p, f]) => ({ path: p, name: p.split("/").pop()!, isDirectory: false, size: f.text.length, mtime: f.mtime })),
    ];
  }
  async exists(path: string) { return this.files.has(path) || this.dirs.has(path); }
  async createDir(path: string) { this.dirs.add(path); }
  async writeTextFile(path: string, content: string) { this.files.set(path, { text: content, mtime: this.clock() }); }
  async readTextFile(path: string) { return this.files.get(path)!.text; }
  async readBinaryFile(path: string) { return new TextEncoder().encode(this.files.get(path)!.text); }
}

const NOW = new Date(2026, 6, 29, 10, 0);
const template = getVaultTemplates("de").find((def) => def.notes.some((note) => note.path.includes("{{today")))
  ?? getVaultTemplates("de")[0];

async function scaffolded(recordStarter?: boolean) {
  const vault = new MemoryVault(() => NOW.getTime());
  await scaffoldVaultTemplate({ isNewVault: true, adapter: vault, template, vaultName: "Mein Vault", subfoldersHeading: "Unterordner", now: NOW, ...(recordStarter === false ? { recordStarter } : {}) });
  return vault;
}

const bytes = (vault: MemoryVault, path: string) => new TextEncoder().encode(vault.files.get(path)!.text);

describe("the starter content of a fresh vault", () => {
  it("is written down when the vault is scaffolded: every file, with the bytes it got", async () => {
    const vault = await scaffolded();
    const manifest = await readStarterManifest(vault);
    const written = [...vault.files.keys()].filter((path) => path !== STARTER_MANIFEST_PATH);
    expect(Object.keys(manifest!.files).sort()).toEqual(written.sort());
    for (const path of written) expect(isUntouchedStarter(manifest, path, bytes(vault, path))).toBe(true);
  });

  it("is the person's as soon as they change it; a generated listing stays the app's while it carries the marker", async () => {
    const vault = await scaffolded();
    const manifest = await readStarterManifest(vault);
    const note = template.notes[0];
    const notePath = [...vault.files.keys()].find((path) => path.endsWith(".md") && !path.endsWith("index.md") && path !== STARTER_MANIFEST_PATH)!;
    expect(note).toBeDefined();
    expect(isUntouchedStarter(manifest, notePath, new TextEncoder().encode(vault.files.get(notePath)!.text + "\nmy own line\n"))).toBe(false);
    const regenerated = vault.files.get("index.md")!.text.replace("Mein Vault", "Mein Vault (neu gelistet)");
    expect(isUntouchedStarter(manifest, "index.md", new TextEncoder().encode(regenerated))).toBe(true);
  });

  it("is recorded as nothing for a vault made to go online at once", async () => {
    const vault = await scaffolded(false);
    expect((await readStarterManifest(vault))?.files).toEqual({});
  });

  it("is recognised by its bytes in a vault scaffolded before the vault remembered it - and the person's own note is not", async () => {
    const vault = await scaffolded();
    vault.files.delete(STARTER_MANIFEST_PATH);
    const touched = [...vault.files.keys()].find((path) => path.endsWith(".md") && !path.endsWith("index.md"))!;
    vault.files.set(touched, { text: vault.files.get(touched)!.text + "\nchanged\n", mtime: NOW.getTime() + 86_400_000 * 5 });
    vault.files.set("Meine Notiz.md", { text: "# Meine Notiz\n", mtime: NOW.getTime() });

    const recognized = await recognizeStarterFiles(vault);

    expect(recognized[touched]).toBeUndefined();
    expect(recognized["Meine Notiz.md"]).toBeUndefined();
    expect(recognized["index.md"]).toBeDefined();
    const untouched = [...vault.files.keys()].filter((path) => path !== touched && path !== "Meine Notiz.md");
    expect(Object.keys(recognized).sort()).toEqual(untouched.sort());
  });
});
