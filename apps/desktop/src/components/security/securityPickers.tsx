import React from "react";
import { Button, Checkbox, ICON, IconButton, Select, TextInput } from "@plainva/ui";
import { Plus, X } from "lucide-react";
import type { TFunction } from "i18next";
import type { WorkspaceSliceObject } from "@plainva/core";
import {
  emptySliceRuleRow,
  isSliceRuleRowComplete,
  normalizeSliceRuleRow,
  sliceRuleFieldOptions,
  sliceRuleOperatorOptions,
  sliceRuleRowsToDefinition,
  sliceRuleValueKindOptions,
  type Governance,
  type SliceRuleField,
  type SliceRuleOperator,
  type SliceRuleRow,
  type SliceRuleValueKind,
} from "./securityForms";

/**
 * Choosing surfaces for the security centre (plan P5, finding B8).
 *
 * Before this, three of the wizard's inputs asked a person to type what the
 * protocol stores: a comma-separated list of hex member IDs, a comma-separated
 * list of object IDs, and a rule as JSON. All three are machine values - nobody
 * can write them from memory, and a typo produces an empty result that looks
 * exactly like a rule which is simply not true yet.
 *
 * Each picker writes the SAME stored string the backend already expects, so
 * nothing about the protocol changes; the raw value stays reachable in the
 * dialog under "Technical details" for the cases a picker cannot express.
 */

/** Group membership: pick people by name, store the IDs. */
export const MemberPicker: React.FC<{
  t: TFunction;
  members: Governance["members"] | undefined;
  value: string;
  onChange: (value: string) => void;
}> = ({ t, members, value, onChange }) => {
  const selected = new Set(value.split(",").map((entry) => entry.trim()).filter(Boolean));
  const toggle = (memberId: string) => {
    const next = new Set(selected);
    if (next.has(memberId)) next.delete(memberId);
    else next.add(memberId);
    onChange([...next].join(", "));
  };
  if (!members || members.length === 0) {
    return <span className="pv-security-picker-empty">{t("workspaceSecurity.noMembersYet", { defaultValue: "No members yet - invite someone first." })}</span>;
  }
  return (
    <div className="pv-security-picker" role="group" aria-label={t("workspaceSecurity.groupMembers", { defaultValue: "Members" })}>
      {members.map((member) => (
        <Checkbox key={member.memberId} checked={selected.has(member.memberId)} onChange={() => toggle(member.memberId)}>
          {member.state === "active" ? member.displayName : `${member.displayName} - ${member.state}`}
        </Checkbox>
      ))}
    </div>
  );
};

/** Selection slices: pick notes and attachments by path, store the object IDs. */
export const ObjectPicker: React.FC<{
  t: TFunction;
  objects: readonly WorkspaceSliceObject[] | null;
  value: string;
  onChange: (value: string) => void;
}> = ({ t, objects, value, onChange }) => {
  const [filter, setFilter] = React.useState("");
  const selected = new Set(value.split(",").map((entry) => entry.trim()).filter(Boolean));
  const toggle = (objectId: string) => {
    const next = new Set(selected);
    if (next.has(objectId)) next.delete(objectId);
    else next.add(objectId);
    onChange([...next].join(", "));
  };
  if (!objects) return <span className="pv-security-picker-empty">{t("common.loading", { defaultValue: "Loading" })}</span>;
  if (objects.length === 0) return <span className="pv-security-picker-empty">{t("workspaceSecurity.noObjectsYet", { defaultValue: "This workspace has no encrypted objects yet." })}</span>;
  const needle = filter.trim().toLowerCase();
  // Selected entries stay visible while filtering: a picker that hides what you
  // already chose invites you to lose it without noticing.
  const visible = objects.filter((object) => !needle || object.path.toLowerCase().includes(needle) || selected.has(object.objectId));
  return (
    <>
      <TextInput
        compact
        value={filter}
        placeholder={t("sidebar.search", { defaultValue: "Search" })}
        aria-label={t("sidebar.search", { defaultValue: "Search" })}
        onChange={(event) => setFilter(event.target.value)}
      />
      <div className="pv-security-picker" role="group" aria-label={t("workspaceSecurity.sliceObjectIds")}>
        {visible.map((object) => (
          <Checkbox key={object.objectId} checked={selected.has(object.objectId)} onChange={() => toggle(object.objectId)}>
            {object.path}
          </Checkbox>
        ))}
        {visible.length === 0 && <span className="pv-security-picker-empty">{t("sidebar.noResults", { defaultValue: "No matches" })}</span>}
      </div>
    </>
  );
};

/**
 * Dynamic slices: build the rule instead of typing its JSON.
 *
 * Rows are held by the caller, not derived from the stored JSON, because an
 * unfinished row (a field chosen, no value yet) is not a rule and would vanish
 * from a derived list on the next keystroke. On every change the complete rows
 * are written back as canonical JSON; while none is complete the definition
 * stays empty, so the wizard's own gate keeps telling the truth.
 */
export const RuleBuilder: React.FC<{
  t: TFunction;
  rows: SliceRuleRow[];
  objects: readonly WorkspaceSliceObject[] | null;
  onRows: (rows: SliceRuleRow[]) => void;
  onDefinition: (definition: string) => void;
}> = ({ t, rows, objects, onRows, onDefinition }) => {
  const commit = (next: SliceRuleRow[]) => {
    onRows(next);
    const complete = next.filter(isSliceRuleRowComplete);
    onDefinition(complete.length ? JSON.stringify(sliceRuleRowsToDefinition(next)) : "");
  };
  const patch = (index: number, changes: Partial<SliceRuleRow>) =>
    commit(rows.map((row, position) => (position === index ? normalizeSliceRuleRow({ ...row, ...changes }) : row)));
  // Suggestions come from the same object list the preview matches against, so
  // a tag or property offered here is one that can actually match something.
  const tagSuggestions = [...new Set((objects ?? []).flatMap((object) => object.tags ?? []))].sort();
  const propertySuggestions = [...new Set((objects ?? []).flatMap((object) => Object.keys(object.properties ?? {})))].sort();
  const fieldLabel = t("workspaceSecurity.ruleFieldLabel", { defaultValue: "Field" });
  const operatorLabel = t("workspaceSecurity.ruleOperator", { defaultValue: "Comparison" });
  const valueKindLabel = t("workspaceSecurity.ruleValueKind", { defaultValue: "Value type" });
  const valueLabel = t("workspaceSecurity.ruleValue", { defaultValue: "Value" });
  return (
    <div className="pv-security-rules">
      {rows.map((row, index) => (
        <div className="pv-security-rule" key={index} data-property={row.field === "property"}>
          <label className="pv-security-field">
            <span>{fieldLabel}</span>
            <Select value={row.field} options={sliceRuleFieldOptions(t)} ariaLabel={fieldLabel} onChange={(value) => patch(index, { field: value as SliceRuleField })} />
          </label>
          {row.field === "property" && (
            <label className="pv-security-field">
              <span>{t("workspaceSecurity.rulePropertyKey", { defaultValue: "Property" })}</span>
              <TextInput list="pv-slice-properties" value={row.propertyKey} onChange={(event) => patch(index, { propertyKey: event.target.value })} />
            </label>
          )}
          <label className="pv-security-field">
            <span>{operatorLabel}</span>
            <Select value={row.operator} options={sliceRuleOperatorOptions(t, row.field)} ariaLabel={operatorLabel} onChange={(value) => patch(index, { operator: value as SliceRuleOperator })} />
          </label>
          {row.field === "property" && (
            <label className="pv-security-field">
              <span>{valueKindLabel}</span>
              <Select value={row.valueKind} options={sliceRuleValueKindOptions(t)} ariaLabel={valueKindLabel} onChange={(value) => patch(index, { valueKind: value as SliceRuleValueKind })} />
            </label>
          )}
          <label className="pv-security-field">
            <span>{valueLabel}</span>
            {row.field === "property" && row.valueKind === "boolean" ? (
              <Select
                value={row.value === "true" ? "true" : "false"}
                ariaLabel={valueLabel}
                onChange={(value) => patch(index, { value })}
                options={[
                  { value: "true", label: t("common.yes", { defaultValue: "Yes" }) },
                  { value: "false", label: t("common.no", { defaultValue: "No" }) },
                ]}
              />
            ) : row.field === "property" && row.valueKind === "empty" ? (
              <span className="pv-security-picker-empty">{t("workspaceSecurity.ruleValueEmpty", { defaultValue: "no value set" })}</span>
            ) : (
              <TextInput
                list={row.field === "tag" ? "pv-slice-tags" : undefined}
                inputMode={row.field === "property" && row.valueKind === "number" ? "decimal" : undefined}
                value={row.value}
                onChange={(event) => patch(index, { value: event.target.value })}
              />
            )}
          </label>
          <IconButton label={t("common.remove", { defaultValue: "Remove" })} disabled={rows.length === 1} onClick={() => commit(rows.filter((_, position) => position !== index))}>
            <X size={ICON.ui} />
          </IconButton>
        </div>
      ))}
      <datalist id="pv-slice-tags">{tagSuggestions.map((tag) => <option key={tag} value={tag} />)}</datalist>
      <datalist id="pv-slice-properties">{propertySuggestions.map((key) => <option key={key} value={key} />)}</datalist>
      <Button variant="ghost" onClick={() => commit([...rows, emptySliceRuleRow()])}>
        <Plus size={ICON.ui} />
        {t("workspaceSecurity.addRule", { defaultValue: "Add rule" })}
      </Button>
    </div>
  );
};
