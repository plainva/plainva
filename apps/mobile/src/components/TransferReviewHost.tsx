import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@plainva/ui";
import type { VaultTransferPlan } from "@plainva/core";
import { CompareVersions } from "./CompareVersions";
import { SheetGrip } from "./SheetGrip";

interface Review { plan: VaultTransferPlan; source: string; target: string; resolve: (ok: boolean) => void }
let pending: Review | null = null;
const EVENT = "m-transfer-review";
export function reviewVaultTransfer(plan: VaultTransferPlan, source: string, target: string): Promise<boolean> {
  if (pending) throw new Error("transfer_review_busy");
  return new Promise(resolve => { pending = { plan, source, target, resolve }; window.dispatchEvent(new Event(EVENT)); });
}
export function TransferReviewHost() {
  const { t } = useTranslation();
  const [review, setReview] = useState<Review | null>(pending);
  const [step, setStep] = useState(-1);
  useEffect(() => { const show = () => { setReview(pending); setStep(-1); }; window.addEventListener(EVENT, show); return () => window.removeEventListener(EVENT, show); }, []);
  if (!review) return null;
  const close = (ok: boolean) => { const done = pending; pending = null; setReview(null); done?.resolve(ok); };
  const collision = review.plan.collisions[step];
  const text = (bytes: Uint8Array) => { try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return t("compare.binaryFile", { size: bytes.length }); } };
  return <div className="m-sheet-backdrop" onClick={() => close(false)}><section className="pv-sheet m-sheet" onClick={e => e.stopPropagation()}>
    <SheetGrip onClose={() => close(false)} />
    <h2 className="m-sheet-title">{t("connection.transferTitle")}</h2>
    <p className="m-hint">{t("connection.transferSummary", { source: review.source, target: review.target, local: review.plan.local.length, remote: review.plan.remote.length, conflicts: review.plan.collisions.length })}</p>
    {collision ? <CompareVersions key={`${step}`} inNote={text(collision.remote.bytes)} other={text(collision.local.bytes)}
      noteMeta={{ title: t("compare.currentFile"), subtitle: collision.path }} otherMeta={{ title: t("connection.transferCopy"), subtitle: collision.copyPath }}
      hint={t("connection.transferKeepHint")} actions={<Button variant="primary" onClick={() => setStep(step + 1)}>{t("compare.keepBoth")}</Button>} />
      : <Button variant="primary" onClick={() => step < 0 && review.plan.collisions.length ? setStep(0) : close(true)}>{t(step < 0 && review.plan.collisions.length ? "connection.reviewCollisions" : "connection.startTransfer")}</Button>}
    <Button variant="ghost" onClick={() => close(false)}>{t("common.cancel")}</Button>
  </section></div>;
}
