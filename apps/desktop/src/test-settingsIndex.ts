import ts from "typescript";
import { sourceFile } from "./test-sourceTree";
import type { SettingsIndexEntry, SettingsShell } from "../../../packages/ui/src/lib/settingsSearch";

/**
 * Reads the settings rows of both shells out of their JSX (settings plan
 * 2026-10-29, § 4.3 / E2), for the search over all settings.
 *
 * WHY THE INDEX IS READ FROM THE CODE: the search finds a row that is not on
 * screen - most pages are not mounted, on the phone none is - so it needs a
 * list of every row with its page, card, label, visible line and ⓘ text. A list
 * kept by hand next to the pages would be one more place to forget a row; this
 * reads the primitives' props instead (`SettingRow label/desc/info`, the card
 * a row stands in, the phone's `SectionLabel` before it), writes the result to
 * `packages/ui/src/lib/settingsSearchIndex.ts`, and `settingsSearchIndex.test.ts`
 * fails when the committed file differs from what the code says - or when a
 * file that draws settings rows is not read at all.
 *
 * Only a label that is ONE locale key is indexed: a row named by data (an
 * account, a calendar, a mailbox) is not a setting one searches for.
 */

/** Where the rows of one source file (or one component in it) are shown. */
export interface SettingsSource {
  file: string;
  shell: SettingsShell;
  /** Only this component's body (function or `const X = ...`). */
  component?: string;
  /** Catalog area id of the page (or a page only the search knows, `vaultDetails`). */
  area: string;
  /** The sub-page the rows sit on (account, service:files, syncChain, a security area ...). */
  sub?: string;
  /**
   * A condition around a row names its sub-page: the first capture of this
   * expression, tried on the nearest enclosing `if`, `&&` or `? :` test.
   */
  subFrom?: RegExp;
  /** Sub values of `subFrom` that mean "the page itself" (the security overview). */
  subNone?: string[];
  /** Rows under a condition matching this are not settings (a wizard branch). */
  skip?: RegExp;
  /** The card a helper component's rows stand in when it is rendered from another file. */
  card?: string;
}

const D = "apps/desktop/src/components";
const M = "apps/mobile/src";
const UI = "packages/ui/src/components";

export const SETTINGS_SOURCES: readonly SettingsSource[] = [
  // ---------- desktop: APP ----------
  { file: `${D}/settings/AppPages.tsx`, shell: "desktop", component: "AppearancePage", area: "appearance" },
  { file: `${D}/settings/LinkStyleSettings.tsx`, shell: "desktop", area: "appearance", card: "settings.groupLinksTags" },
  { file: `${D}/settings/AppPages.tsx`, shell: "desktop", component: "EditorPage", area: "editor" },
  { file: `${D}/settings/AppPages.tsx`, shell: "desktop", component: "BehaviorPage", area: "behavior" },
  { file: `${D}/settings/BackgroundSettings.tsx`, shell: "desktop", component: "BackgroundSettings", area: "behavior" },
  { file: `${D}/settings/BackgroundSettings.tsx`, shell: "desktop", component: "AutostartRow", area: "behavior", card: "settings.groupStart" },
  { file: `${D}/settings/QuickCaptureSettings.tsx`, shell: "desktop", area: "behavior" },
  { file: `${D}/settings/WindowSettings.tsx`, shell: "desktop", area: "behavior", card: "settings.groupStart" },
  { file: `${D}/settings/AppPages.tsx`, shell: "desktop", component: "AboutPage", area: "about" },
  { file: `${D}/settings/AppPages.tsx`, shell: "desktop", component: "UpdatesGroup", area: "about" },
  { file: `${D}/settings/StoredCredentialsCard.tsx`, shell: "desktop", area: "about" },
  { file: `${D}/settings/AppPages.tsx`, shell: "desktop", component: "CustomThemePage", area: "appearance", sub: "customTheme" },
  { file: `${D}/settings/CustomThemeEditor.tsx`, shell: "desktop", area: "appearance", sub: "customTheme" },
  { file: `${UI}/CustomThemeSync.tsx`, shell: "desktop", area: "appearance", sub: "customTheme" },
  // ---------- desktop: VAULT ----------
  { file: `${D}/settings/CloudAccountsPage.tsx`, shell: "desktop", area: "cloudAccounts", subFrom: /^(detail)$/, skip: /mode\.kind === "wizard"/ },
  { file: `${D}/settings/AccountServicePage.tsx`, shell: "desktop", component: "FilesPart", area: "cloudAccounts", sub: "service:files" },
  { file: `${D}/settings/AccountServicePage.tsx`, shell: "desktop", component: "CalendarPart", area: "cloudAccounts", sub: "service:calendar" },
  { file: `${D}/settings/AccountServicePage.tsx`, shell: "desktop", component: "MailPart", area: "cloudAccounts", sub: "service:mail" },
  { file: `${D}/mail/MailSendingCard.tsx`, shell: "desktop", area: "cloudAccounts", sub: "service:mail" },
  { file: `${UI}/accounts/AccountPasswordChangePanel.tsx`, shell: "desktop", area: "cloudAccounts", sub: "account" },
  { file: `${D}/settings/SyncPage.tsx`, shell: "desktop", area: "sync", subFrom: /^(chainOpen) && connected$/ },
  { file: `${D}/security/SecuritySharingPage.tsx`, shell: "desktop", area: "security", subFrom: /\barea === "([a-z]+)"/ },
  { file: `${D}/settings/VaultPages.tsx`, shell: "desktop", component: "PimPage", area: "pim" },
  { file: `${D}/pim/PimAccountsSection.tsx`, shell: "desktop", area: "pim" },
  { file: `${D}/pim/ReminderSettings.tsx`, shell: "desktop", area: "pim" },
  { file: `${D}/settings/VaultPages.tsx`, shell: "desktop", component: "MailPage", area: "mail" },
  { file: `${D}/mail/MailAccountsSection.tsx`, shell: "desktop", area: "mail" },
  { file: `${D}/mail/RulesSettings.tsx`, shell: "desktop", area: "mail" },
  { file: `${D}/mail/VacationSettings.tsx`, shell: "desktop", area: "mail" },
  { file: `${D}/settings/VaultPages.tsx`, shell: "desktop", component: "ContentPage", area: "content" },
  { file: `${D}/comments/CommentNotificationSettings.tsx`, shell: "desktop", area: "content", card: "settings.groupAnnotations" },
  { file: `${D}/settings/VaultPages.tsx`, shell: "desktop", component: "JournalPage", area: "journal" },
  { file: `${D}/settings/BarsPage.tsx`, shell: "desktop", area: "bars" },
  { file: `${D}/settings/VaultPages.tsx`, shell: "desktop", component: "BackupPage", area: "backup" },
  { file: `${D}/settings/VaultPages.tsx`, shell: "desktop", component: "MaintenancePage", area: "maintenance" },
  // ---------- phone: APP ----------
  { file: `${M}/screens/AppearanceScreen.tsx`, shell: "mobile", area: "appearance" },
  { file: `${M}/screens/CustomThemeScreen.tsx`, shell: "mobile", area: "appearance", sub: "customTheme" },
  { file: `${M}/screens/SettingsAreaScreens.tsx`, shell: "mobile", component: "EditorAreaScreen", area: "editor" },
  { file: `${M}/screens/BehaviorAreaScreen.tsx`, shell: "mobile", area: "behavior" },
  { file: `${M}/screens/SettingsAreaScreens.tsx`, shell: "mobile", component: "AboutAreaScreen", area: "about" },
  // ---------- phone: VAULT ----------
  { file: `${M}/screens/CloudAccountsScreen.tsx`, shell: "mobile", area: "cloudAccounts" },
  { file: `${M}/screens/CloudAccountDetailScreen.tsx`, shell: "mobile", area: "cloudAccounts", sub: "account" },
  { file: `${M}/screens/AccountServiceScreen.tsx`, shell: "mobile", component: "FilesPart", area: "cloudAccounts", sub: "service:files" },
  { file: `${M}/screens/AccountServiceScreen.tsx`, shell: "mobile", component: "CalendarPart", area: "cloudAccounts", sub: "service:calendar" },
  { file: `${M}/screens/AccountServiceScreen.tsx`, shell: "mobile", component: "MailPart", area: "cloudAccounts", sub: "service:mail" },
  { file: `${M}/VaultDetailScreen.tsx`, shell: "mobile", component: "VaultSyncScreen", area: "sync" },
  { file: `${M}/VaultDetailScreen.tsx`, shell: "mobile", component: "VaultDetailScreen", area: "vaultDetails" },
  { file: `${M}/screens/SyncChainScreen.tsx`, shell: "mobile", area: "sync", sub: "syncChain" },
  { file: `${M}/screens/SyncDiagnosticsScreen.tsx`, shell: "mobile", area: "sync", sub: "syncDiagnostics" },
  { file: `${M}/screens/SecurityAreaScreen.tsx`, shell: "mobile", area: "security", subFrom: /\barea === "([a-z]+)"/, subNone: ["overview"] },
  // The add forms open as a sheet or a connect run: their fields are not settings.
  { file: `${M}/screens/PimAccountsScreen.tsx`, shell: "mobile", area: "pim", skip: /\bformOpen\b/ },
  { file: `${M}/screens/MailAccountsScreen.tsx`, shell: "mobile", area: "mail", skip: /\bformOpen\b/ },
  { file: `${M}/screens/SettingsAreaScreens.tsx`, shell: "mobile", component: "ContentAreaScreen", area: "content" },
  { file: `${M}/components/TemplateRules.tsx`, shell: "mobile", area: "content" },
  { file: `${M}/screens/JournalAreaScreen.tsx`, shell: "mobile", area: "journal" },
  { file: `${M}/screens/SettingsAreaScreens.tsx`, shell: "mobile", component: "BackupAreaScreen", area: "backup" },
  { file: `${M}/components/ZipBackupGroup.tsx`, shell: "mobile", area: "backup" },
  { file: `${M}/screens/MaintenanceAreaScreen.tsx`, shell: "mobile", area: "maintenance" },
];

/**
 * Files that draw settings primitives and are NOT read, each with the reason.
 * The guard fails for a file that draws rows and stands in neither list.
 */
export const SETTINGS_SOURCE_EXEMPT: Readonly<Record<string, string>> = {
  [`${D}/OnlineVaultSetup.tsx`]: "the start screen's \"vault in the cloud\" form, not a settings page",
  [`${D}/settings/CloudAccountsWizard.tsx`]: "the connect assistant: steps of a run, not settings",
  [`${D}/settings/ConnectSignInStep.tsx`]: "the sign-in step of the connect assistant",
  [`${D}/settings/AccountCheckModal.tsx`]: "the result dialog of \"Check connection\", rows named by service",
  [`${D}/security/QuarantineCard.tsx`]: "a list of files in quarantine, rows named by file",
  [`${D}/security/securityPanels.tsx`]: "dialogs and status panels of the security page, no setting of their own",
  [`${D}/security/WorkspaceGovernanceDialog.tsx`]: "a dialog opened from the security page",
  [`${UI}/accounts/OAuthAccessEditor.tsx`]: "the sign-in editor opened from \"Change\"; its row is \"Sign-in on this device\"",
  [`${M}/SettingsScreen.tsx`]: "the overview list itself - its rows are the areas",
  [`${M}/screens/CloudConnectScreen.tsx`]: "the connect assistant on the phone",
  [`${M}/screens/MailRuleScreen.tsx`]: "the editor of ONE mail rule, opened from a rule",
  [`${M}/screens/OkfConversionScreen.tsx`]: "a command (convert to OKF) started from Maintenance",
  [`${M}/screens/OkfMigrationScreen.tsx`]: "a command (OKF bundle version) started from Maintenance",
  [`${M}/screens/ImportWizardScreen.tsx`]: "the import wizard, a command",
  [`${M}/screens/OverviewsScreen.tsx`]: "the OKF overviews command",
  [`${M}/screens/VaultsScreen.tsx`]: "the vault list (switch, new, connect)",
  [`${M}/components/FolderField.tsx`]: "a field component; its label comes from the screen that uses it",
  [`${M}/components/FontSlotSheet.tsx`]: "the font picker sheet opened from a font row",
  [`${M}/components/AreasSheet.tsx`]: "the areas sheet of the navigation bar, not settings",
  [`${M}/components/PublicationRecipientsSheet.tsx`]: "a sheet of one publication's recipients",
  [`${M}/components/QuarantineList.tsx`]: "a list of files in quarantine, rows named by file",
  [`${M}/screens/base/BaseConfigSheet.tsx`]: "a database's configuration, not app or vault settings",
  [`${M}/screens/base/BaseScreen.tsx`]: "a database view",
  [`${M}/screens/base/PinboardView.tsx`]: "a pinboard view",
  [`${M}/screens/BrowseScreen.tsx`]: "the notes tab",
  [`${M}/screens/DatabasesScreen.tsx`]: "the databases list",
  [`${M}/screens/FindReplaceScreen.tsx`]: "find and replace",
  [`${M}/screens/NavigatorScreen.tsx`]: "the navigator",
  [`${M}/screens/RecentScreen.tsx`]: "the recent list",
  [`${M}/screens/TasksScreen.tsx`]: "the tasks tab",
  [`${M}/screens/TodayScreen.tsx`]: "the today tab",
};

/** Row primitives and what their props mean: [label, visible line(s), info]. */
const ROW_TAGS: Record<SettingsShell, Record<string, { label: string; desc: string[]; childLabel?: boolean }>> = {
  desktop: {
    SettingRow: { label: "label", desc: ["desc"] },
    FontSlotRow: { label: "label", desc: [] },
    DayTimeRow: { label: "label", desc: ["desc"] },
  },
  mobile: {
    Row: { label: "title", desc: ["subtitle"] },
    SettingField: { label: "label", desc: ["hint"] },
    MobileSettingRow: { label: "label", desc: [] },
  },
};
const CARD_TAGS: Record<SettingsShell, string> = { desktop: "SettingCard", mobile: "SectionLabel" };
/** Elements whose literal text children are a visible line (the E8 guard reads them too). */
const NOTE_TAGS = new Set(["SettingCardNote", "SettingCardBlock"]);

export interface Extraction {
  entries: SettingsIndexEntry[];
  /** Visible lines in settings: desc/subtitle/hint keys, card notes, phone hints. */
  visibleKeys: Map<string, string>;
  /** Rows whose label is not one locale key (data, or a computed name). */
  dynamicRows: number;
}

function tagOf(node: ts.JsxElement | ts.JsxSelfClosingElement): string {
  const opening = ts.isJsxElement(node) ? node.openingElement : node;
  return opening.tagName.getText();
}

function attr(node: ts.JsxElement | ts.JsxSelfClosingElement, name: string): ts.Expression | undefined {
  const opening = ts.isJsxElement(node) ? node.openingElement : node;
  for (const prop of opening.attributes.properties) {
    if (ts.isJsxAttribute(prop) && prop.name.getText() === name && prop.initializer) {
      if (ts.isJsxExpression(prop.initializer)) return prop.initializer.expression;
      if (ts.isStringLiteral(prop.initializer)) return prop.initializer;
    }
  }
  return undefined;
}

/** Every `t("key")` / `i18n.t("key")` inside a node, in order. */
function tKeys(node: ts.Node | undefined): string[] {
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && n.arguments.length > 0 && ts.isStringLiteral(n.arguments[0])) {
      const callee = n.expression.getText();
      if (callee === "t" || callee === "i18n.t" || callee === "p.t") out.push((n.arguments[0] as ts.StringLiteral).text);
    }
    ts.forEachChild(n, visit);
  };
  if (node) visit(node);
  return out;
}

/** Whether a `t()` call interpolates values (anything besides `defaultValue`). */
function interpolates(expr: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(n) && n.arguments.length > 1 && ts.isObjectLiteralExpression(n.arguments[1])) {
      if (n.arguments[1].properties.some((p) => !(p.name && p.name.getText() === "defaultValue"))) found = true;
    }
    ts.forEachChild(n, visit);
  };
  visit(expr);
  return found;
}

/** The ONE key a label is, or undefined for a computed or data label. */
function singleKey(expr: ts.Expression | undefined): string | undefined {
  if (!expr || ts.isConditionalExpression(expr) || ts.isStringLiteral(expr) || interpolates(expr)) return undefined;
  const keys = tKeys(expr);
  return keys.length === 1 ? keys[0] : undefined;
}

/** Whether a node sits inside a dialog: its fields belong to that dialog, not to the page. */
function inDialog(node: ts.Node, stop: ts.Node): boolean {
  for (let at = node.parent; at && at !== stop; at = at.parent) {
    if ((ts.isJsxElement(at) || ts.isJsxSelfClosingElement(at)) && /^(Modal|Sheet|ConfirmDialog)$/.test(tagOf(at))) return true;
  }
  return false;
}

/** The nearest JSX element or fragment above a node - the scope a phone group heading heads. */
function jsxParent(node: ts.Node): ts.Node | undefined {
  for (let at = node.parent; at; at = at.parent) {
    if (ts.isJsxElement(at) || ts.isJsxFragment(at)) return at;
  }
  return undefined;
}

function within(node: ts.Node, scope: ts.Node): boolean {
  for (let at: ts.Node | undefined = node; at; at = at.parent) if (at === scope) return true;
  return false;
}

function childKeys(node: ts.JsxElement): string[] {
  return node.children.flatMap((child) => (ts.isJsxText(child) ? [] : tKeys(child)));
}

/**
 * The keys a note or hint SHOWS: its text, not what stands behind an ⓘ inside
 * it, and not an element's props (a button's name, a test id).
 */
function shownKeys(node: ts.Node): string[] {
  if (ts.isJsxSelfClosingElement(node)) return [];
  if (ts.isJsxElement(node)) return tagOf(node) === "InfoTip" ? [] : node.children.flatMap(shownKeys);
  if (ts.isJsxText(node)) return [];
  if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0]) && /^(t|i18n\.t|p\.t)$/.test(node.expression.getText())) {
    return [(node.arguments[0] as ts.StringLiteral).text];
  }
  const out: string[] = [];
  ts.forEachChild(node, (child) => { out.push(...shownKeys(child)); });
  return out;
}

/** The test of the nearest enclosing condition that holds this node, innermost first. */
function conditions(node: ts.Node, stop: ts.Node): string[] {
  const out: string[] = [];
  let child: ts.Node = node;
  for (let at = node.parent; at && at !== stop; child = at, at = at.parent) {
    if (ts.isIfStatement(at) && at.thenStatement === child) out.push(at.expression.getText());
    else if (ts.isConditionalExpression(at) && at.whenTrue === child) out.push(at.condition.getText());
    else if (ts.isBinaryExpression(at) && at.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && at.right === child) out.push(at.left.getText());
  }
  return out;
}

function componentRoot(file: ts.SourceFile, name: string): ts.Node | undefined {
  let found: ts.Node | undefined;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isFunctionDeclaration(n) && n.name?.text === name) found = n;
    else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name) found = n;
    else ts.forEachChild(n, visit);
  };
  visit(file);
  return found;
}

export function extractSettingsIndex(sources: readonly SettingsSource[] = SETTINGS_SOURCES, read: (rel: string) => string = sourceFile): Extraction {
  const entries: SettingsIndexEntry[] = [];
  const seen = new Set<string>();
  const visibleKeys = new Map<string, string>();
  let dynamicRows = 0;
  const add = (entry: SettingsIndexEntry) => {
    const id = JSON.stringify(entry);
    if (seen.has(id)) return;
    seen.add(id);
    entries.push(entry);
  };
  const visible = (keys: string[], where: string) => keys.forEach((key) => { if (!visibleKeys.has(key)) visibleKeys.set(key, where); });

  for (const source of sources) {
    const text = read(source.file);
    const file = ts.createSourceFile(source.file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const root = source.component ? componentRoot(file, source.component) : file;
    if (!root) throw new Error(`${source.file}: component ${source.component} not found`);
    const rows = ROW_TAGS[source.shell];
    const cardTag = CARD_TAGS[source.shell];
    const cardStack: string[] = [];
    // A phone group heading heads the rows after it within its own parent element.
    let phoneCard: { key: string | undefined; scope: ts.Node | undefined } = { key: source.card, scope: undefined };

    const placeOf = (node: ts.Node): { sub?: string } | null => {
      if (inDialog(node, root)) return null;
      const tests = conditions(node, root);
      if (source.skip && tests.some((test) => source.skip!.test(test))) return null;
      let sub = source.sub;
      if (source.subFrom) {
        for (const test of tests) {
          const hit = source.subFrom.exec(test);
          if (hit) {
            sub = source.subNone?.includes(hit[1]) ? undefined : hit[1] === "detail" ? "account" : hit[1] === "chainOpen" ? "syncChain" : hit[1];
            break;
          }
        }
      }
      return { sub };
    };
    const base = (sub: string | undefined) => ({ shell: source.shell, area: source.area, ...(sub ? { sub } : {}) });

    const visit = (node: ts.Node): void => {
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = tagOf(node);
        const where = `${source.file} <${tag}>`;
        if (tag === cardTag) {
          const place = placeOf(node);
          const key = source.shell === "desktop" ? singleKey(attr(node, "label")) : ts.isJsxElement(node) && childKeys(node).length === 1 && !node.children.some((child) => !ts.isJsxText(child) && interpolates(child)) ? childKeys(node)[0] : undefined;
          const info = tKeys(attr(node, "info"));
          if (key && place) add({ ...base(place.sub), kind: "card", card: key, ...(info.length ? { info } : {}) });
          if (source.shell === "mobile") {
            phoneCard = { key, scope: jsxParent(node) };
          } else if (ts.isJsxElement(node)) {
            cardStack.push(key ?? "");
            node.children.forEach(visit);
            cardStack.pop();
            return;
          }
        } else if (rows[tag]) {
          const spec = rows[tag];
          const place = placeOf(node);
          const label = singleKey(attr(node, spec.label));
          const desc = spec.desc.flatMap((name) => tKeys(attr(node, name)));
          visible(desc, where);
          if (!label) dynamicRows++;
          else if (place) {
            const info = tKeys(attr(node, "info"));
            const card = source.shell === "desktop"
              ? (cardStack.length ? cardStack[cardStack.length - 1] || undefined : source.card)
              : !phoneCard.scope || within(node, phoneCard.scope) ? phoneCard.key : undefined;
            add({ ...base(place.sub), kind: "row", ...(card ? { card } : {}), label, ...(desc.length ? { desc } : {}), ...(info.length ? { info } : {}) });
          }
        } else if (NOTE_TAGS.has(tag) && ts.isJsxElement(node)) {
          if (!inDialog(node, root)) visible(node.children.flatMap(shownKeys), where);
        } else if (tag === "p" && /m-hint/.test(attr(node, "className")?.getText() ?? "") && ts.isJsxElement(node)) {
          if (!inDialog(node, root)) visible(node.children.flatMap(shownKeys), where);
        } else if ((tag === "SettingsPageHead") && placeOf(node)) {
          const title = singleKey(attr(node, "title"));
          const sub = placeOf(node)?.sub;
          const desc = tKeys(attr(node, "desc"));
          const info = tKeys(attr(node, "info"));
          visible(desc, where);
          if (title) add({ ...base(sub), kind: "page", label: title, ...(desc.length ? { desc } : {}), ...(info.length ? { info } : {}) });
        }
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(root, visit);
  }
  return { entries, visibleKeys, dynamicRows };
}

/** The text of the generated module. */
export function renderSettingsIndex(entries: readonly SettingsIndexEntry[]): string {
  const lines = entries.map((entry) => `  ${JSON.stringify(entry)},`);
  return [
    "// GENERATED from the settings pages of both shells - do not edit by hand.",
    "// apps/desktop/src/settingsSearchIndex.test.ts compares it with the code;",
    "// rewrite it with PLAINVA_WRITE_SETTINGS_INDEX=1 and that test (settings plan 2026-10-29, § 4.3).",
    "import type { SettingsIndexEntry } from \"./settingsSearch\";",
    "",
    "export const SETTINGS_SEARCH_INDEX: readonly SettingsIndexEntry[] = [",
    ...lines,
    "];",
    "",
  ].join("\n");
}

/** Every file whose JSX draws a settings primitive (the coverage guard reads them). */
export const SETTINGS_PRIMITIVE_PATTERN: Record<SettingsShell, RegExp> = {
  desktop: /<(SettingRow|SettingCard)\b/,
  mobile: /<(SettingField|MobileSettingRow|SectionLabel)\b/,
};
