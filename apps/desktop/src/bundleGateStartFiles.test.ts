import { describe, expect, it } from "vitest";
import { startFiles } from "../../../scripts/perf/startFiles.mjs";

/**
 * The files the bundle budget weighs (`scripts/perf/bundle-gate.mjs`) are read off `index.html` as HTML reads it
 * (code scanning #275, js/bad-tag-filter): a tag or attribute name in any case, values in either quotes or none.
 */
const BUILT = `<!doctype html><html><head>
<script type="module" crossorigin src="/assets/index-abc.js"></script>
<link rel="modulepreload" crossorigin href="/assets/vendor-x.js">
<link rel="stylesheet" crossorigin href="/assets/index.css">
<link rel="icon" href="/favicon.svg"><script src="https://cdn.example/x.js" type="module"></script>
</head><body><div id="root"></div></body></html>`;
const EXPECTED = [
  { path: "assets/index-abc.js", entry: true },
  { path: "assets/vendor-x.js", entry: false },
  { path: "assets/index.css", entry: false },
];

describe("the start files of a built page", () => {
  it("reads what a build writes: the entry, each preload and each style sheet of its own", () => {
    expect(startFiles(BUILT)).toEqual(EXPECTED);
  });

  it("reads tags and attributes in any case and values in any quotes", () => {
    const shouted = `<SCRIPT TYPE='Module' SRC=/assets/index-abc.js></SCRIPT>
<Link REL="modulepreload" HREF='/assets/vendor-x.js'>
<LINK rel="preload Stylesheet" href="/assets/index.css">
<LINK REL="icon" HREF="/favicon.svg"><SCRIPT SRC="//cdn.example/x.js" type=module></SCRIPT>`;
    expect(startFiles(shouted)).toEqual(EXPECTED);
  });

  it("takes no tag whose name only begins like one", () => {
    expect(startFiles('<scripts type="module" src="/a.js"><linker rel="stylesheet" href="/b.css">')).toEqual([]);
  });
});
