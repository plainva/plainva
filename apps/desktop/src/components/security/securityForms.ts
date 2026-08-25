import type { TFunction } from "i18next";
import type { WorkspaceDynamicSliceDefinition } from "@plainva/core";
import type { SelectOption } from "@plainva/ui";
import type { useVault } from "../../contexts/VaultContext";

/** Shared shape of the governance dialog form + the types derived from the
 * vault control plane, extracted so the page, the dialog and the wizard can be
 * split into separate files (plan Security & Sharing, package B3). */
export type Diagnostics = Awaited<ReturnType<ReturnType<typeof useVault>["getWorkspaceDiagnostics"]>>;
export type Governance = Awaited<ReturnType<ReturnType<typeof useVault>["getWorkspaceGovernance"]>>;

export type WorkspaceRole = "Owner" | "Admin" | "Editor" | "Commenter" | "Reader" | "Contributor";
export const WORKSPACE_ROLES: readonly WorkspaceRole[] = ["Owner", "Admin", "Editor", "Commenter", "Reader", "Contributor"];

/** Publication target providers. Brand names, not localized. */
export const PUBLICATION_PROVIDERS = ["google-drive", "onedrive", "nextcloud", "dropbox", "webdav", "s3"] as const;
const PROVIDER_LABELS: Record<(typeof PUBLICATION_PROVIDERS)[number], string> = {
  "google-drive": "Google Drive",
  onedrive: "OneDrive",
  nextcloud: "Nextcloud",
  dropbox: "Dropbox",
  webdav: "WebDAV",
  s3: "S3",
};

export type GovernanceForm = {
  code: string; name: string; role: string; members: string; scopeKind: string; scopeId: string; sliceKind: string; definition: string;
  publicationMode: string; publicationAccess: string; publicationProvider: string;
  recoveryCode: string; deviceName: string; recoveryFile: string; fallbackPassphrase: string;
};

export function parseSliceForm(form: GovernanceForm) {
  return form.sliceKind === "folder"
    ? { kind: "folder" as const, folder: form.definition }
    : form.sliceKind === "selection"
      ? { kind: "selection" as const, objectIds: form.definition.split(",").map((value) => value.trim()).filter(Boolean) }
      : { kind: "dynamic" as const, definition: JSON.parse(form.definition) as WorkspaceDynamicSliceDefinition };
}

/** Localized role options WITH a one-line capability description (Mockup 3).
 * The `value` stays the exact backend capability string. */
export function roleOptions(t: TFunction): SelectOption<WorkspaceRole>[] {
  return WORKSPACE_ROLES.map((role) => ({
    value: role,
    label: t(`workspaceSecurity.role.${role}`, { defaultValue: role }),
    description: t(`workspaceSecurity.roleDesc.${role}`, { defaultValue: "" }) || undefined,
  }));
}

export function providerOptions(): SelectOption[] {
  return PUBLICATION_PROVIDERS.map((value) => ({ value, label: PROVIDER_LABELS[value] }));
}

/* ---------------------------------------------------------------------------
 * Rule rows for dynamic Vault Slices (P5, B8)
 *
 * A dynamic slice is stored as canonical JSON, and until now the wizard asked
 * for exactly that: a text field labelled "rule (JSON)". The grammar it has to
 * be typed against is narrow and unforgiving - five fields, four operators, and
 * an equality that compares by TYPE, so "42" never matches a numeric property.
 * A rule that matches nothing looks exactly like a rule that is simply not true
 * yet, which is why the plan calls this out.
 *
 * The rows below are that same grammar in a shape a picker can render. They are
 * a VIEW of the JSON, not a second source of truth: the form keeps the JSON
 * string, the builder reads it on open and writes it on every change, and the
 * raw field stays reachable under "Advanced". Anything the builder cannot
 * express is left to the raw field instead of being silently rewritten.
 * ------------------------------------------------------------------------- */

export type SliceRuleField = "path" | "mime" | "contentKind" | "tag" | "property";
export type SliceRuleOperator = "equals" | "startsWith" | "endsWith" | "contains";
/** How a property value is compared. Core compares with ===, so the type matters. */
export type SliceRuleValueKind = "text" | "number" | "boolean" | "empty";

export interface SliceRuleRow {
  field: SliceRuleField;
  /** Only for field "property" - the frontmatter key after the "property." prefix. */
  propertyKey: string;
  operator: SliceRuleOperator;
  value: string;
  /** Only for field "property"; text everywhere else. */
  valueKind: SliceRuleValueKind;
}

/** Fields that support more than plain equality. */
const TEXT_RULE_FIELDS: readonly SliceRuleField[] = ["path", "mime", "contentKind"];

export function emptySliceRuleRow(): SliceRuleRow {
  return { field: "path", propertyKey: "", operator: "startsWith", value: "", valueKind: "text" };
}

export function sliceRuleFieldOptions(t: TFunction): SelectOption<SliceRuleField>[] {
  return [
    { value: "path", label: t("workspaceSecurity.ruleField.path", { defaultValue: "Path" }) },
    { value: "tag", label: t("workspaceSecurity.ruleField.tag", { defaultValue: "Tag" }) },
    { value: "property", label: t("workspaceSecurity.ruleField.property", { defaultValue: "Property" }) },
    { value: "mime", label: t("workspaceSecurity.ruleField.mime", { defaultValue: "File type" }) },
    { value: "contentKind", label: t("workspaceSecurity.ruleField.contentKind", { defaultValue: "Kind" }) },
  ];
}

/** Tags and properties compare by equality only - that is the protocol, not a UI choice. */
export function sliceRuleOperatorOptions(t: TFunction, field: SliceRuleField): SelectOption<SliceRuleOperator>[] {
  const equals = { value: "equals" as const, label: t("workspaceSecurity.ruleOp.equals", { defaultValue: "is" }) };
  if (!TEXT_RULE_FIELDS.includes(field)) return [equals];
  return [
    equals,
    { value: "startsWith", label: t("workspaceSecurity.ruleOp.startsWith", { defaultValue: "starts with" }) },
    { value: "endsWith", label: t("workspaceSecurity.ruleOp.endsWith", { defaultValue: "ends with" }) },
    { value: "contains", label: t("workspaceSecurity.ruleOp.contains", { defaultValue: "contains" }) },
  ];
}

export function sliceRuleValueKindOptions(t: TFunction): SelectOption<SliceRuleValueKind>[] {
  return [
    { value: "text", label: t("workspaceSecurity.ruleValueType.text", { defaultValue: "Text" }) },
    { value: "number", label: t("workspaceSecurity.ruleValueType.number", { defaultValue: "Number" }) },
    { value: "boolean", label: t("workspaceSecurity.ruleValueType.boolean", { defaultValue: "Yes/No" }) },
    { value: "empty", label: t("workspaceSecurity.ruleValueType.empty", { defaultValue: "Empty" }) },
  ];
}

/** Keeps a row internally consistent when its field changes. */
export function normalizeSliceRuleRow(row: SliceRuleRow): SliceRuleRow {
  return {
    ...row,
    operator: TEXT_RULE_FIELDS.includes(row.field) ? row.operator : "equals",
    valueKind: row.field === "property" ? row.valueKind : "text",
    propertyKey: row.field === "property" ? row.propertyKey : "",
  };
}

function sliceRuleValue(row: SliceRuleRow): string | number | boolean | null {
  if (row.field !== "property") return row.value;
  if (row.valueKind === "number") return Number(row.value);
  if (row.valueKind === "boolean") return row.value === "true";
  if (row.valueKind === "empty") return null;
  return row.value;
}

/** A row the protocol would reject (empty value, property without a key) is not a rule yet. */
export function isSliceRuleRowComplete(row: SliceRuleRow): boolean {
  if (row.field === "property") {
    if (!row.propertyKey.trim()) return false;
    if (row.valueKind === "empty" || row.valueKind === "boolean") return true;
    if (row.valueKind === "number") return row.value.trim() !== "" && Number.isFinite(Number(row.value));
  }
  return row.value.trim() !== "";
}

export function sliceRuleRowsToDefinition(rows: readonly SliceRuleRow[]): WorkspaceDynamicSliceDefinition {
  const all = rows.filter(isSliceRuleRowComplete).map((row) => ({
    field: row.field === "property" ? `property.${row.propertyKey.trim()}` : row.field,
    operator: row.operator,
    value: sliceRuleValue(row),
  }));
  return { all: all as WorkspaceDynamicSliceDefinition["all"] };
}

/**
 * Reads rows back out of stored JSON.
 *
 * null means "the builder cannot show this" - an unknown shape, or hand-written
 * JSON a picker would silently rewrite. The wizard then keeps the raw field as
 * the only editor rather than dropping what somebody wrote.
 */
export function sliceRuleRowsFromDefinition(json: string): SliceRuleRow[] | null {
  if (!json.trim()) return [emptySliceRuleRow()];
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return null; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if (Object.keys(parsed).some((key) => key !== "all")) return null;
  const all = (parsed as { all?: unknown }).all;
  if (!Array.isArray(all) || all.length === 0) return null;
  const rows: SliceRuleRow[] = [];
  for (const entry of all) {
    if (!entry || typeof entry !== "object") return null;
    const { field, operator, value } = entry as { field?: unknown; operator?: unknown; value?: unknown };
    if (typeof field !== "string" || typeof operator !== "string") return null;
    if (!["equals", "startsWith", "endsWith", "contains"].includes(operator)) return null;
    if (field.startsWith("property.")) {
      const valueKind: SliceRuleValueKind = value === null ? "empty" : typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "text";
      if (valueKind === "text" && typeof value !== "string") return null;
      rows.push({ field: "property", propertyKey: field.slice("property.".length), operator: "equals", value: value === null ? "" : String(value), valueKind });
      continue;
    }
    if (!["path", "mime", "contentKind", "tag"].includes(field)) return null;
    if (typeof value !== "string") return null;
    rows.push({ field: field as SliceRuleField, propertyKey: "", operator: operator as SliceRuleOperator, value, valueKind: "text" });
  }
  return rows;
}

/** Is this form's definition ready to be previewed or published? */
export function isSliceDefinitionReady(form: GovernanceForm): boolean {
  if (form.sliceKind !== "dynamic") return form.definition.trim() !== "";
  const rows = sliceRuleRowsFromDefinition(form.definition);
  if (rows) return rows.some(isSliceRuleRowComplete);
  try { return Array.isArray((JSON.parse(form.definition) as WorkspaceDynamicSliceDefinition).all); } catch { return false; }
}
