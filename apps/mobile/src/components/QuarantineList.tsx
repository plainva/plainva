import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, RefreshCw } from "lucide-react";
import { Button, GroupCard, ICON, SectionLabel, Segmented, groupQuarantine, isQuarantineGroupOpen, quarantineGroupActionIds, quarantineKindKey, quarantineReasonKeys, quarantineTextVars, relativeTimeLabel, toast, type QuarantineGroup } from "@plainva/ui";
import type { QuarantineRetryOutcome, WorkspaceLocalForkRecord, WorkspaceQuarantineRecord } from "@plainva/core";

/**
 * Integrity on the phone (finding 2026-09-03, Mockup A's phone column).
 *
 * The screen listed the quarantine read-only: the artifact kind as a title,
 * the worker's English sentence as a subtitle, no action. It now shows the
 * same groups as the desktop card - the shared grouping decides what belongs
 * together and which texts fit - with "Check again", the diagnosis and the
 * settle actions as full-width buttons. The diagnosis goes to the clipboard:
 * the phone has no "save as", and a share sheet for a JSON nobody opens on a
 * phone would be theatre (parity catalog: workspace-quarantine-export).
 */
export interface QuarantineListProps {
  /** Opens the fork beside its note with the conflict exits (C36). */
  onCompareFork?: (fork: WorkspaceLocalForkRecord) => void;
  quarantine: readonly WorkspaceQuarantineRecord[];
  localForks: readonly WorkspaceLocalForkRecord[];
  busy: boolean;
  onRetry(ids: string[]): Promise<QuarantineRetryOutcome | null>;
  onIgnore(ids: string[]): Promise<void>;
  onRepaired(ids: string[]): Promise<void>;
  onExportDiagnostics(ids: string[]): Promise<string>;
}

export function QuarantineList({ quarantine, localForks, busy, onRetry, onIgnore, onRepaired, onExportDiagnostics, onCompareFork }: QuarantineListProps) {
  const { t, i18n } = useTranslation();
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [more, setMore] = useState<string | null>(null);
  const [rechecked, setRechecked] = useState<ReadonlySet<string>>(() => new Set());
  const groups = useMemo(() => groupQuarantine(quarantine), [quarantine]);
  const openCount = groups.filter(isQuarantineGroupOpen).length;
  const shown = filter === "open" ? groups.filter(isQuarantineGroupOpen) : groups;
  const when = (iso: string) => relativeTimeLabel(iso, i18n.language);

  if (quarantine.length === 0 && localForks.length === 0) return null;

  const retry = async (group: QuarantineGroup) => {
    const outcome = await onRetry(quarantineGroupActionIds(group));
    if (!outcome) return;
    if (!outcome.checked) { toast.info(t("workspaceSecurity.retryQueued")); return; }
    if (outcome.open === 0) toast.info(t("workspaceSecurity.quarantineRecheckClear"));
    else { toast.info(t("workspaceSecurity.quarantineRecheckResult", { open: outcome.open, total: outcome.total })); setRechecked((prev) => new Set(prev).add(group.key)); }
  };

  const exportGroup = async (group: QuarantineGroup) => {
    const json = await onExportDiagnostics(group.entries.map((entry) => entry.quarantineId));
    await navigator.clipboard.writeText(json);
    toast.info(t("workspaceSecurity.quarantineExportCopied"));
  };

  return (
    <>
      <SectionLabel end={<Segmented size="sm" ariaLabel={t("workspaceSecurity.integrityCard")} value={filter} onChange={setFilter} options={[{ value: "open", label: t("workspaceSecurity.quarantineFilterOpen", { n: openCount }) }, { value: "all", label: t("workspaceSecurity.quarantineFilterAll", { n: groups.length }) }]} />}>
        {t("workspaceSecurity.integrityCard")}
      </SectionLabel>
      {shown.length === 0 && quarantine.length > 0 && <GroupCard><p className="pv-quarantine-empty">{t("workspaceSecurity.quarantineNoneOpen")}</p></GroupCard>}
      {shown.map((group) => {
        const open = isQuarantineGroupOpen(group);
        const keys = quarantineReasonKeys(group.family);
        const vars = { ...quarantineTextVars(group, t("workspaceSecurity.quarantineUnknownDevice")), kind: t(quarantineKindKey(group.artifactKind)), reason: group.reason };
        const isExpanded = expanded.has(group.key);
        return (
          <GroupCard key={group.key} tone={open ? "warn" : undefined}>
            <section className={`pv-quarantine-group${open ? "" : " is-settled"}`} data-testid="quarantine-group" data-family={group.family}>
              <h4 className="pv-quarantine-title">
                {open ? <AlertTriangle size={ICON.ui} aria-hidden="true" /> : <Check size={ICON.ui} aria-hidden="true" />}
                <span>{t(keys.title)}</span>
              </h4>
              <div className="pv-quarantine-meta">
                <span>{t("workspaceSecurity.quarantineEntries", { count: group.entries.length })}</span>
                <span>{t(quarantineKindKey(group.artifactKind))}</span>
                {group.deviceName && <span>{group.deviceName}</span>}
                <span>{t("workspaceSecurity.quarantineSince", { time: when(group.firstSeenAt) })}</span>
                {open && rechecked.has(group.key) && <span className="pv-quarantine-pill is-warn">{t("workspaceSecurity.quarantineSameCause")}</span>}
                {!open && group.resolved > 0 && group.ignored === 0 && group.repaired === 0 && <span className="pv-quarantine-pill is-ok">{t("workspaceSecurity.quarantineResolvedSelf")}</span>}
                {!open && group.ignored > 0 && <span className="pv-quarantine-pill">{t("workspaceSecurity.ignored")}</span>}
                {!open && group.repaired > 0 && <span className="pv-quarantine-pill">{t("workspaceSecurity.repaired")}</span>}
              </div>
              <p className="pv-quarantine-explain">{t(keys.explain, vars)}</p>
              {open && keys.hint && <p className="pv-quarantine-hint"><strong>{t("workspaceSecurity.quarantineWhatToDo")}</strong> {t(keys.hint, vars)}</p>}
              <div className="m-sync-actions">
                {open && <Button variant="tonal" disabled={busy} onClick={() => void retry(group)} data-testid="quarantine-recheck"><RefreshCw size={ICON.ui} /> {t("workspaceSecurity.quarantineRecheck")}</Button>}
                <Button variant="ghost" disabled={busy} onClick={() => void exportGroup(group)}>{t("workspaceSecurity.quarantineExportDiagnostics")}</Button>
                {open && <Button variant="ghost" disabled={busy} onClick={() => setMore(more === group.key ? null : group.key)} aria-expanded={more === group.key}>{t("workspaceSecurity.quarantineMoreActions")}</Button>}
              </div>
              {open && more === group.key && (
                <div className="m-sync-actions">
                  <Button variant="ghost" disabled={busy} onClick={() => { setMore(null); void onRepaired(quarantineGroupActionIds(group)); }}>{t("workspaceSecurity.quarantineMarkRepaired")}</Button>
                  <Button variant="danger" disabled={busy} onClick={() => { setMore(null); void onIgnore(quarantineGroupActionIds(group)); }} data-testid="quarantine-ignore-group">{t("workspaceSecurity.quarantineIgnoreGroup", { count: quarantineGroupActionIds(group).length })}</Button>
                </div>
              )}
              <Button variant="ghost" size="sm" onClick={() => setExpanded((prev) => { const next = new Set(prev); if (next.has(group.key)) next.delete(group.key); else next.add(group.key); return next; })} aria-expanded={isExpanded}>
                {isExpanded ? t("workspaceSecurity.quarantineHideEntries") : t("workspaceSecurity.quarantineShowEntries", { count: group.entries.length })}
              </Button>
              {isExpanded && (
                <ul className="pv-quarantine-entries">
                  {group.entries.map((entry) => (
                    <li key={entry.quarantineId} className="pv-quarantine-entry">
                      <code>{entry.remoteKey}</code>
                      <span>{when(entry.firstSeenAt)}</span>
                      <span>{entry.reason}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </GroupCard>
        );
      })}
      {localForks.length > 0 && (
        <>
          <SectionLabel end={localForks.length}>{t("workspaceSecurity.quarantineForks")}</SectionLabel>
          {localForks.map((fork) => (
            <GroupCard key={fork.forkId}>
              <section className="pv-quarantine-group is-fork" data-testid="quarantine-fork">
                <h4 className="pv-quarantine-title"><span>{fork.originalPath}</span></h4>
                <p className="pv-quarantine-explain"><code>{fork.forkPath}</code> · {t(`workspaceSecurity.forkReason.${fork.reason}`)} · {when(fork.createdAt)}</p>
                {/* The desktop card offered "open" and, since C36, "compare"; the
                    phone had neither - a list of paths nobody could act on. */}
                {onCompareFork && (
                  <div className="pv-quarantine-actions">
                    <Button variant="primary" size="sm" disabled={busy} onClick={() => onCompareFork(fork)} data-testid="fork-compare">{t("workspaceSecurity.forkCompare")}</Button>
                  </div>
                )}
              </section>
            </GroupCard>
          ))}
        </>
      )}
    </>
  );
}
