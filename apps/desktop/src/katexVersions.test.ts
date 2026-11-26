import { describe, expect, it } from "vitest";
import katex from "katex";
import katexBefore from "katex-0.16";

/**
 * One KaTeX in the app (performance plan L5): mermaid, rehype-katex and micromark-extension-math asked for KaTeX 0.16
 * beside the app's 0.19, and both copies were built; the root `package.json` makes the three use 0.19.1 too. This
 * holds what that changes, over a corpus of formulas, in each way the app renders one:
 *
 * - the reading view (rehype-katex): `throwOnError: true`, and on an error once more with `strict: "ignore"` and
 *   `throwOnError: false`;
 * - the editor's live preview (`mathMermaidLive.ts`): `throwOnError: false`;
 * - mermaid's labels: `throwOnError: true`, `displayMode: true`, output `htmlAndMathml` (and `mathml`);
 * - the messages of a formula that cannot be read.
 *
 * Every difference between the two versions is listed in KNOWN with what it is; a new one fails the test.
 */
type Katex = typeof katex;

const FORMULAS = [
  "x^2 + y^2 = z^2",
  "\\frac{a}{b} + \\dfrac{1}{2}",
  "\\sqrt{2} \\sqrt[3]{x}",
  "\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}",
  "\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}",
  "\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1",
  "\\mathbb{R}, \\mathcal{L}, \\mathfrak{g}, \\mathrm{d}x, \\mathbf{v}",
  "\\alpha \\beta \\gamma \\Delta \\Omega \\varepsilon",
  "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}",
  "\\begin{bmatrix} 1 & 0 \\\\ 0 & 1 \\end{bmatrix}",
  "f(x) = \\begin{cases} 1 & x > 0 \\\\ 0 & \\text{sonst} \\end{cases}",
  "\\begin{aligned} a &= b + c \\\\ d &= e \\end{aligned}",
  "\\text{Für alle } x \\in \\mathbb{N}",
  "\\operatorname{argmax}_x f(x)",
  "\\overbrace{a + b}^{n} \\underbrace{c + d}_{m}",
  "\\vec{v} \\cdot \\hat{n} \\quad \\bar{x} \\tilde{y}",
  "\\left( \\frac{a}{b} \\right) \\left[ x \\right] \\left\\{ y \\right\\}",
  "a \\leq b \\geq c \\neq d \\approx e \\equiv f",
  "\\color{red}{x} + \\textcolor{blue}{y}",
  "\\binom{n}{k} = \\frac{n!}{k!(n-k)!}",
  "\\tag{1} E = mc^2",
  "\\underset{x}{\\operatorname{min}} \\overset{!}{=}",
  "\\xrightarrow{f} \\Rightarrow \\iff \\mapsto",
  "\\mathrm{H_2O}",
  "\\infty \\partial \\nabla \\forall \\exists",
  "∑ α → ∞",
  "\\def\\R{\\mathbb{R}} \\R^n",
  "\\begin{array}{c|c} 1 & 2 \\\\ \\hline 3 & 4 \\end{array}",
];
/** What cannot be read: the reading view's fallback, the preview's error and the message both say. */
const BROKEN = ["\\frac{1}", "x^{2", "\\unknowncommand{x}", "\\begin{pmatrix} a", "a_ _b", "\\left( x"];

function reader(k: Katex, value: string, displayMode: boolean): string {
  try {
    return k.renderToString(value, { displayMode, throwOnError: true });
  } catch {
    try {
      return k.renderToString(value, { displayMode, strict: "ignore", throwOnError: false });
    } catch (error) {
      return `error:${String(error)}`;
    }
  }
}
const preview = (k: Katex, value: string, displayMode: boolean) => k.renderToString(value, { throwOnError: false, displayMode });
function mermaid(k: Katex, value: string, output: "htmlAndMathml" | "mathml"): string {
  try {
    return k.renderToString(value, { throwOnError: true, displayMode: true, output }).replace(/\n/g, " ").replace(/<annotation.*<\/annotation>/g, "");
  } catch (error) {
    return `error:${(error as Error).message}`;
  }
}
function message(k: Katex, value: string): string {
  try {
    k.renderToString(value, { throwOnError: true });
    return "no error";
  } catch (error) {
    return (error as Error).message;
  }
}

/** Each difference: the use, the formula, and what it is. Empty: the versions agree everywhere. */
const KNOWN: Record<string, string> = {};

/**
 * KaTeX 0.17+ prefixed thirteen classes of its markup with `katex-` (`base` → `katex-base`, `strut`, `sizing`, `root`,
 * `accent`, `stretchy`, `overlay`, `vbox`, `thinbox`, `inner`, `fix`, `tag`, `hline`): a page's own `.base` no longer
 * styles a formula. The stylesheet the app ships is 0.19.1's and styles the new names — with 0.16 inside mermaid, a
 * formula in a diagram was drawn by 0.16 under 0.19's stylesheet. The rename is held on its own below; the comparison
 * reads past it.
 */
const RENAMED = ["base", "strut", "sizing", "root", "accent", "stretchy", "overlay", "vbox", "thinbox", "inner", "fix", "tag", "hline"];
const renamedClass = new RegExp(`(?<=class="(?:[^"]* )?)(${RENAMED.join("|")})(?=[ "])`, "g");
const past = (html: string) => html.replace(renamedClass, "katex-$1");

function differences(): string[] {
  const found: string[] = [];
  const compare = (use: string, value: string, render: (k: Katex) => string) => {
    if (render(katex) !== past(render(katexBefore as unknown as Katex))) found.push(`${use}: ${value}`);
  };
  for (const value of FORMULAS) {
    for (const display of [false, true]) {
      compare(`reader${display ? " (display)" : ""}`, value, (k) => reader(k, value, display));
      compare(`preview${display ? " (display)" : ""}`, value, (k) => preview(k, value, display));
    }
    compare("mermaid", value, (k) => mermaid(k, value, "htmlAndMathml"));
    compare("mermaid (mathml)", value, (k) => mermaid(k, value, "mathml"));
  }
  for (const value of BROKEN) {
    compare("reader (broken)", value, (k) => reader(k, value, false));
    compare("preview (broken)", value, (k) => preview(k, value, false));
    compare("message", value, (k) => message(k, value));
  }
  return found;
}

describe("KaTeX 0.19.1 for every way the app renders a formula, against the 0.16 the three libraries asked for", () => {
  it("the two versions are the ones compared", () => {
    expect.hasAssertions();
    expect(katex.version).toBe("0.19.1");
    expect((katexBefore as unknown as Katex).version).toBe("0.16.47");
  });

  it("renames the markup's two classes, and the stylesheet the app ships styles the new names", async () => {
    expect.hasAssertions();
    const now = katex.renderToString("x^2");
    const before = (katexBefore as unknown as Katex).renderToString("x^2");
    expect(before).toContain('class="base"');
    expect(now).toContain('class="katex-base"');
    expect(now).not.toMatch(/class="(?:base|strut)"/);
    const { readFileSync } = await import("node:fs");
    const css = readFileSync(require.resolve("katex/dist/katex.css"), "utf8");
    for (const name of RENAMED) expect(css, name).toMatch(new RegExp(`\\.katex-${name}\\b`));
  });

  it("differs only where KNOWN says so", () => {
    expect.hasAssertions();
    expect(differences().sort()).toEqual(Object.keys(KNOWN).sort());
  });
});
