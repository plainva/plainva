import { describe, it, expect } from "vitest";
import ts from "typescript";
import { sourceTexts } from "./test-sourceTree";

/**
 * A setting that is on or off is a Switch (Design_Language, "A setting that is
 * on or off is a `Switch`", finding 2026-10-30).
 *
 * Four rows of the desktop settings were checkboxes beside switches — "Ask
 * before creating empty links", "Open the last vault automatically", the
 * compatibility hints, "Check for updates on startup" — and four more on the
 * vault pages and in mail, with no reason; the phone drew the same settings as
 * switches. A checkbox keeps a place only where it says something a switch
 * cannot: picking several items of a list, or a choice inside a form that
 * counts when its button is pressed.
 *
 * The guard reads the JSX of both shells and the shared package: the control
 * of a settings row — the children of a `SettingRow` or a `SettingField`, the
 * `end` of a phone `Row` — may not be a `Checkbox` or an
 * `<input type="checkbox">`, unless the row is listed below with its reason.
 */

/** Rows whose checkboxes are right, by `file label`, with the reason. */
const EXEMPT: Record<string, string> = {
  'apps/desktop/src/components/pim/ReminderSettings.tsx t("reminders.calendars")':
    "picks several calendars of a list: one box per calendar, not one setting",
  "apps/mobile/src/screens/CloudConnectScreen.tsx serviceLabel(service)":
    "picks the services to connect, several of a list, confirmed with the step's button",
};

type Jsx = ts.JsxElement | ts.JsxSelfClosingElement;

function opening(node: Jsx): ts.JsxOpeningLikeElement {
  return ts.isJsxElement(node) ? node.openingElement : node;
}

function attr(node: Jsx, name: string): ts.JsxAttribute | undefined {
  for (const prop of opening(node).attributes.properties) {
    if (ts.isJsxAttribute(prop) && prop.name.getText() === name) return prop;
  }
  return undefined;
}

function attrText(node: Jsx, name: string): string | undefined {
  const init = attr(node, name)?.initializer;
  if (!init) return undefined;
  if (ts.isStringLiteral(init)) return init.text;
  if (ts.isJsxExpression(init) && init.expression) return init.expression.getText();
  return undefined;
}

/** Whether a subtree draws a checkbox. */
function holdsCheckbox(node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) {
      const tag = opening(n).tagName.getText();
      if (tag === "Checkbox") { found = true; return; }
      if (tag === "input" && attrText(n, "type") === "checkbox") { found = true; return; }
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/** The settings rows of a file whose control is a checkbox, as `file label`. */
function checkboxRows(rel: string, text: string): string[] {
  const file = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const walk = (node: ts.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = opening(node).tagName.getText(file);
      let control: ts.Node | undefined;
      if ((tag === "SettingRow" || tag === "SettingField") && ts.isJsxElement(node)) control = node;
      if (tag === "Row") control = attr(node, "end")?.initializer;
      if (control && holdsCheckbox(control)) {
        const name = attrText(node, "label") ?? attrText(node, "title") ?? attrText(node, "data-testid") ?? "?";
        found.push(`${rel} ${name}`);
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(file);
  return found;
}

describe("a setting that is on or off is a switch", () => {
  const files = sourceTexts(["apps/desktop/src", "packages/ui/src", "apps/mobile/src"], "shipped")
    .filter((f) => f.rel.endsWith(".tsx") && /<(SettingRow|SettingField|Row)\b/.test(f.text));
  const found = files.flatMap((f) => checkboxRows(f.rel, f.text));

  it("no settings row has a checkbox for its control, beyond the listed ones", () => {
    const wrong = found.filter((entry) => !EXEMPT[entry]);
    expect(wrong, `make these a Switch, or list them in EXEMPT with the reason a checkbox is right:\n${wrong.join("\n")}`).toEqual([]);
  });

  it("keeps the list honest (every exception still exists)", () => {
    const stale = Object.keys(EXEMPT).filter((entry) => !found.includes(entry));
    expect(stale, `remove these EXEMPT entries:\n${stale.join("\n")}`).toEqual([]);
  });

  it("finds a checkbox in a row's control and in a phone row's end (positive control)", () => {
    const sample = `const a = <>
      <SettingRow label={t("a")}><input type="checkbox" checked={x} /></SettingRow>
      <SettingRow label={t("b")}><Switch checked={x} label="b" onChange={f} /></SettingRow>
      <SettingRow label={t("c")} wide><div>{list.map((c) => <Checkbox key={c} />)}</div></SettingRow>
      <Row title={t("d")} end={<Checkbox checked={x} />} />
      <Row title={t("e")} end={<Switch checked={x} label="e" onChange={f} />} />
      <SettingField label={t("f")}><Checkbox checked={x} /></SettingField>
    </>;`;
    expect(checkboxRows("sample.tsx", sample)).toEqual([
      'sample.tsx t("a")',
      'sample.tsx t("c")',
      'sample.tsx t("d")',
      'sample.tsx t("f")',
    ]);
  });
});
