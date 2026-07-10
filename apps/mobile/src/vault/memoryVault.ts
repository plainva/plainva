// M1 "Hello Vault": an in-memory note store proving the shared editor works
// against the mobile shell. M2 replaces this with CapacitorVaultAdapter
// (app-sandbox filesystem) + the real indexer.

export interface VaultEntry {
  path: string;
  title: string;
}

const OKF = (type: string, title: string, body: string) =>
  `---\ntype: ${type}\nokf_version: "1.0"\n---\n\n# ${title}\n\n${body}\n`;

const notes = new Map<string, string>([
  [
    "Willkommen.md",
    OKF(
      "Note",
      "Willkommen",
      "Das ist der mobile Plainva-Prototyp (M1).\n\n- Der Editor hier ist DERSELBE wie am Desktop (`@plainva/ui`).\n- Tippe auf **+** für eine neue Notiz.\n- Wiki-Links funktionieren: [[Plainva Mobile]]\n\n> Sync und echte Dateien kommen mit M2/M3.",
    ),
  ],
  [
    "Inbox/Erste Idee.md",
    OKF("Note", "Erste Idee", "Schnell erfasst, später einsortiert."),
  ],
  [
    "Projekte/Plainva Mobile.md",
    OKF(
      "Note",
      "Plainva Mobile",
      "Companion-App: erfassen, lesen, finden.\n\n- [ ] M1 Gerüst\n- [ ] M2 Adapter\n- [ ] M3 Sync\n\nZurück zu [[Willkommen]].",
    ),
  ],
]);

let counter = 0;

export const memoryVault = {
  read(path: string): string {
    return notes.get(path) ?? "";
  },
  save(path: string, text: string): void {
    notes.set(path, text);
  },
  exists(path: string): boolean {
    return notes.has(path);
  },
  createNote(folder: string, type: string): string {
    counter += 1;
    const title = `Notiz ${counter}`;
    const path = `${folder}/${title}.md`;
    notes.set(path, OKF(type, title, ""));
    return path;
  },
  ensureNote(path: string, type: string, title: string): string {
    if (!notes.has(path)) notes.set(path, OKF(type, title, ""));
    return path;
  },
  /** Wiki-link resolution by basename (good enough for the M1 demo). */
  resolveWikiTarget(target: string): string | null {
    const name = target.split("#")[0].split("|")[0].trim().toLowerCase();
    for (const path of notes.keys()) {
      const base = path.split("/").pop()!.replace(/\.md$/i, "").toLowerCase();
      if (base === name) return path;
    }
    return null;
  },
  listFolder(folder: string): { folders: string[]; notes: VaultEntry[] } {
    const prefix = folder ? folder + "/" : "";
    const folders = new Set<string>();
    const out: VaultEntry[] = [];
    for (const path of [...notes.keys()].sort()) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash === -1) {
        out.push({ path, title: rest.replace(/\.md$/i, "") });
      } else {
        folders.add(rest.slice(0, slash));
      }
    }
    return { folders: [...folders].sort(), notes: out };
  },
  recent(limit: number): VaultEntry[] {
    return [...notes.keys()]
      .slice(0, limit)
      .map((path) => ({ path, title: path.split("/").pop()!.replace(/\.md$/i, "") }));
  },
};
