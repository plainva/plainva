import { useState } from "react";
import { useTranslation } from "react-i18next";
import { freeCopyPath, type CollisionCopy, type NameCollisionAction, type NameCollisionCase, type NameTwinResolution } from "@plainva/core";
import { formatByteSize } from "../base/computedFields";
import { toast } from "../services/toastStore";
import { errorText } from "../lib/errorText";
import { Banner } from "./ui/Banner";
import { Button } from "./ui/Button";
import { GroupCard, Row, RowList } from "./ui/GroupedRows";
import { InfoTip } from "./ui/InfoTip";
import { cx } from "./ui/cx";

/**
 * "Same name, two files" (finding 2026-11-03): ONE surface for both shells.
 *
 * The card used to print each pair as `Notiz.md ↔ Notiz.md` — the same name in
 * two Unicode forms looks the same, so it told nobody which was which — and
 * asked for a rename the phone could not even offer. Now it lists each case
 * once, folder and name, with what tells the two copies apart (identical, or
 * size and time of each), and acts: **Remove duplicates** for copies that are
 * the same byte for byte, **Keep both** for the rest. The shells hand in their
 * confirmation dialog and what the actions do (the worker, and for a
 * letter-case pair their own rename).
 */
export interface NameCollisionsResult {
  removed: number;
  kept: number;
  skipped: number;
  restored?: number;
}

const folderOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

export interface NameCollisionsNoticeProps {
  cases: readonly NameCollisionCase[];
  confirm(opts: { title: string; message: string; confirmLabel: string }): Promise<boolean>;
  onResolve(action: NameCollisionAction): Promise<NameCollisionsResult>;
  className?: string;
}

/**
 * What both shells do when a button is pressed: twin spellings go to the sync
 * worker (it compares again and acts on a fresh listing), and a letter-case
 * pair is kept by giving this device's file a free name (`Name (2).md`)
 * through the shell's own rename, so links to it follow.
 */
export async function resolveNameCollisionCases(
  action: NameCollisionAction,
  cases: readonly NameCollisionCase[],
  deps: {
    resolveTwins?: (action: NameCollisionAction) => Promise<NameTwinResolution>;
    /** Paths in `folder` on this device ("" is the vault root). */
    listPaths(folder: string): Promise<string[]>;
    /** The shell's rename with link updates; false where it refused. */
    rename(from: string, to: string): Promise<boolean>;
  },
): Promise<NameCollisionsResult> {
  const result: NameCollisionsResult = { removed: 0, kept: 0, skipped: 0, restored: 0 };
  const twinCases = cases.filter((c) => c.kind === "spelling" && c.action === action).length;
  if (twinCases > 0 && !deps.resolveTwins) {
    // No plain file sync runs that could act on them (it stopped meanwhile).
    result.skipped += twinCases;
  }
  let failure: unknown = null;
  if (twinCases > 0 && deps.resolveTwins) {
    try {
      const twins = await deps.resolveTwins(action);
      result.removed += twins.removed;
      result.kept += twins.kept.length;
      result.skipped += twins.skipped;
      result.restored = (result.restored ?? 0) + twins.restored.length;
    } catch (e) {
      // The letter-case pairs below do not depend on the sync: they go on.
      failure = e;
      result.skipped += twinCases;
    }
  }
  const done = () => {
    if (failure && result.removed + result.kept === 0) throw failure;
    return result;
  };
  if (action !== "keep-both") return done();
  for (const c of cases) {
    if (c.kind !== "case" || c.action !== "keep-both") continue;
    try {
      const siblings = await deps.listPaths(folderOf(c.path));
      const to = freeCopyPath(c.path, [...siblings, c.path, ...c.others]);
      if (await deps.rename(c.path, to)) result.kept++;
      else result.skipped++;
    } catch (e) {
      console.warn(`[NameCollisionsNotice] could not rename ${c.path}`, e);
      result.skipped++;
    }
  }
  return done();
}

const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

export function NameCollisionsNotice({ cases, confirm, onResolve, className }: NameCollisionsNoticeProps) {
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState(false);
  if (cases.length === 0) return null;
  const removable = cases.filter((c) => c.action === "remove-duplicate").length;
  const keepable = cases.filter((c) => c.action === "keep-both").length;

  const facts = (copy: CollisionCopy | null) => {
    if (!copy) return "";
    const size = copy.size === null ? "" : formatByteSize(copy.size);
    if (copy.modifiedMs === null) return size;
    const date = new Date(copy.modifiedMs).toLocaleString(i18n.language, { dateStyle: "short", timeStyle: "short" });
    return t("sync.collisionFacts", { size, date });
  };

  const run = async (action: NameCollisionAction) => {
    const count = action === "remove-duplicate" ? removable : keepable;
    const ok = await confirm(
      action === "remove-duplicate"
        ? { title: t("sync.collisionRemoveConfirmTitle"), message: t("sync.collisionRemoveConfirmMsg", { count }), confirmLabel: t("sync.collisionRemove") }
        : { title: t("sync.collisionKeepConfirmTitle"), message: t("sync.collisionKeepConfirmMsg", { count }), confirmLabel: t("sync.collisionKeepBoth") },
    );
    if (!ok) return;
    setBusy(true);
    try {
      const result = await onResolve(action);
      if (result.removed > 0 || result.kept > 0) toast.success(t("sync.collisionDone", { removed: result.removed, kept: result.kept }));
      if (result.skipped > 0) toast.info(t("sync.collisionSkipped", { count: result.skipped }));
      if (result.restored) toast.warning(t("sync.collisionRestored", { count: result.restored }));
    } catch (e) {
      toast.error(t("sync.collisionFailed", { error: errorText(e) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cx("pv-names-notice", className)} data-testid="sync-collisions">
      <Banner
        kind="warning"
        rounded
        actions={
          removable + keepable > 0 ? (
            <>
              {removable > 0 && (
                <Button variant="primary" size="sm" disabled={busy} onClick={() => void run("remove-duplicate")} data-testid="sync-collisions-remove">
                  {t("sync.collisionRemove")} ({removable})
                </Button>
              )}
              {keepable > 0 && (
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => void run("keep-both")} data-testid="sync-collisions-keep">
                  {t("sync.collisionKeepBoth")} ({keepable})
                </Button>
              )}
            </>
          ) : undefined
        }
      >
        <strong>{t("sync.collisionTitle")}</strong>
        <InfoTip label={t("sync.collisionTitle")} info={t("sync.collisionBody")} />{" "}
        {t("sync.collisionHint")}
      </Banner>
      <GroupCard>
        <RowList>
          {cases.map((c) => {
            const folder = folderOf(c.path);
            const where = [c.where.here && t("sync.collisionHere"), c.where.remote && t("sync.collisionCloud")].filter(Boolean).join(", ");
            const verdict = c.kind === "case"
              ? t("sync.collisionCaseOnly")
              : [t("sync.collisionTwice"), c.identical === true ? t("sync.collisionIdentical") : c.identical === false ? t("sync.collisionDifferent") : t("sync.collisionUnknown")].join(" · ");
            const lines = [verdict];
            if (c.described && c.identical !== true) {
              if (c.synced) lines.push(t("sync.collisionSyncedCopy", { facts: facts(c.synced) }));
              if (c.other) lines.push(t("sync.collisionOtherCopy", { where, facts: facts(c.other) }));
            } else if (c.described && where) {
              lines.push(where);
            }
            return (
              <Row
                key={c.key}
                wrap
                data-testid="sync-collision-case"
                data-kind={c.kind}
                title={
                  <span>
                    <strong>{c.kind === "case" ? [c.path, ...c.others].map(nameOf).join(" / ") : nameOf(c.path)}</strong>
                    {folder ? <> {t("sync.collisionInFolder", { folder })}</> : null}
                  </span>
                }
                subtitle={<span data-testid="sync-collision-facts">{lines.join(" — ")}</span>}
              />
            );
          })}
        </RowList>
      </GroupCard>
    </div>
  );
}
