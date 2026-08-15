import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Plus, Trash2 } from "lucide-react";
import { Button, GroupCard, ICON, IconButton, Row, RowList, SectionLabel, Switch, toast } from "@plainva/ui";
import type { MailRule, RuleAction, RuleCondition, RuleField, RuleOp } from "@plainva/ui/mail";
import { listMailRules, saveMailRules } from "@plainva/ui/mail";
import { AppBar } from "../components/AppBar";
import { mConfirm, mPrompt, mSelect } from "../services/mobileDialogs";
import { mailVaultId } from "../services/mail/mailRuntime";

/**
 * Editing one rule on the phone (S16b).
 *
 * The desktop editor is a form; here it becomes a **chain of sheets** rather
 * than a shrunken modal. Every choice is one decision on one sheet, over the
 * `mSelect`/`mPrompt` grammar the rest of the app already uses — a form with
 * five controls squeezed into a phone width is how a rule gets mistyped.
 *
 * The model and both translations come from S14–S16; nothing here decides what
 * a rule MEANS. What this screen owns is the shape of the conversation.
 */

const FIELDS: RuleField[] = ["from", "to", "cc", "subject", "body", "header"];
const OPS: RuleOp[] = ["contains", "notContains", "is", "startsWith", "endsWith"];
const ACTIONS: RuleAction["kind"][] = ["moveTo", "capture", "markRead", "flag", "junk", "trash", "stop"];

export function MailRuleScreen({ ruleId, onBack }: { ruleId: string; onBack: () => void }) {
  const { t } = useTranslation();
  const vaultPath = mailVaultId() ?? "";
  const [rules, setRules] = useState<MailRule[]>([]);
  const rule = rules.find((r) => r.id === ruleId) ?? null;

  useEffect(() => {
    if (vaultPath) void listMailRules(vaultPath).then(setRules).catch(() => setRules([]));
  }, [vaultPath]);

  const persist = useCallback(
    async (next: MailRule[]) => {
      setRules(next);
      try {
        await saveMailRules(vaultPath, next);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      }
    },
    [vaultPath]
  );

  const patch = useCallback(
    (change: Partial<MailRule>) => void persist(rules.map((r) => (r.id === ruleId ? { ...r, ...change } : r))),
    [rules, ruleId, persist]
  );

  const conditionLabel = (c: RuleCondition) =>
    `${t(`rules.field_${c.field}`)} ${t(`rules.op_${c.op}`)} ${c.value || "…"}`;

  const actionLabel = (a: RuleAction) =>
    a.kind === "moveTo" ? `${t("rules.action_moveTo")}: ${a.mailbox || "…"}` : t(`rules.action_${a.kind}`);

  /** One condition, asked as three sheets: field, comparison, value. Each is a
   * decision on its own — cancelling the second leaves the first untouched. */
  const editCondition = useCallback(
    async (index: number) => {
      if (!rule) return;
      const current = rule.conditions[index];
      const field = (await mSelect({
        title: t("rules.field", { defaultValue: "Feld" }),
        options: FIELDS.map((f) => ({ value: f, label: t(`rules.field_${f}`) })),
        value: current?.field,
      })) as RuleField | null;
      if (!field) return;

      const op = (await mSelect({
        title: t("rules.operator", { defaultValue: "Vergleich" }),
        options: OPS.map((o) => ({ value: o, label: t(`rules.op_${o}`) })),
        value: current?.op,
      })) as RuleOp | null;
      if (!op) return;

      const { value, cancelled } = await mPrompt({
        title: t("rules.value", { defaultValue: "Wert" }),
        initial: current?.value ?? "",
      });
      if (cancelled) return;

      const header =
        field === "header"
          ? (await mPrompt({ title: t("rules.headerName", { defaultValue: "Kopfzeile" }), initial: current?.header ?? "" })).value
          : undefined;

      const next = [...rule.conditions];
      next[index] = { field, op, value, ...(header ? { header } : {}) };
      patch({ conditions: next });
    },
    [rule, patch, t]
  );

  const editAction = useCallback(
    async (index: number) => {
      if (!rule) return;
      const current = rule.actions[index];
      const kind = (await mSelect({
        title: t("rules.action", { defaultValue: "Aktion" }),
        options: ACTIONS.map((a) => ({ value: a, label: t(`rules.action_${a}`) })),
        value: current?.kind,
      })) as RuleAction["kind"] | null;
      if (!kind) return;

      let action: RuleAction;
      if (kind === "moveTo") {
        const { value, cancelled } = await mPrompt({
          title: t("rules.mailbox", { defaultValue: "Ordner" }),
          initial: current?.kind === "moveTo" ? current.mailbox : "",
        });
        if (cancelled) return;
        action = { kind: "moveTo", mailbox: value };
      } else {
        action = { kind };
      }

      const next = [...rule.actions];
      next[index] = action;
      patch({ actions: next });
    },
    [rule, patch, t]
  );

  if (!rule) {
    return (
      <>
        <AppBar title={t("rules.section")} onBack={onBack} />
        <div className="m-page">
          <p className="m-hint" data-testid="rule-missing">
            {t("rules.gone", { defaultValue: "Diese Regel gibt es nicht mehr." })}
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <AppBar title={rule.name} onBack={onBack} />
      <div className="m-page">
        <div className="m-settings">
        <GroupCard>
          <RowList>
            <Row
              title={t("rules.name", { defaultValue: "Name" })}
              end={<span className="m-prop-val">{rule.name}</span>}
              data-testid="rule-name"
              onClick={async () => {
                const { value, cancelled } = await mPrompt({ title: t("rules.name", { defaultValue: "Name" }), initial: rule.name });
                if (!cancelled && value.trim()) patch({ name: value.trim() });
              }}
            />
            <Row
              title={t("common.on")}
              end={<Switch checked={rule.enabled} label={rule.name} onChange={(on) => patch({ enabled: on })} />}
            />
            <Row
              title={t("rules.match", { defaultValue: "Trifft zu, wenn" })}
              end={<span className="m-prop-val">{t(`rules.match_${rule.match}`)}</span>}
              data-testid="rule-match"
              onClick={async () => {
                const v = await mSelect({
                  title: t("rules.match", { defaultValue: "Trifft zu, wenn" }),
                  options: (["all", "any"] as const).map((m) => ({ value: m, label: t(`rules.match_${m}`) })),
                  value: rule.match,
                });
                if (v) patch({ match: v as "all" | "any" });
              }}
            />
          </RowList>
        </GroupCard>

        {/* "Wenn" and "Dann" as the target image names them — the two halves a
            rule is actually made of, not one undifferentiated list. */}
        <SectionLabel>{t("rules.when", { defaultValue: "Wenn" })}</SectionLabel>
        <GroupCard>
          <RowList>
            {rule.conditions.map((c, i) => (
              <Row
                key={i}
                title={conditionLabel(c)}
                end={
                  <>
                    {rule.conditions.length > 1 && (
                      <IconButton
                        label={t("common.delete")}
                        onClick={() => patch({ conditions: rule.conditions.filter((_, j) => j !== i) })}
                      >
                        <Trash2 size={ICON.ui} />
                      </IconButton>
                    )}
                    <ChevronRight size={ICON.ui} />
                  </>
                }
                // The row carries its own control AND still leads somewhere.
                controls
                data-testid={`rule-condition-${i}`}
                onClick={() => void editCondition(i)}
              />
            ))}
            <Row
              icon={<Plus size={ICON.ui} />}
              title={t("rules.addCondition", { defaultValue: "Bedingung hinzufügen" })}
              data-testid="rule-add-condition"
              onClick={() => {
                const next = [...rule.conditions, { field: "from" as RuleField, op: "contains" as RuleOp, value: "" }];
                patch({ conditions: next });
                void editCondition(next.length - 1);
              }}
            />
          </RowList>
        </GroupCard>

        <SectionLabel>{t("rules.then", { defaultValue: "Dann" })}</SectionLabel>
        <GroupCard>
          <RowList>
            {rule.actions.map((a, i) => (
              <Row
                key={i}
                title={actionLabel(a)}
                end={
                  <>
                    {rule.actions.length > 1 && (
                      <IconButton label={t("common.delete")} onClick={() => patch({ actions: rule.actions.filter((_, j) => j !== i) })}>
                        <Trash2 size={ICON.ui} />
                      </IconButton>
                    )}
                    <ChevronRight size={ICON.ui} />
                  </>
                }
                controls
                data-testid={`rule-action-${i}`}
                onClick={() => void editAction(i)}
              />
            ))}
            <Row
              icon={<Plus size={ICON.ui} />}
              title={t("rules.addAction", { defaultValue: "Aktion hinzufügen" })}
              data-testid="rule-add-action"
              onClick={() => {
                const next = [...rule.actions, { kind: "markRead" } as RuleAction];
                patch({ actions: next });
                void editAction(next.length - 1);
              }}
            />
          </RowList>
        </GroupCard>

        <Button
            variant="danger"
            data-testid="rule-delete"
            onClick={async () => {
              if (!(await mConfirm({ title: t("rules.deleteConfirm", { defaultValue: "Regel löschen?" }), danger: true }))) return;
              await persist(rules.filter((r) => r.id !== ruleId));
              onBack();
            }}
          >
          {t("common.delete")}
        </Button>
        </div>
      </div>
    </>
  );
}
