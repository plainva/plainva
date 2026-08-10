import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import { Banner, Button, ICON, IconButton, SettingCard, SettingCardNote, SettingRow, Select, Switch, toast } from "@plainva/ui";
import {
  listMailRules,
  needsBody,
  saveMailRules,
  setMailRules,
  vacationSupport,
  type MailAccountConfig,
  type MailRule,
  type RuleField,
  type RuleOp,
} from "@plainva/ui/mail";

/**
 * Mail rules — Settings → Email (S14).
 *
 * The honest label is the point of this card. Right now every rule runs LOCALLY:
 * over what Plainva has fetched, only while it is open. That is a real thing and
 * a limited one, and the card says which — a card that implied a server-side
 * filter would have people rely on a rule that is not running while their laptop
 * is shut.
 *
 * Where the account has a Sieve server (or Graph), the same rule becomes a
 * server-side one in S15/S16. Until then the card names the possibility instead
 * of pretending it is already there.
 */

const FIELDS: RuleField[] = ["from", "to", "subject"];
const OPS: RuleOp[] = ["contains", "notContains", "is", "startsWith", "endsWith"];

export function RulesSettings({ vaultPath, account }: { vaultPath: string; account: MailAccountConfig | null }) {
  const { t } = useTranslation();
  const [rules, setRules] = useState<MailRule[]>([]);

  useEffect(() => {
    if (!vaultPath) return;
    void listMailRules(vaultPath).then(setRules);
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

  const addRule = useCallback(() => {
    const rule: MailRule = {
      // Not crypto — this only has to be unique within one settings file.
      id: `r${rules.length + 1}-${rules.length}${rules.map((r) => r.id).join("").length}`,
      name: t("rules.newRule", { defaultValue: "Neue Regel" }),
      enabled: true,
      match: "all",
      conditions: [{ field: "from", op: "contains", value: "" }],
      actions: [{ kind: "markRead" }],
    };
    void persist([...rules, rule]);
  }, [rules, persist, t]);

  const update = useCallback(
    (id: string, patch: Partial<MailRule>) => void persist(rules.map((r) => (r.id === id ? { ...r, ...patch } : r))),
    [rules, persist]
  );

  const serverSide = account ? vacationSupport(account).kind !== "none" : false;
  const support = account ? vacationSupport(account) : { kind: "none" as const };
  const sieve = support.kind === "sieve";
  const [busy, setBusy] = useState(false);
  const [skipped, setSkipped] = useState<string[]>([]);

  /** Puts the rules on the server. Deliberately an explicit action: uploading
   * on every keystroke would rewrite the script while a rule is half-typed. */
  const publish = useCallback(async () => {
    if (!account) return;
    setBusy(true);
    try {
      const result = await setMailRules(vaultPath, account, rules);
      setSkipped(result.skipped.map((s) => s.id));
      if (result.unreadable) {
        toast.error(
          t("rules.scriptForeign", {
            defaultValue: "Das Filterskript enthält einen Abschnitt, den Plainva nicht sicher lesen kann — es wurde nichts geändert.",
          })
        );
      } else if (result.ok) {
        toast.info(
          result.skipped.length
            ? t("rules.publishedPartly", {
                count: result.skipped.length,
                defaultValue: "Regeln beim Anbieter hinterlegt; {{count}} bleiben lokal, weil der Server sie nicht ausdrücken kann.",
              })
            : t("rules.published", { defaultValue: "Regeln beim Anbieter hinterlegt" })
        );
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [vaultPath, account, rules, t]);

  return (
    <SettingCard label={t("rules.section", { defaultValue: "Regeln" })}>
      {rules.map((rule) => (
        /* Full width, not label + control: the mockup shows the rule as ONE
           readable line, and squeezing three dropdowns into half a card made it
           wrap into a stack that reads like a form, not like a sentence. */
        <SettingRow key={rule.id} label="" wide>
          <span style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap", width: "100%" }}>
            <strong style={{ minWidth: 84 }}>{rule.name}</strong>
            {/* Each control keeps its own track: a Select stretches to the
                width it is given, so without one they each take a whole line. */}
            <span style={{ flex: "0 0 128px" }}>
            <Select
              ariaLabel={t("rules.field", { defaultValue: "Feld" })}
              value={rule.conditions[0]?.field ?? "from"}
              onChange={(v) => update(rule.id, { conditions: [{ ...rule.conditions[0], field: v as RuleField }] })}
              options={FIELDS.map((f) => ({ value: f, label: t(`rules.field_${f}`) }))}
              data-testid={`rule-field-${rule.id}`}
            />
            </span>
            <span style={{ flex: "0 0 148px" }}>
            <Select
              ariaLabel={t("rules.operator", { defaultValue: "Vergleich" })}
              value={rule.conditions[0]?.op ?? "contains"}
              onChange={(v) => update(rule.id, { conditions: [{ ...rule.conditions[0], op: v as RuleOp }] })}
              options={OPS.map((o) => ({ value: o, label: t(`rules.op_${o}`) }))}
              data-testid={`rule-op-${rule.id}`}
            />
            </span>
            <input
              className="pv-field"
              value={rule.conditions[0]?.value ?? ""}
              onChange={(e) => update(rule.id, { conditions: [{ ...rule.conditions[0], value: e.target.value }] })}
              data-testid={`rule-value-${rule.id}`}
              style={{ flex: 1, minWidth: 96 }}
            />
            <Switch checked={rule.enabled} label={rule.name} onChange={(on) => update(rule.id, { enabled: on })} />
            <IconButton label={t("common.delete")} onClick={() => void persist(rules.filter((r) => r.id !== rule.id))} data-testid={`rule-delete-${rule.id}`}>
              <Trash2 size={ICON.ui} />
            </IconButton>
          </span>
        </SettingRow>
      ))}

      <SettingRow label="">
        <span style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <Button onClick={addRule} data-testid="rule-add">
            {t("rules.add", { defaultValue: "Regel hinzufügen" })}
          </Button>
          {sieve && (
            <Button variant="primary" disabled={busy || rules.length === 0} onClick={() => void publish()} data-testid="rules-publish">
              {t("rules.publish", { defaultValue: "Beim Anbieter hinterlegen" })}
            </Button>
          )}
        </span>
      </SettingRow>

      {/* The sentence the whole card exists for. */}
      <SettingCardNote>
        <Banner kind="info" rounded>
          <span data-testid="rules-where">
            {sieve
              ? // Name the server, as the target image does: "runs on the server"
                // is only believable when it says WHICH one.
                t("rules.sieveHint", {
                  host: support.kind === "sieve" ? support.host : "",
                  defaultValue:
                    "Beim Anbieter hinterlegte Regeln laufen auch, wenn Plainva geschlossen ist ({{host}}). Bis dahin greifen sie nur hier, über abgerufene Nachrichten.",
                })
              : serverSide
              ? t("rules.localForNow", {
                  defaultValue:
                    "Regeln laufen derzeit nur, während Plainva geöffnet ist, und nur über Nachrichten, die Plainva abgerufen hat. Dieses Postfach könnte sie serverseitig ausführen — das kommt in einem der nächsten Schritte.",
                })
              : t("rules.localOnly", {
                  defaultValue:
                    "Regeln laufen nur, während Plainva geöffnet ist, und nur über Nachrichten, die Plainva abgerufen hat. Dieses Postfach bietet keine serverseitigen Regeln an.",
                })}
          </span>
        </Banner>
      </SettingCardNote>

      {skipped.length > 0 && (
        <SettingCardNote>
          <span data-testid="rules-skipped">
            {t("rules.skippedNote", {
              count: skipped.length,
              defaultValue: "{{count}} Regeln bleiben lokal — der Server kann sie nicht ausdrücken.",
            })}
          </span>
        </SettingCardNote>
      )}

      {needsBody(rules) && (
        <SettingCardNote>
          <span data-testid="rules-body-note">
            {t("rules.bodyNote", {
              defaultValue:
                "Eine Regel prüft den Nachrichtentext. Der steht nicht in der Übersicht — sie greift erst, wenn Du die Nachricht öffnest.",
            })}
          </span>
        </SettingCardNote>
      )}
    </SettingCard>
  );
}
