import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { AI_EMBEDDING_PROFILE, SEMANTIC_BY_PROVIDER, semanticSourceOf, type EmbeddingModelSpec } from "@plainva/core";
import {
  AiSendOverview,
  Banner,
  Button,
  GroupCard,
  measurementRows,
  measurementText,
  packageInstalled,
  Row,
  RowList,
  searchRests,
  SectionLabel,
  semanticFailureText,
  semanticModelRows,
  semanticProgressLine,
  semanticReadyLine,
  semanticRunFailureText,
  semanticUnusedLine,
  Switch,
  toast,
  useLocalEmbeddings,
  type AiSession,
  type StandingApproval,
  type UnusedEmbeddings,
} from "@plainva/ui";
import { ChoiceMark } from "./ChoiceMark";
import { SemanticLoadSheet } from "./SemanticLoadSheet";
import { mConfirm } from "../services/mobileDialogs";
import { mobileLocalModels } from "../services/ai/localModels";

/**
 * Settings → AI & automation → "Semantic search" on the phone (plan
 * KI-Harness P2a-4/P2a-5): the desktop card's choice in rows — Off, one
 * catalog model or the own provider, a single choice with the round mark —
 * then its life: loading with progress and the device check for a package,
 * the send overview's standing approval for a cloud model, pause, removal,
 * withdrawal, and clearing away what is no longer used.
 */
export function MobileSemanticSection({ session, onChooseModel }: { session: AiSession; onChooseModel: () => void }) {
  const { t, i18n } = useTranslation();
  const settings = useSyncExternalStore(session.subscribe, session.getState).settings;
  const { controller, state } = useLocalEmbeddings();
  const [asking, setAsking] = useState<EmbeddingModelSpec | null>(null);
  const [unused, setUnused] = useState<UnusedEmbeddings | null>(null);
  const [approval, setApproval] = useState<StandingApproval | null>(null);
  const chosen = settings.semanticModel;
  // Stable between renders: the effect below follows it.
  const source = useMemo(() => semanticSourceOf(settings), [settings]);
  const target = source?.kind === "provider" ? source.target : null;
  const rows = semanticModelRows(t, i18n.language);
  const engine = state?.engine;
  const download = state?.download ?? null;
  const progress = state?.progress;

  useEffect(() => {
    let alive = true;
    void controller?.unused().then((found) => alive && setUnused(found));
    if (controller && target) void controller.approvalOf(target).then((found) => alive && setApproval(found));
    else setApproval(null);
    return () => {
      alive = false;
    };
  }, [controller, engine, target]);

  const choose = async (spec: EmbeddingModelSpec | null) => {
    if (!spec) {
      await session.updateSettings((s) => ({ ...s, semanticModel: null }));
      return;
    }
    if (await packageInstalled(mobileLocalModels, spec)) await session.updateSettings((s) => ({ ...s, semanticModel: spec.id }));
    else setAsking(spec);
  };
  const chooseProvider = async () => {
    await session.updateSettings((s) => ({ ...s, semanticModel: SEMANTIC_BY_PROVIDER }));
    if (!settings.profiles[AI_EMBEDDING_PROFILE]) onChooseModel();
  };
  const load = async (spec: EmbeddingModelSpec) => {
    setAsking(null);
    if (controller && (await controller.install(spec))) await session.updateSettings((s) => ({ ...s, semanticModel: spec.id }));
  };
  const remove = async (spec: EmbeddingModelSpec) => {
    const ok = await mConfirm({ title: t("ai.semantic.remove"), message: t("ai.semantic.removeConfirm", { model: spec.name }), confirmLabel: t("ai.semantic.remove"), danger: true });
    if (!ok || !controller) return;
    if (chosen === spec.id) await session.updateSettings((s) => ({ ...s, semanticModel: null }));
    await controller.remove(spec);
  };
  const withdraw = async () => {
    if (!controller || !target) return;
    const ok = await mConfirm({ title: t("ai.semantic.withdraw"), message: t("ai.semantic.withdrawConfirm", { provider: target.provider.label }), confirmLabel: t("ai.semantic.withdraw"), danger: true });
    if (ok) await controller.withdraw(target);
  };
  const removeUnused = async () => {
    if (!controller || !unused) return;
    const what = semanticUnusedLine(t, unused, i18n.language);
    const ok = await mConfirm({ title: t("ai.semantic.unused"), message: t("ai.semantic.unusedConfirm", { what }), confirmLabel: t("ai.semantic.unusedRemove"), danger: true });
    if (!ok) return;
    await controller.removeUnused();
    setUnused(await controller.unused());
  };

  const copyMeasurement = () => {
    const report = state?.measurement;
    if (!report) return;
    void navigator.clipboard
      .writeText(measurementText(t, report, i18n.language))
      .then(() => toast.success(t("ai.semantic.resultsCopied")))
      .catch(() => toast.error(t("connection.clipboardFailed")));
  };
  const megabytes = (bytes: number) => new Intl.NumberFormat(i18n.language).format(Math.round(bytes / 1e6));
  const readyPackage = engine?.kind === "ready" && engine.source.kind === "package" ? engine.source.spec : null;
  const hasUnused = Boolean(unused && (unused.packages.length || unused.spaces.length));

  return (
    <>
      <SectionLabel>{t("ai.semantic.title")}</SectionLabel>
      <p className="m-hint">{t("ai.semantic.description")}</p>
      {/* Fully local (plan P7): search by meaning through a provider rests; with a package on this device it goes on. */}
      {searchRests(settings) && <p className="m-hint" data-testid="ai-rests-search">{t("ai.mode.restsHere")}</p>}
      <GroupCard>
        <RowList>
          <Row title={t("ai.semantic.off")} end={<ChoiceMark on={!chosen} />} onClick={() => void choose(null)} disabled={Boolean(download)} />
          {rows.map((row) => (
            <Row
              key={row.spec.id}
              wrap
              title={row.spec.name}
              subtitle={`${row.line} — ${row.hint}`}
              end={<ChoiceMark on={chosen === row.spec.id} />}
              onClick={() => void choose(row.spec)}
              disabled={Boolean(download)}
              data-testid={`semantic-model-${row.spec.id}`}
            />
          ))}
          <Row
            wrap
            title={t("ai.semantic.provider")}
            subtitle={`${target ? `${target.provider.label} · ${target.model}` : t("ai.semantic.providerUnset")} — ${t("ai.semantic.providerHint")}`}
            end={<ChoiceMark on={chosen === SEMANTIC_BY_PROVIDER} />}
            onClick={() => void chooseProvider()}
            disabled={Boolean(download)}
            data-testid="semantic-model-provider"
          />
        </RowList>
      </GroupCard>
      {download && (
        <>
          <p className="m-hint" role="status">
            {t("ai.semantic.loading", { file: download.file, received: megabytes(download.received), total: megabytes(download.total) })}
          </p>
          <div className="pv-security-progress" aria-hidden="true">
            <div className="pv-security-progress-bar" style={{ width: `${download.total ? (download.received / download.total) * 100 : 0}%` }} />
          </div>
          <Button variant="ghost" onClick={() => void controller?.cancelInstall(rows.find((row) => row.spec.id === download.model)!.spec)}>
            {t("ai.semantic.cancel")}
          </Button>
        </>
      )}
      {state?.downloadError && <Banner kind="warning">{t("ai.semantic.loadFailed", { reason: state.downloadError })}</Banner>}
      {(engine?.kind === "checking" || engine?.kind === "opening") && <p className="m-hint">{t("ai.semantic.checking")}</p>}
      {engine?.kind === "failed" && <Banner kind="warning">{semanticFailureText(t, engine)}</Banner>}
      {engine?.kind === "failed" && (engine.reason === "no-model" || engine.reason === "no-route") && (
        <Button variant="tonal" onClick={onChooseModel} data-testid="semantic-choose-model">
          {t("ai.semantic.chooseModel")}
        </Button>
      )}
      {engine?.kind === "approval" && (
        <AiSendOverview touch manifest={engine.manifest} onSend={() => void controller?.approve()} onCancel={() => void session.updateSettings((s) => ({ ...s, semanticModel: null }))} />
      )}
      {engine?.kind === "ready" && progress && (
        <GroupCard>
          <RowList>
            <Row title={semanticReadyLine(t, engine.source)} subtitle={semanticProgressLine(t, progress, i18n.language)} wrap />
            <Row
              title={progress.state === "paused" ? t("ai.semantic.resume") : t("ai.semantic.pause")}
              onClick={() => (progress.state === "paused" ? controller?.resume() : controller?.pause())}
            />
            {readyPackage && <Row title={t("ai.semantic.remove")} onClick={() => void remove(readyPackage)} />}
            {engine.source.kind === "provider" && approval && <Row title={t("ai.semantic.withdraw")} onClick={() => void withdraw()} data-testid="semantic-withdraw" />}
            <Row
              title={state?.measuring ? t("ai.semantic.measuring") : t("ai.semantic.measure")}
              disabled={state?.measuring}
              onClick={() => void controller?.measure("phone")}
              data-testid="semantic-measure"
            />
          </RowList>
        </GroupCard>
      )}
      {engine?.kind === "ready" && state?.measurement && (
        <>
          <p className="m-hint">{t("ai.semantic.measuredPhone")}</p>
          <GroupCard>
            <RowList>
              {measurementRows(t, state.measurement, i18n.language).map((row) => (
                <Row key={row.key} wrap title={row.label} subtitle={`${row.line} — ${row.ok ? t("ai.semantic.budgetOk") : t("ai.semantic.budgetOver")}`} />
              ))}
              <Row title={t("ai.semantic.copyResults")} onClick={copyMeasurement} />
            </RowList>
          </GroupCard>
        </>
      )}
      {state?.measureError && <Banner kind="warning">{t("ai.semantic.measureFailed", { reason: state.measureError })}</Banner>}
      {engine?.kind === "ready" && progress?.state === "failed" && (
        <Banner kind="warning">{semanticRunFailureText(t, engine.source, state?.runFailure ?? null, progress.error ?? "")}</Banner>
      )}
      {engine?.kind === "ready" && (
        <GroupCard>
          <RowList>
            <Row
              wrap
              title={t("ai.related.show")}
              subtitle={t("ai.related.showDesc")}
              end={<Switch checked={settings.relatedNotes} label={t("ai.related.show")} onChange={(on) => void session.updateSettings((s) => ({ ...s, relatedNotes: on }))} />}
            />
            {state?.related.vaultPaused && <Row title={t("ai.related.vaultPausedRow")} />}
            {state?.related.vaultPaused && <Row title={t("ai.related.resume")} onClick={() => void controller?.setRelatedVaultPaused(false)} data-testid="related-resume-vault" />}
            {Boolean(state?.related.paused.length) && <Row title={t("ai.related.pausedNotes", { count: state?.related.paused.length ?? 0 })} />}
            {Boolean(state?.related.paused.length) && <Row title={t("ai.related.resumeAll")} onClick={() => void controller?.resumeRelated()} data-testid="related-resume-all" />}
            {Boolean(state?.related.dismissed) && <Row title={t("ai.related.hidden", { count: state?.related.dismissed ?? 0 })} />}
            {Boolean(state?.related.dismissed) && <Row title={t("ai.related.restore")} onClick={() => void controller?.restoreRelated()} data-testid="related-restore" />}
          </RowList>
        </GroupCard>
      )}
      {hasUnused && unused && (
        <GroupCard>
          <RowList>
            <Row wrap title={t("ai.semantic.unused")} subtitle={semanticUnusedLine(t, unused, i18n.language)} />
            <Row title={t("ai.semantic.unusedRemove")} onClick={() => void removeUnused()} data-testid="semantic-remove-unused" />
          </RowList>
        </GroupCard>
      )}
      {asking && <SemanticLoadSheet spec={asking} onCancel={() => setAsking(null)} onLoad={() => void load(asking)} />}
    </>
  );
}
