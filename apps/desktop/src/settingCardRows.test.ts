import { describe, it, expect } from "vitest";
import ts from "typescript";
import { sourceTexts } from "./test-sourceTree";

/**
 * Everything directly inside a settings card is a row (Design_Language,
 * "Everything directly inside a settings card is a row", 2026-10-29).
 *
 * `.pv-setcard` has no padding of its own; the row brings the inset. A bare
 * element placed in a card sits on its edge: the contrast lines did
 * (2026-09-04, then patched with an inline padding), and so did the radio group
 * and the Cancel/Save row of the sign-in editor in both shells (2026-10-29).
 *
 * The guard reads the JSX: for every `<SettingCard>` it collects the elements
 * that end up as the card's direct children, looking through conditions,
 * fragments and `map` callbacks, and accepts only the row primitives, elements
 * whose own class brings the row inset, and the components listed below with
 * the reason they are rows themselves.
 */

/** The primitives that ARE a card row. */
const ROW_PRIMITIVES = new Set(["SettingRow", "SettingCardNote", "SettingCardBlock", "SettingCardActions"]);

/** Classes whose own rule brings the row inset (checked in ui.css by their owners). */
const INSET_CLASSES = ["pv-setrow", "pv-barfoot", "pv-barrow", "pv-barlabel", "pv-chain", "pv-acct", "pv-svcline", "pv-svcstat"];

/** Components that render a card row of their own, with the reason. */
const ROW_COMPONENTS: Record<string, string> = {
  DayTimeRow: "renders a SettingRow",
  FontSlotRow: "renders a SettingRow",
  LinkStyleSettings: "renders SettingRows",
  RoleMatrix: "renders a SettingCardNote",
  TechDetails: "renders a SettingCardNote",
  MailAccountRow: "renders a .pv-acct row",
  EmptyState: ".pv-empty brings its own padding (--space-6)",
};

function tagName(node: ts.JsxElement | ts.JsxSelfClosingElement, file: ts.SourceFile): string {
  const opening = ts.isJsxElement(node) ? node.openingElement : node;
  return opening.tagName.getText(file);
}

function classNameOf(node: ts.JsxElement | ts.JsxSelfClosingElement, file: ts.SourceFile): string {
  const opening = ts.isJsxElement(node) ? node.openingElement : node;
  for (const prop of opening.attributes.properties) {
    if (ts.isJsxAttribute(prop) && prop.name.getText(file) === "className" && prop.initializer) return prop.initializer.getText(file);
  }
  return "";
}

/** The elements a card renders as its direct children, through conditions, fragments and maps. */
function directChildren(children: readonly ts.Node[]): Array<ts.JsxElement | ts.JsxSelfClosingElement> {
  const out: Array<ts.JsxElement | ts.JsxSelfClosingElement> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) && /^(React\.)?Fragment$/.test(node.openingElement.tagName.getText())) { node.children.forEach(visit); return; }
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) { out.push(node); return; }
    if (ts.isJsxText(node)) return;
    if (ts.isJsxFragment(node)) { node.children.forEach(visit); return; }
    if (ts.isJsxExpression(node)) { if (node.expression) visit(node.expression); return; }
    if (ts.isParenthesizedExpression(node)) { visit(node.expression); return; }
    if (ts.isBinaryExpression(node)) { visit(node.right); return; }
    if (ts.isConditionalExpression(node)) { visit(node.whenTrue); visit(node.whenFalse); return; }
    if (ts.isCallExpression(node)) { node.arguments.forEach(visit); return; }
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      if (ts.isBlock(node.body)) node.body.statements.forEach((s) => { if (ts.isReturnStatement(s) && s.expression) visit(s.expression); });
      else visit(node.body);
    }
  };
  children.forEach(visit);
  return out;
}

function bareChildren(rel: string, text: string): string[] {
  const file = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const walk = (node: ts.Node): void => {
    if (ts.isJsxElement(node) && tagName(node, file) === "SettingCard") {
      for (const child of directChildren(node.children)) {
        const name = tagName(child, file);
        if (ROW_PRIMITIVES.has(name) || ROW_COMPONENTS[name]) continue;
        const cls = classNameOf(child, file);
        if (INSET_CLASSES.some((c) => new RegExp(`\\b${c}\\b`).test(cls))) continue;
        found.push(`${rel} <${name}>`);
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(file);
  return found;
}

/**
 * The places that held a bare element when the guard came (2026-10-29), by
 * file and tag with their count. The list only shrinks: the settings plan of
 * 2026-10-29 (package P1) turns every entry into rows. A new bare element, or
 * one more of a listed kind, fails the run.
 */
const BASELINE: Record<string, number> = {
  "apps/desktop/src/components/mail/MailAccountsSection.tsx <OrphanedMailNotice>": 1,
  "apps/desktop/src/components/security/QuarantineCard.tsx <div>": 1,
  "apps/desktop/src/components/security/QuarantineCard.tsx <p>": 2,
  "apps/desktop/src/components/security/QuarantineCard.tsx <section>": 2,
  "apps/desktop/src/components/security/SecuritySharingPage.tsx <Banner>": 5,
  // A card inside a card: RekeyProgressCard renders a SettingCard of its own.
  "apps/desktop/src/components/security/SecuritySharingPage.tsx <RekeyProgressCard>": 2,
  "apps/desktop/src/components/security/securityPanels.tsx <Banner>": 1,
  "apps/desktop/src/components/settings/AccountServicePage.tsx <Banner>": 1,
  "apps/desktop/src/components/settings/AccountServicePage.tsx <SwatchGrid>": 1,
  "apps/desktop/src/components/settings/BarsPage.tsx <div>": 1,
  // A card inside a card: the sign-in editor is a SettingCard of its own.
  "apps/desktop/src/components/settings/CloudAccountsPage.tsx <OAuthAccessEditor>": 1,
  "apps/desktop/src/components/settings/CloudAccountsWizard.tsx <OAuthAccessEditor>": 1,
  "apps/desktop/src/components/settings/CustomThemeEditor.tsx <Banner>": 1,
  "apps/desktop/src/components/settings/CustomThemeEditor.tsx <CustomThemePreviewBanner>": 1,
  "packages/ui/src/components/CustomThemeSync.tsx <p>": 1,
  "packages/ui/src/components/accounts/AccountPasswordChangePanel.tsx <div>": 1,
};

function counted(list: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const entry of list) out[entry] = (out[entry] ?? 0) + 1;
  return out;
}

describe("everything directly inside a settings card is a row", () => {
  const files = sourceTexts(["apps/desktop/src", "packages/ui/src", "apps/mobile/src"], "shipped").filter((f) => f.rel.endsWith(".tsx") && f.text.includes("<SettingCard"));
  const found = counted(files.flatMap((f) => bareChildren(f.rel, f.text)));

  it("no card holds a bare element beyond the listed ones", () => {
    const over = Object.entries(found).filter(([key, n]) => n > (BASELINE[key] ?? 0)).map(([key, n]) => `"${key}": ${n},`);
    expect(over, `wrap these in SettingCardBlock / SettingCardActions, or give them a class that brings the row inset:\n${over.join("\n")}`).toEqual([]);
  });

  it("keeps the list honest (it only shrinks)", () => {
    const stale = Object.entries(BASELINE).filter(([key, n]) => (found[key] ?? 0) < n).map(([key, n]) => `${key}: listed ${n}, found ${found[key] ?? 0}`);
    expect(stale, `lower or remove these BASELINE entries:\n${stale.join("\n")}`).toEqual([]);
  });

  it("sees through conditions, fragments and maps (positive control)", () => {
    const sample = `const a = <SettingCard>
      <SettingRow label="x" />
      {open && <div>bare</div>}
      <>{list.map((x) => <Banner key={x} />)}</>
      <div className="pv-barfoot" />
    </SettingCard>;`;
    expect(bareChildren("sample.tsx", sample)).toEqual(["sample.tsx <div>", "sample.tsx <Banner>"]);
  });
});
