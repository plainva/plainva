import { useEffect, useLayoutEffect, useReducer, useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen, GitMerge, RefreshCw } from "lucide-react";
import { Button, GroupCard, ICON, Row, RowList } from "@plainva/ui";
import type { VaultTransferPlan } from "@plainva/core";
import { CompareVersions } from "./CompareVersions";
import { SheetGrip } from "./SheetGrip";
import { CONNECT_RUN_EVENT, loadConnectQueue } from "../services/connectQueue";

/** What the person answers to a copy into a new vault: go on, stop, or pick another folder. */
export type TransferAnswer = "apply" | "cancel" | "otherFolder";

export interface TransferReview {
  plan: VaultTransferPlan;
  /** The vault the run started in. */
  source: string;
  /** The vault the files go into. */
  target: string;
  /** The cloud folder chosen. */
  folder: string;
  /** The target vault exists already (a retry of the same run). */
  existing: boolean;
  /** The connect run that asks; a review of another run is never shown or answered for this one. */
  runId?: string;
  resolve: (answer: TransferAnswer) => void;
}

let pending: TransferReview | null = null;
/** Files steps on screen that show the review in place (plan "Verbinden-Assistent", E4). */
let inlineConsumers = 0;
const EVENT = "m-transfer-review";

export function reviewVaultTransfer(plan: VaultTransferPlan, about: Omit<TransferReview, "plan" | "resolve">): Promise<TransferAnswer> {
  if (pending) throw new Error("transfer_review_busy");
  return new Promise((resolve) => {
    pending = { plan, ...about, resolve };
    window.dispatchEvent(new Event(EVENT));
  });
}

/**
 * Stop or Skip while the review of this run is open (fourth review
 * 2026-10-28): the copy waits for this answer, and the step waits for the
 * copy - so the review is answered first, as a cancel.
 */
export function cancelTransferReview(runId: string): void {
  if (pending && (pending.runId === undefined || pending.runId === runId)) answer("cancel");
}

function answer(value: TransferAnswer): void {
  const done = pending;
  pending = null;
  window.dispatchEvent(new Event(EVENT));
  done?.resolve(value);
}

/**
 * The pending review, re-read on every change - also when only the number of
 * steps showing it in place changed (review 2026-10-28: the sheet host lives
 * beside the app and re-rendered on nothing else, so it never noticed a files
 * step coming or going).
 */
function usePendingReview(): TransferReview | null {
  const [, changed] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    window.addEventListener(EVENT, changed);
    return () => window.removeEventListener(EVENT, changed);
  }, []);
  return pending;
}

/** The review the files step shows in place, while it is on screen as a step of the setup. */
export function useInlineTransferReview(active: boolean): TransferReview | null {
  // Counted before paint, so the sheet does not flash for a frame under a step that shows it.
  useLayoutEffect(() => {
    if (!active) return;
    inlineConsumers += 1;
    window.dispatchEvent(new Event(EVENT));
    return () => { inlineConsumers -= 1; window.dispatchEvent(new Event(EVENT)); };
  }, [active]);
  const review = usePendingReview();
  return active ? review : null;
}

function text(bytes: Uint8Array, binary: (size: number) => string): string {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return binary(bytes.length); }
}

/**
 * What the copy into the new vault does, as the content of the files step
 * (E4): which folder becomes the vault, what comes along from the vault the
 * setup started in, and that the folder's own files follow in the
 * background. Files both sides have are compared one by one first.
 */
export function TransferReviewStep({ review, onOtherFolder, allowOtherFolder = true }: { review: TransferReview; onOtherFolder?: () => void; allowOtherFolder?: boolean }) {
  const { t } = useTranslation();
  const [step, setStep] = useState(-1);
  const collision = step >= 0 ? review.plan.collisions[step] : undefined;
  if (collision) {
    return (
      <CompareVersions
        key={`${step}`}
        inNote={text(collision.remote.bytes, (size) => t("compare.binaryFile", { size }))}
        other={text(collision.local.bytes, (size) => t("compare.binaryFile", { size }))}
        noteMeta={{ title: t("compare.currentFile"), subtitle: collision.path }}
        otherMeta={{ title: t("connection.transferCopy"), subtitle: collision.copyPath }}
        hint={t("connection.transferKeepHint")}
        actions={<Button variant="primary" onClick={() => setStep(step + 1 < review.plan.collisions.length ? step + 1 : -2)}>{t("compare.keepBoth")}</Button>}
      />
    );
  }
  const compared = step === -2 || review.plan.collisions.length === 0;
  return (
    <>
      <GroupCard>
        <RowList>
          <Row icon={<FolderOpen size={ICON.ui} />} title={review.target} subtitle={t(review.existing ? "connectRun.reviewExistingVault" : "connectRun.reviewNewVault")} data-testid="transfer-review-target" wrap />
          {review.plan.local.length > 0 && (
            <Row icon={<GitMerge size={ICON.ui} />} title={t("connectRun.reviewLocal", { count: review.plan.local.length, source: review.source })} subtitle={t("connectRun.reviewLocalHint")} data-testid="transfer-review-local" wrap />
          )}
          {review.plan.collisions.length > 0 && (
            <Row icon={<GitMerge size={ICON.ui} />} title={t("connectRun.reviewCollisions", { count: review.plan.collisions.length })} subtitle={t("connectRun.reviewCollisionsHint")} wrap />
          )}
          <Row icon={<RefreshCw size={ICON.ui} />} title={t("connectRun.reviewRemote", { provider: review.target.split(" · ")[0] })} subtitle={t("connectRun.reviewRemoteHint")} wrap />
        </RowList>
      </GroupCard>
      <div className="m-connectrun-foot">
        {compared
          ? <Button variant="primary" data-testid="transfer-review-apply" onClick={() => answer("apply")}>{t("connectRun.applyAndNext")}</Button>
          : <Button variant="primary" onClick={() => setStep(0)}>{t("connection.reviewCollisions")}</Button>}
        {allowOtherFolder && <Button variant="ghost" data-testid="transfer-review-other" onClick={() => { answer("otherFolder"); onOtherFolder?.(); }}>{t("connectRun.otherFolder")}</Button>}
      </div>
    </>
  );
}

/**
 * The same review as a sheet, for the rare return into the app with no files
 * step on screen to show it in place.
 */
export function TransferReviewHost() {
  const { t } = useTranslation();
  const review = usePendingReview();
  // A run that ends - stopped, its vault gone, past its files step - answers
  // the question it left open: the copy waits for nobody, and the next run
  // does not find this one's review (review 2026-10-28).
  useEffect(() => {
    // A NEW run started over the old one (second review 2026-10-28) ends the old review too.
    const settle = () => {
      const asked = pending;
      if (!asked) return;
      void loadConnectQueue().then((run) => {
        if (pending === asked && (!run || (asked.runId !== undefined && run.id !== asked.runId) || run.pending[0] !== "files")) answer("cancel");
      }).catch(() => {});
    };
    window.addEventListener(CONNECT_RUN_EVENT, settle);
    return () => window.removeEventListener(CONNECT_RUN_EVENT, settle);
  }, []);
  if (!review || inlineConsumers > 0) return null;
  return <div className="m-sheet-backdrop" onClick={() => answer("cancel")}><section className="pv-sheet m-sheet" onClick={e => e.stopPropagation()}>
    <SheetGrip onClose={() => answer("cancel")} />
    <h2 className="m-sheet-title">{t("connectRun.reviewHeading", { folder: review.folder })}</h2>
    <TransferReviewStep review={review} allowOtherFolder={false} />
    <Button variant="ghost" onClick={() => answer("cancel")}>{t("common.cancel")}</Button>
  </section></div>;
}
