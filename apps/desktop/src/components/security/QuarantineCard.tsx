import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, ChevronDown, ChevronUp, MoreHorizontal, RefreshCw, X } from "lucide-react";
import { Button, ICON, IconButton, MenuItem, MenuSeparator, MenuSurface, Segmented, SettingCard, groupQuarantine, isQuarantineGroupOpen, quarantineGroupActionIds, quarantineKindKey, quarantineReasonKeys, quarantineTextVars, relativeTimeLabel, toast, type QuarantineGroup } from "@plainva/ui";
import type { QuarantineRetryOutcome, WorkspaceLocalForkRecord, WorkspaceQuarantineRecord } from "@plainva/core";

/**
 * Integrity & local forks (finding 2026-09-03, Mockup A).
 *
 * What stood here: one `SettingRow` per quarantined artifact, titled
 * "operation · pending", described by the worker's English sentence, with
 * four ghost buttons in a 300px column that ran over the text - twelve times
 * the same row when one device chain broke, and a retry that changed nothing
 * anyone could see.
 *
 * What stands here: one GROUP per cause on one device, in the person's
 * language, with the numbers the check knew, a line on what to do, and
 * actions that wrap. "Check again" waits for the cycle and answers; settled
 * groups hide behind "All"; the entries are there on request.
 */
export interface QuarantineCardProps {
  quarantine: readonly WorkspaceQuarantineRecord[];
  localForks: readonly WorkspaceLocalForkRecord[];
  /** Opens the fork beside the note it forked from, with the conflict exits (C36). */
  onCompareFork?: (fork: WorkspaceLocalForkRecord) => void;
  busy: boolean;
  onRetry(ids: string[]): Promise<QuarantineRetryOutcome | null>;
  onIgnore(ids: string[]): Promise<void>;
  onRepaired(ids: string[]): Promise<void>;
  onExportDiagnostics(ids: string[]): Promise<void>;
  onExportCiphertext(id: string): Promise<void>;
  onOpenPath?(path: string): void;
}

type Filter = "open" | "all";

export function QuarantineCard({ quarantine, localForks, busy, onRetry, onIgnore, onRepaired, onExportDiagnostics, onExportCiphertext, onOpenPath, onCompareFork }: QuarantineCardProps) {
  const { t, i18n } = useTranslation();
  const [filter, setFilter] = useState<Filter>("open");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [menu, setMenu] = useState<{ key: string; at: { x: number; y: number } } | null>(null);
  /** Groups a retry left as they were: the pill says so until the list changes under them. */
  const [rechecked, setRechecked] = useState<ReadonlySet<string>>(() => new Set());

  const groups = useMemo(() => groupQuarantine(quarantine), [quarantine]);
  const openCount = groups.filter(isQuarantineGroupOpen).length;
  const shown = filter === "open" ? groups.filter(isQuarantineGroupOpen) : groups;
  const locale = i18n.language;
  const when = (iso: string) => relativeTimeLabel(iso, locale);

  const toggleExpanded = (key: string) => setExpanded((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });

  const retry = async (group: QuarantineGroup) => {
    const ids = quarantineGroupActionIds(group);
    const outcome = await onRetry(ids);
    if (!outcome) return;
    if (!outcome.checked) { toast.info(t("workspaceSecurity.retryQueued")); return; }
    if (outcome.open === 0) {
      toast.info(t("workspaceSecurity.quarantineRecheckClear"));
      setRechecked((prev) => { const next = new Set(prev); next.delete(group.key); return next; });
    } else {
      toast.info(t("workspaceSecurity.quarantineRecheckResult", { open: outcome.open, total: outcome.total }));
      setRechecked((prev) => new Set(prev).add(group.key));
    }
  };

  const groupTexts = (group: QuarantineGroup) => {
    const keys = quarantineReasonKeys(group.family);
    const vars = { ...quarantineTextVars(group, t("workspaceSecurity.quarantineUnknownDevice")), kind: t(quarantineKindKey(group.artifactKind)), reason: group.reason };
    return { title: t(keys.title), explain: t(keys.explain, vars), hint: keys.hint ? t(keys.hint, vars) : null };
  };

  if (quarantine.length === 0 && localForks.length === 0) return null;

  return (
    <SettingCard label={t("workspaceSecurity.integrityCard")}>
      {quarantine.length > 0 && (
        <div className="pv-quarantine-head">
          <Segmented<Filter>
            size="sm"
            ariaLabel={t("workspaceSecurity.integrityCard")}
            value={filter}
            onChange={setFilter}
            options={[
              { value: "open", label: t("workspaceSecurity.quarantineFilterOpen", { n: openCount }), testId: "quarantine-filter-open" },
              { value: "all", label: t("workspaceSecurity.quarantineFilterAll", { n: groups.length }), testId: "quarantine-filter-all" },
            ]}
          />
        </div>
      )}
      {quarantine.length > 0 && shown.length === 0 && <p className="pv-quarantine-empty">{t("workspaceSecurity.quarantineNoneOpen")}</p>}
      {shown.map((group) => {
        const open = isQuarantineGroupOpen(group);
        const texts = groupTexts(group);
        const isExpanded = expanded.has(group.key);
        return (
          <section key={group.key} className={`pv-quarantine-group${open ? "" : " is-settled"}`} data-testid="quarantine-group" data-family={group.family} aria-label={texts.title}>
            <h4 className="pv-quarantine-title">
              {open ? <AlertTriangle size={ICON.ui} aria-hidden="true" /> : <Check size={ICON.ui} aria-hidden="true" />}
              <span>{texts.title}</span>
            </h4>
            <div className="pv-quarantine-meta">
              <span>{t("workspaceSecurity.quarantineEntries", { count: group.entries.length })}</span>
              <span>{t(quarantineKindKey(group.artifactKind))}</span>
              {group.deviceName && <span>{t("workspaceSecurity.quarantineDevice", { device: group.deviceName })}</span>}
              <span>{t("workspaceSecurity.quarantineSince", { time: when(group.firstSeenAt) })}</span>
              {open && group.lastTriedAt !== group.firstSeenAt && <span>{t("workspaceSecurity.quarantineLastTried", { time: when(group.lastTriedAt) })}</span>}
              {open && rechecked.has(group.key) && <span className="pv-quarantine-pill is-warn">{t("workspaceSecurity.quarantineSameCause")}</span>}
              {!open && group.resolved > 0 && group.pending === 0 && group.ignored === 0 && group.repaired === 0 && <span className="pv-quarantine-pill is-ok">{t("workspaceSecurity.quarantineResolvedSelf")}</span>}
              {!open && group.resolvedAt && <span>{t("workspaceSecurity.quarantineResolvedAt", { time: when(group.resolvedAt) })}</span>}
              {!open && group.ignored > 0 && <span className="pv-quarantine-pill">{t("workspaceSecurity.ignored")}</span>}
              {!open && group.repaired > 0 && <span className="pv-quarantine-pill">{t("workspaceSecurity.repaired")}</span>}
            </div>
            <p className="pv-quarantine-explain">{texts.explain}</p>
            {open && texts.hint && <p className="pv-quarantine-hint"><strong>{t("workspaceSecurity.quarantineWhatToDo")}</strong> {texts.hint}</p>}
            <div className="pv-quarantine-actions">
              {open && (
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => void retry(group)} data-testid="quarantine-recheck">
                  <RefreshCw size={ICON.meta} /> {t("workspaceSecurity.quarantineRecheck")}
                </Button>
              )}
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void onExportDiagnostics(group.entries.map((entry) => entry.quarantineId))}>{t("workspaceSecurity.quarantineExportDiagnostics")}</Button>
              {open && (
                <IconButton size="sm" label={t("workspaceSecurity.quarantineMoreActions")} disabled={busy} onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setMenu({ key: group.key, at: { x: rect.left, y: rect.bottom } }); }} data-testid="quarantine-more">
                  <MoreHorizontal size={ICON.ui} />
                </IconButton>
              )}
              <span className="pv-quarantine-spacer" />
              <Button variant="ghost" size="sm" onClick={() => toggleExpanded(group.key)} aria-expanded={isExpanded} data-testid="quarantine-toggle-entries">
                {isExpanded ? t("workspaceSecurity.quarantineHideEntries") : t("workspaceSecurity.quarantineShowEntries", { count: group.entries.length })}
                {isExpanded ? <ChevronUp size={ICON.meta} aria-hidden="true" /> : <ChevronDown size={ICON.meta} aria-hidden="true" />}
              </Button>
            </div>
            {isExpanded && (
              <ul className="pv-quarantine-entries">
                {group.entries.map((entry) => (
                  <li key={entry.quarantineId} className="pv-quarantine-entry">
                    <code>{entry.remoteKey}</code>
                    <span>{when(entry.firstSeenAt)}</span>
                    <span>{entry.reason}</span>
                    {entry.status !== "pending" && <span className="pv-quarantine-pill">{entry.status === "resolved" ? t("workspaceSecurity.quarantineResolvedSelf") : entry.status === "ignored" ? t("workspaceSecurity.ignored") : t("workspaceSecurity.repaired")}</span>}
                    <Button variant="ghost" size="sm" onClick={() => void onExportCiphertext(entry.quarantineId)}>{t("workspaceSecurity.quarantineExportCiphertext")}</Button>
                  </li>
                ))}
              </ul>
            )}
            {menu?.key === group.key && (
              <MenuSurface open at={menu.at} onClose={() => setMenu(null)} ariaLabel={t("workspaceSecurity.quarantineMoreActions")}>
                <MenuItem onSelect={() => { setMenu(null); void onRepaired(quarantineGroupActionIds(group)); }}>
                  <Check size={ICON.meta} /> {t("workspaceSecurity.quarantineMarkRepaired")}
                </MenuItem>
                <MenuSeparator />
                <MenuItem danger onSelect={() => { setMenu(null); void onIgnore(quarantineGroupActionIds(group)); }} data-testid="quarantine-ignore-group">
                  <X size={ICON.meta} /> {t("workspaceSecurity.quarantineIgnoreGroup", { count: quarantineGroupActionIds(group).length })}
                </MenuItem>
              </MenuSurface>
            )}
          </section>
        );
      })}
      {localForks.length > 0 && (
        <>
          <p className="pv-quarantine-subhead">{t("workspaceSecurity.quarantineForks")}</p>
          {localForks.map((fork) => (
            <section key={fork.forkId} className="pv-quarantine-group is-fork" data-testid="quarantine-fork">
              <h4 className="pv-quarantine-title"><span>{fork.originalPath}</span></h4>
              <p className="pv-quarantine-explain"><code>{fork.forkPath}</code> · {t(`workspaceSecurity.forkReason.${fork.reason}`)} · {when(fork.createdAt)}</p>
              {(onOpenPath || onCompareFork) && (
                <div className="pv-quarantine-actions">
                  {onCompareFork && (
                    <Button variant="primary" size="sm" onClick={() => onCompareFork(fork)} data-testid="fork-compare">{t("workspaceSecurity.forkCompare")}</Button>
                  )}
                  {onOpenPath && (
                    <Button variant="secondary" size="sm" onClick={() => onOpenPath(fork.forkPath)}>{t("workspaceSecurity.forkOpen")}</Button>
                  )}
                </div>
              )}
            </section>
          ))}
        </>
      )}
    </SettingCard>
  );
}
