import { describe, expect, it } from "vitest";
import { buildLinkNameIndex, filesALinkCouldMean, isNotePath, linkTargetForms, notesALinkCouldMean, type NamedFile } from "./linkNames.js";

/**
 * Which files a link could mean (AI harness P5-7b): wider than any one rule
 * the app follows a link by. The vault below is built around the cases in
 * which the desktop's editor, the phone and the graph disagree.
 */
const FILES: NamedFile[] = [
  // A note whose properties give it another title than its file's name.
  { path: "Projects/Brief.md", title: "Offer letter" },
  { path: "Projects/Hafenkante/Brief.md", title: "Brief" },
  { path: "Projects/Offer.md", title: "Offer" },
  { path: "Private/Diary.md", title: "Diary" },
  { path: "Diary.md", title: "Diary" },
  { path: "Archive/2025/Private/Salaries.md", title: "Salaries" },
  { path: "Notes/Ärger.md", title: "Ärger" },
  { path: "Notes/C# notes.md", title: "C# notes" },
  { path: "Notes/My Note.md", title: "My Note" },
  // What is no note is found by its name as it is.
  { path: "Private/Clients.base", title: "Clients.base" },
  { path: "Assets/photo.png", title: "photo.png" },
  // A file the index holds without a title.
  { path: "Inbox/Untitled.md", title: null },
];
const index = buildLinkNameIndex(FILES);
const from = "Projects/Offer.md";
const mean = (target: string, fromPath = from) => filesALinkCouldMean(index, target, fromPath);

describe("the files a link could mean", () => {
  it("finds a note by its file's name although its properties give it another title — and by that title as well", () => {
    // The desktop's editor follows a link by the title: it would not find this note under its file's name.
    expect(mean("Brief")).toEqual(["Projects/Brief.md", "Projects/Hafenkante/Brief.md"]);
    // The phone follows a link by the file's name: it would not find it under its title.
    expect(mean("Offer letter")).toEqual(["Projects/Brief.md"]);
  });

  it("finds a note by the end of its path, however many folders the link leaves out", () => {
    expect(mean("Hafenkante/Brief")).toEqual(["Projects/Hafenkante/Brief.md"]);
    expect(mean("Private/Salaries")).toEqual(["Archive/2025/Private/Salaries.md"]);
    expect(mean("2025/Private/Salaries.md")).toEqual(["Archive/2025/Private/Salaries.md"]);
    // The end of a path starts at a folder: half a folder's name is no end of it.
    expect(mean("rivate/Salaries")).toEqual([]);
    expect(mean("ate/Diary")).toEqual([]);
  });

  it("names every note that shares a name: which of them a tap opens differs by shell", () => {
    expect(mean("Diary").sort()).toEqual(["Diary.md", "Private/Diary.md"]);
    // The note next to the link comes first, then the one at the root: how closely a rule names a file.
    expect(mean("Diary", "Private/Other.md")).toEqual(["Private/Diary.md", "Diary.md"]);
  });

  it("reads a path from the note the link stands in, as a Markdown link is read — and never out of the vault", () => {
    expect(mean("../Private/Diary.md")).toEqual(["Private/Diary.md"]);
    expect(mean("./Hafenkante/Brief.md")).toEqual(["Projects/Hafenkante/Brief.md"]);
    expect(mean("../../Private/Diary.md")).toEqual([]);
    expect(mean("../Diary.md", "Private/Other.md")).toEqual(["Diary.md"]);
    // From the vault's root, with a leading slash: not from the note's folder.
    expect(mean("/Private/Diary.md")).toEqual(["Private/Diary.md"]);
    expect(mean("/Diary")).toEqual(["Diary.md", "Private/Diary.md"]);
  });

  it("takes a link's spelling as people read it: letter case, composed and decomposed letters, percent escapes, backslashes, the extension", () => {
    expect(mean("ärger")).toEqual(["Notes/Ärger.md"]);
    expect(mean("ÄRGER.MD")).toEqual(["Notes/Ärger.md"]);
    // "A" with a combining diaeresis: the spelling a file from a Mac may carry.
    expect(mean(`A${String.fromCharCode(0x308)}rger`)).toEqual(["Notes/Ärger.md"]);
    expect(mean("Notes/My%20Note.md")).toEqual(["Notes/My Note.md"]);
    expect(mean("Notes\\My Note")).toEqual(["Notes/My Note.md"]);
    // A name may hold a "#": the caller has taken a heading off, so what is left is the name.
    expect(mean("C# notes")).toEqual(["Notes/C# notes.md"]);
    expect(mean("Notes/C%23%20notes.md")).toEqual(["Notes/C# notes.md"]);
    // What looks like an escape and is none stays as written.
    expect(mean("100%")).toEqual([]);
    expect(linkTargetForms("a%20b")).toEqual(["a%20b", "a b"]);
    expect(linkTargetForms(" a%ZZ ")).toEqual(["a%ZZ"]);
  });

  it("finds what is no note by its name as it is, and a note with or without its extension", () => {
    expect(mean("Clients.base")).toEqual(["Private/Clients.base"]);
    expect(mean("photo.png")).toEqual(["Assets/photo.png"]);
    // A database is not found under a note's spelling of its name, nor a picture without its extension.
    expect(mean("Clients")).toEqual([]);
    expect(mean("photo")).toEqual([]);
    expect(mean("Untitled")).toEqual(["Inbox/Untitled.md"]);
    expect(mean("Untitled.md")).toEqual(["Inbox/Untitled.md"]);
    expect(isNotePath("a/B.MD")).toBe(true);
    expect(isNotePath("a/b.base")).toBe(false);
  });

  it("names nothing for a link that names nothing", () => {
    for (const target of ["", "  ", "/", "..", ".", "Nobody", "Projects", "Projects/", "https://example.org/Diary"]) expect(mean(target), target).toEqual([]);
  });

  it("the notes among them are what a link to a note could mean", () => {
    expect(notesALinkCouldMean(index, "Clients.base", from)).toEqual([]);
    expect(notesALinkCouldMean(index, "Diary", from).sort()).toEqual(["Diary.md", "Private/Diary.md"]);
  });

  it("takes the index as it comes: a row without a path, a path with a leading slash or backslashes, the same file twice", () => {
    const odd = buildLinkNameIndex([
      { path: "/Rooted/Note.md" },
      { path: "Win\\Folder\\Note.md" },
      { path: "Twice.md" },
      { path: "Twice.md" },
      { path: "" },
      { path: undefined as unknown as string },
      null as unknown as NamedFile,
      { path: ".md" },
    ]);
    expect(filesALinkCouldMean(odd, "Note", "x.md").sort()).toEqual(["Rooted/Note.md", "Win/Folder/Note.md"]);
    expect(filesALinkCouldMean(odd, "Twice", "x.md")).toEqual(["Twice.md"]);
    expect(filesALinkCouldMean(odd, "Folder/Note", "x.md")).toEqual(["Win/Folder/Note.md"]);
  });

  it("answers from maps, however large the vault and however common the name", () => {
    const many: NamedFile[] = [];
    for (let folder = 0; folder < 4_000; folder++) many.push({ path: `Area ${folder}/Sub/index.md`, title: "index" }, { path: `Area ${folder}/Note ${folder}.md`, title: `Note ${folder}` });
    const started = Date.now();
    const big = buildLinkNameIndex(many);
    expect(filesALinkCouldMean(big, "index", "Area 7/x.md")).toHaveLength(4_000);
    for (let ask = 0; ask < 2_000; ask++) expect(filesALinkCouldMean(big, `Note ${ask}`, "x.md")).toEqual([`Area ${ask}/Note ${ask}.md`]);
    expect(Date.now() - started).toBeLessThan(4_000);
  });
});
