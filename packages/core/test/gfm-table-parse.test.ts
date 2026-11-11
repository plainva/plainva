import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fixtureFiles } from "../scripts/perf/fixtureVault.ts";
import { tablesNote } from "../scripts/perf/many-tables.ts";
import { parseMarkdownAst } from "../src/markdown-parser.ts";
import { NASTY_TABLES, treeDigest } from "./gfmTableCorpus.ts";
import { within } from "./helpers/timeBudget.ts";

/**
 * Reading GFM tables (Gesamtplan Leistung L13).
 *
 * `micromark-extension-gfm-table` up to 2.1.1 looked up each edit of its table
 * resolver by walking every edit made before it — one per cell boundary of the
 * whole note, so reading a note cost the square of its table cells: 80 tables
 * of 50 rows took 39 s, the fixture vault's note of 80 tables of 200 rows
 * minutes, for the index pass, the note source and the reading view alike.
 * 2.1.2 keeps the edits in a map by index (upstream commit 4f43ead3).
 *
 * The pins below are the digests of the trees 2.1.1 made, recorded before the
 * upgrade: every node, value and position through both entry points that read
 * tables (`gfmTableCorpus.ts`). They hold the parse result where it was; a
 * parser upgrade that moves one is a decision to look at, not an accident.
 */
const PINS: Record<string, string> = {
  plain: "3a0c2dda1ec0f0657296288bdfd394bb9cb4e37ef64c150a36c9e81b5acb5b89",
  alignmentRow: "6f57d3a064b9fcf1d987ca7dc9696718312880bd10f9974d45320fe725ff97a4",
  escapedPipes: "9b2514deff6a6836755cdcb41e602719dfa4d89e97263f64ac83840e414c7b4c",
  codeWithPipes: "2b5a7df569450727db7ca06369cdfd8a76d47193c4bbb106b47bf86f4bad1e86",
  linksAndTasksInCells: "0b54a649964d2162fcfc2cdaa154ac4eb64d25071b934e43f3a59ac7306f3c2a",
  wikiLinkPipeInCell: "83d91af9bc02838467c6c2c47b54de8cfd8913c57adaeb9fcec6a9f7749ab67e",
  directlyAfterParagraph: "eb1da3adb04c44aaa2b6f0c6f067b590b6fe1255d49b7f5db2ebf3080445e54c",
  paragraphInterruptedTwice: "4419fdc7a94d05404e9e4a90e292a7d379c65c620b6ea9fe9b3ebf17e419d643",
  inList: "c1b6c0abc291982a3aa3703c3c35a3b43c49d7014a7e095248c798beb49625ee",
  inOrderedList: "3c27d48444d6116f908d04a6eec38cc4b14c039beb3d8c5dc313c858d031f3e6",
  inBlockquote: "1ae5a118665d529eff590d7bab38bb4db6db2e9d1da082a88a62850752047b21",
  inCallout: "d3ee2a8310dabdd8765a0a2a63fb13e1ac422715c395b5892bdeb23fe3fa289d",
  nestedQuoteLazy: "a43f4d4badf0891ce3858fdbcfdf285b331e4f2db55817a83b3116f2d5a1ed38",
  noOuterPipes: "57bb1392045202a5de08e2da3579285e571175e1e4ccbe6801b62e857d3cd854",
  mixedOuterPipes: "7ec5106f97f016a84231998a9b81529fefe478a8ba7dff280ae593156f5ac0b0",
  lastLineWithoutNewline: "221e8338daced7ae25e61754b2c4d0faaca021d444350986a423f79d43c14981",
  crlf: "216abbc27f0439f33fb62afcec3ffc3cfbe8fc21e16abdfc540692c0678eaf6d",
  byteOrderMark: "1cdc9675cb4b228729c805d953429bdb5c8e6c3aafa39c8b65bd146238cfddbb",
  frontmatterThenTable: "85a4cf1ffa95c6936dd411d597492bf6d1ca4acc4863ed1d4c537702be6423b4",
  malformedDelimiter: "16a9b7d60e2f204932dc78151fb5d9a9dc8d9c454d1d9eb9da2412d145752c6e",
  delimiterCountMismatch: "a6648fe54a47cdd3262d02da7c2200ecd1f3685e0bfdaa073ab572e367d6c43f",
  delimiterWithoutDash: "65ea156d9d394a3d80874bfb630a070bb621ca857d34be69d0dc32189aade02a",
  delimiterIndentedCode: "e4b33f5f6c9ad864201ed95f893f948fb5257418dc888ab9c05c1c3fffd5b35d",
  raggedRows: "fcd4c788845a3f2899a3f635439373ff4c3fb8b09c388b2de65c8ab9d89cdf3d",
  emptyCells: "58ba532a804a28787b722246759ea36d6616f441e28835640d52dad23131bc73",
  singleColumn: "aba5613326bcece638545e8fc02dd8aa97986fd7a4844a91df717ee211ea38f4",
  delimiterLikeBodyRow: "ca828d9b3ab1cb44241d9f0251b5228867ead9d571383d44f8e49b49c58154a1",
  inlineMarkupInCells: "bcbc227ee5d699a062784f3104e6643b50de768ff5ede1b3b9ffcb7f4ccb34b0",
  htmlCommentAround: "7e5ebf2129541d9a8d1a2212e3e781ec7aefe01be820a6c34aabbe73272fe8c8",
  tableThenHeadingThenTable: "dba9d0289a9dc1e29cb70b01c01c30c7900ecd39a7a6568fefc00f7abe72d3bc",
  adjacentTables: "10804a725fa196a306d3948c54c5413a864f98a3598c8b0c501ad59ebb7390f7",
  tableInFencedCode: "e8d5e7c1107f9d3ea1621baa8f50ddb0b3b8d65af7684da8f05aefc76b585fa8",
  tabsInCells: "3a0c2dda1ec0f0657296288bdfd394bb9cb4e37ef64c150a36c9e81b5acb5b89",
  unicodeCells: "f93b3d362793b129f773c100041116831541917e924c0f70b1f4ee62f60bb341",
  thousandRows: "760e3a8b34e4f02cac10a25cabba34be482921ce5344f837d1d19beeee646d12",
  manyTablesInList: "929e81fd000a468f0b4a04ab1a197748ea78472d91c18849d9b1aaed69e280b2",
  manyTablesInQuotes: "1a53d2bd55c1bf3bdae6b230b3ff9217407c7d01355cddc95f1eef0a29252c18",
  "fixture:all": "adab711456f03d2a4ec36f852b72e739e4a2e4914c130dc81bc815c1514403fb",
  "fixture:long": "bb12057a4c3d82fdad1aa7ca42fa8b5883947320de146e9e3d2c87322a501356",
};

describe("GFM tables are read as before, in time linear in the note", () => {
  it("every hard table reads into the tree it read into before", () => {
    const actual = Object.fromEntries(Object.keys(NASTY_TABLES).map((name) => [name, treeDigest(NASTY_TABLES[name])]));
    const pinned = Object.fromEntries(Object.keys(NASTY_TABLES).map((name) => [name, PINS[name]]));
    expect(actual).toEqual(pinned);
  });

  it("every note of the fixture vault reads into the tree it read into before, the long table note included", () => {
    const all = createHash("sha256");
    let long = "";
    for (const file of fixtureFiles({ count: 1000 })) {
      if (!file.path.endsWith(".md")) continue;
      const digest = treeDigest(file.data as string);
      if (file.path.endsWith("Long table note.md")) long = digest;
      all.update(file.path + "\0" + digest + "\0");
    }
    expect({ all: all.digest("hex"), long }).toEqual({ all: PINS["fixture:all"], long: PINS["fixture:long"] });
  }, 60_000);

  it("80 tables of 50 rows read in well under a second, not in the square of their cells", () => {
    // Quadratic, this note took 19-39 s on the reference machine (Performance_Notes.md,
    // "Many tables in one note"); linear, about 0.6 s. The budget is five times that,
    // scaled to a slower core by within(), and still misses the quadratic parse.
    const text = tablesNote(80, 50);
    const tree = within(3_000, () => parseMarkdownAst(text, { preserveObsidianSyntax: true }));
    expect(tree.children.filter((node) => node.type === "table")).toHaveLength(80);
  }, 60_000);
});
